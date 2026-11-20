using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

internal static class CliLauncher
{
    private static int Main(string[] arguments)
    {
        try
        {
            var cliDirectory = AppDomain.CurrentDomain.BaseDirectory;
            var appDirectory = Path.GetFullPath(Path.Combine(cliDirectory, ".."));
            var electron = Path.Combine(appDirectory, "The Proper Volume Karaoke Studio.exe");
            var script = Path.Combine(appDirectory, "resources", "studio-cli.cjs");
            if (!File.Exists(electron) || !File.Exists(script))
            {
                Console.Error.WriteLine("Studio CLI could not find Studio beside its launcher. Reinstall Studio or restore the portable folder.");
                return 1;
            }

            var start = new ProcessStartInfo
            {
                FileName = electron,
                Arguments = String.Join(" ", new[] { script }.Concat(arguments).Select(QuoteArgument)),
                UseShellExecute = false,
            };
            start.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
            // Electron can inherit a developer's console setting, which would hide CLI output.
            start.EnvironmentVariables.Remove("ELECTRON_NO_ATTACH_CONSOLE");
            using (var child = Process.Start(start))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Studio CLI could not start: " + error.Message);
            return 1;
        }
    }

    // Windows receives one UTF-16 command line. Double backslashes that precede a
    // quote, including the closing quote, so the child receives each argument unchanged.
    internal static string QuoteArgument(string argument)
    {
        var commandLine = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var character in argument)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            commandLine.Append('\\', character == '"' ? backslashes * 2 + 1 : backslashes);
            commandLine.Append(character);
            backslashes = 0;
        }
        commandLine.Append('\\', backslashes * 2);
        return commandLine.Append('"').ToString();
    }
}
