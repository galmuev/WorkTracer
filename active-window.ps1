param([int]$IntervalMilliseconds = 5000)

$signature = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ActiveWindowApi {
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

    public static double GetIdleSeconds() {
        LASTINPUTINFO info = new LASTINPUTINFO();
        info.cbSize = (uint)Marshal.SizeOf(info);
        if (!GetLastInputInfo(ref info)) return 0;
        uint tick = unchecked((uint)Environment.TickCount);
        return unchecked(tick - info.dwTime) / 1000.0;
    }
}
'@

Add-Type -TypeDefinition $signature
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

while ($true) {
    try {
        $handle = [ActiveWindowApi]::GetForegroundWindow()
        $titleBuilder = [System.Text.StringBuilder]::new(2048)
        [void][ActiveWindowApi]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity)
        [uint32]$processId = 0
        [void][ActiveWindowApi]::GetWindowThreadProcessId($handle, [ref]$processId)
        $process = Get-Process -Id $processId -ErrorAction Stop
        [PSCustomObject]@{
            title = $titleBuilder.ToString()
            processName = $process.ProcessName
            idleSeconds = [ActiveWindowApi]::GetIdleSeconds()
        } | ConvertTo-Json -Compress
    }
    catch {
        [PSCustomObject]@{ title = ''; processName = ''; idleSeconds = 0 } | ConvertTo-Json -Compress
    }
    Start-Sleep -Milliseconds $IntervalMilliseconds
}
