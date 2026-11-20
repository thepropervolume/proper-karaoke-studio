using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

internal static class CliPath
{
    private const string Owner = "TpvStudioCliPath";
    private const string HadValue = "TpvStudioCliPathHadValue";
    private const string PathName = "Path";
    private const string CurrentUserEnvironment = "Environment";
    private const string AllUsersEnvironment = @"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";

    private static int Main(string[] arguments)
    {
        if (arguments.Length != 4 || (arguments[0] != "add" && arguments[0] != "remove") ||
            (arguments[1] != "CurrentUser" && arguments[1] != "all"))
            return 2;
        try
        {
            var directory = Normalize(arguments[2]);
            if (directory == null || directory.IndexOfAny(new[] { ';', '"', '%' }) >= 0)
                throw new InvalidOperationException("Choose an installation directory without semicolons, quotes, or percent signs.");

            var all = arguments[1] == "all";
            using (var registry = RegistryKey.OpenBaseKey(all ? RegistryHive.LocalMachine : RegistryHive.CurrentUser,
                   Environment.Is64BitOperatingSystem ? RegistryView.Registry64 : RegistryView.Default))
            using (var environment = registry.CreateSubKey(all ? AllUsersEnvironment : CurrentUserEnvironment))
            using (var installation = registry.OpenSubKey(arguments[3], writable: true))
            {
                if (installation == null && arguments[0] == "remove") return 0;
                if (installation == null || environment == null)
                    throw new InvalidOperationException("Windows could not open the Studio installation or PATH registry entry.");
                if (Update(environment, installation, directory, arguments[0] == "add"))
                {
                    UIntPtr result;
                    // Ask Explorer and other applications to refresh their environment.
                    SendMessageTimeout(new IntPtr(0xffff), 0x001a, UIntPtr.Zero, "Environment", 0x0002, 1000, out result);
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    internal static bool Update(RegistryKey environment, RegistryKey installation, string directory, bool adding)
    {
        var owned = installation.GetValue(Owner, null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
        // An uninstaller must skip entries that were already present before Studio installed.
        if (!adding && !String.Equals(owned, directory, StringComparison.OrdinalIgnoreCase)) return false;

        var raw = environment.GetValue(PathName, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
        var value = raw as string;
        var kind = raw == null ? RegistryValueKind.ExpandString : environment.GetValueKind(PathName);
        if ((raw != null && value == null) || (kind != RegistryValueKind.String && kind != RegistryValueKind.ExpandString))
            throw new InvalidOperationException("The Windows PATH registry value has an unsupported type.");

        var entries = new List<string>((value ?? "").Split(';'));
        if (adding)
        {
            if (entries.Exists(entry => String.Equals(Normalize(entry), directory, StringComparison.OrdinalIgnoreCase))) return false;
            var next = String.IsNullOrEmpty(value) ? directory : value + ";" + directory;
            if (next.Length >= 32767) throw new InvalidOperationException("Windows PATH is too long to add Studio.");
            var hadValue = installation.GetValue(HadValue);
            installation.SetValue(Owner, directory, RegistryValueKind.String);
            try
            {
                installation.SetValue(HadValue, raw == null ? 0 : 1, RegistryValueKind.DWord);
                environment.SetValue(PathName, next, kind);
            }
            catch
            {
                if (owned == null) installation.DeleteValue(Owner, throwOnMissingValue: false);
                else installation.SetValue(Owner, owned, RegistryValueKind.String);
                if (hadValue is int) installation.SetValue(HadValue, hadValue, RegistryValueKind.DWord);
                else installation.DeleteValue(HadValue, throwOnMissingValue: false);
                throw;
            }
            return true;
        }

        var index = entries.FindLastIndex(entry => String.Equals(entry, directory, StringComparison.OrdinalIgnoreCase));
        if (index >= 0)
        {
            entries.RemoveAt(index);
            if (entries.Count == 0 && !Object.Equals(installation.GetValue(HadValue), 1))
                environment.DeleteValue(PathName, throwOnMissingValue: false);
            else environment.SetValue(PathName, String.Join(";", entries), kind);
        }
        installation.DeleteValue(Owner, throwOnMissingValue: false);
        installation.DeleteValue(HadValue, throwOnMissingValue: false);
        return index >= 0;
    }

    private static string Normalize(string path)
    {
        try
        {
            path = Environment.ExpandEnvironmentVariables(path.Trim().Trim('"'));
            if (!Path.IsPathRooted(path)) return null;
            return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }
        catch (ArgumentException) { return null; }
        catch (NotSupportedException) { return null; }
        catch (PathTooLongException) { return null; }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, string lParam, uint flags, uint time, out UIntPtr result);
}
