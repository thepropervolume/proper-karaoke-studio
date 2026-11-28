param(
    [string]$OutputDirectory = "release",
    [string]$PreviousInstaller
)

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

function Assert-StudioStartShortcut([string]$Scope, [string]$ApplicationFolder) {
    $programsFolder = if ($Scope -eq 'Machine') { 'CommonPrograms' } else { 'Programs' }
    $startMenu = $shell.NameSpace([Environment]::GetFolderPath($programsFolder))
    $shortcut = $startMenu.ParseName("$($package.build.productName).lnk")
    $target = Join-Path $ApplicationFolder "$($package.build.productName).exe"
    if ($null -eq $shortcut -or
        $shortcut.ExtendedProperty('System.AppUserModel.ID') -cne $package.build.appId -or
        $shortcut.ExtendedProperty('System.Link.TargetParsingPath') -ne $target) {
        throw "The $Scope Start shortcut does not match the installed executable or its pin identity."
    }
}

function Assert-StudioInstalledApp([string]$Scope) {
    $key = Get-StudioRegistryKey $Scope $uninstallIdentity
    if ($null -eq $key) { throw "Studio is missing its $Scope Installed apps entry." }
    try {
        if ($key.GetValue('DisplayName') -cne $package.build.productName -or
            $key.GetValue('DisplayVersion') -cne $package.version) {
            throw "The $Scope Installed apps entry must list the product name and version separately."
        }
    }
    finally { $key.Dispose() }
}

$package = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
$installer = (Resolve-Path -LiteralPath (Join-Path $OutputDirectory "$($package.build.productName) Setup $($package.version).exe")).Path
$firstInstaller = if ($PreviousInstaller) { (Resolve-Path -LiteralPath $PreviousInstaller).Path } else { $installer }
$uninstallerName = "Uninstall $($package.build.productName).exe"
$installerGuid = '321faa76-60f3-5c20-8c07-0637c3638748'
$identity = "Software\$installerGuid"
$uninstallIdentity = "Software\Microsoft\Windows\CurrentVersion\Uninstall\$installerGuid"
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
$shell = New-Object -ComObject Shell.Application
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
    $desktop = if ($scope -eq 'Machine') { 'CommonDesktopDirectory' } else { 'DesktopDirectory' }
    $desktopShortcut = Join-Path ([Environment]::GetFolderPath($desktop)) "$($package.build.productName).lnk"
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
        Invoke-StudioInstaller $firstInstaller $installArguments
        Assert-StudioPath $scope $expected
        Assert-StudioStartShortcut $scope $app

        # Delete the test shortcut to make a remove-and-recreate upgrade observable.
        if (-not (Test-Path -LiteralPath $desktopShortcut)) { throw 'The initial install did not create the test Desktop shortcut.' }
        Remove-Item -LiteralPath $desktopShortcut
        Invoke-StudioInstaller $installer $installArguments
        if (Test-Path -LiteralPath $desktopShortcut) { throw 'The upgrade recreated a deleted Desktop shortcut.' }
        Assert-StudioStartShortcut $scope $app
        Assert-StudioInstalledApp $scope
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
    }
    finally {
        if (Test-Path -LiteralPath $uninstaller) {
            Invoke-StudioInstaller $uninstaller "/S $flag"
        }
    }
    Assert-StudioPath $scope $before[$scope]
    Assert-StudioPath $other $before[$other]
    Write-Output "$scope Studio Installed apps entry, shortcut identity, CLI launch, upgrade, and PATH restoration passed."
}

[IO.Directory]::Delete($root, $false)
