param([string]$OutputDirectory = "release")

$ErrorActionPreference = 'Stop'

function Get-StudioRegistryKey([string]$Scope, [string]$Subkey) {
    $hive = if ($Scope -eq 'Machine') { [Microsoft.Win32.RegistryHive]::LocalMachine } else { [Microsoft.Win32.RegistryHive]::CurrentUser }
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, [Microsoft.Win32.RegistryView]::Registry64)
    try { return $base.OpenSubKey($Subkey) }
    finally { $base.Dispose() }
}

function Get-StudioPathValue([string]$Scope) {
    $subkey = if ($Scope -eq 'Machine') { 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment' } else { 'Environment' }
    $key = Get-StudioRegistryKey $Scope $subkey
    if ($null -eq $key) { return @{ Value = $null; Kind = $null } }
    try {
        $value = $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $kind = if ($null -ne $value) { $key.GetValueKind('Path') } else { $null }
        return @{ Value = $value; Kind = $kind }
    }
    finally { $key.Dispose() }
}

function Invoke-StudioInstaller([string]$File, [string]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Studio installer command failed with exit code $($process.ExitCode): $File" }
}

function Assert-StudioPath([string]$Scope, [hashtable]$Expected) {
    $actual = Get-StudioPathValue $Scope
    if ($actual.Value -cne $Expected.Value -or $actual.Kind -ne $Expected.Kind) {
        throw "The $Scope PATH value or registry type differs from its expected state."
    }
}

$package = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
$installer = (Resolve-Path -LiteralPath (Join-Path $OutputDirectory "$($package.build.productName) Setup $($package.version).exe")).Path
$uninstallerName = "Uninstall $($package.build.productName).exe"
$identity = 'Software\321faa76-60f3-5c20-8c07-0637c3638748'
foreach ($scope in 'User', 'Machine') {
    $previousInstallation = Get-StudioRegistryKey $scope $identity
    if ($null -ne $previousInstallation) {
        $previousInstallation.Dispose()
        throw "This installation smoke test requires a clean Windows profile or runner. Studio is already registered in $scope."
    }
}

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($currentIdentity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run the Windows installation smoke test as an administrator to test both installation scopes.'
}

$before = @{ User = Get-StudioPathValue User; Machine = Get-StudioPathValue Machine }
$root = [IO.Directory]::CreateTempSubdirectory('tpv-studio-installer-smoke-').FullName
foreach ($scope in 'User', 'Machine') {
    $app = [IO.Path]::GetFullPath((Join-Path $root "Studio $scope"))
    if (-not $app.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Studio test destination is outside the temporary test directory.'
    }
    $flag = if ($scope -eq 'User') { '/currentuser' } else { '/allusers' }
    $other = if ($scope -eq 'User') { 'Machine' } else { 'User' }
    $cliDirectory = Join-Path $app 'cli'
    $uninstaller = Join-Path $app $uninstallerName
    $updateMarker = Join-Path $app 'resources/tpv-studio-install-kind'
    $expectedValue = if ([String]::IsNullOrEmpty($before[$scope].Value)) {
        $cliDirectory
    } else {
        $before[$scope].Value + ';' + $cliDirectory
    }
    $expectedKind = if ($null -ne $before[$scope].Kind) { $before[$scope].Kind } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
    $expected = @{ Value = $expectedValue; Kind = $expectedKind }
    try {
        # NSIS requires /D to be the last argument and to be passed without quotes.
        $installArguments = "/S $flag /D=$app"
        Invoke-StudioInstaller $installer $installArguments
        Assert-StudioPath $scope $expected
        Assert-StudioPath $other $before[$other]
        if ((Get-Content -LiteralPath $updateMarker -Raw) -cne 'nsis') {
            throw 'The installed application is missing its NSIS update marker.'
        }

        $sessionPath = $env:Path
        try {
            # An existing shell still has its old environment after the installer runs.
            # Restrict the test PATH so the launcher must use its own bundled runtime.
            $env:Path = "$cliDirectory;$env:SystemRoot\System32"
            $command = Get-Command tpv-karaoke-studio -CommandType Application
            $version = & $command.Source --version
            if ($LASTEXITCODE -ne 0 -or "$version".Trim() -ne $package.version) {
                throw "The installed Studio CLI did not return version $($package.version)."
            }
            & $command.Source project info --help | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'The installed Studio CLI could not load project commands.' }
        }
        finally { $env:Path = $sessionPath }

        # Reinstallation exercises the upgrade path and must leave exactly one entry.
        Invoke-StudioInstaller $installer $installArguments
        Assert-StudioPath $scope $expected
        Assert-StudioPath $other $before[$other]
    }
    finally {
        if (Test-Path -LiteralPath $uninstaller) {
            Invoke-StudioInstaller $uninstaller "/S $flag"
        }
    }
    Assert-StudioPath $scope $before[$scope]
    Assert-StudioPath $other $before[$other]
    Write-Output "$scope Studio installation, CLI launch, upgrade, and PATH restoration passed."
}

[IO.Directory]::Delete($root, $false)
