/**
 * Suspending and resuming a child process.
 *
 * POSIX has job-control signals for this. Windows does not expose an equivalent to Node, so the
 * call goes through `NtSuspendProcess`/`NtResumeProcess` — the same ntdll entry points a native
 * addon such as `ntsuspend` would bind to, reached here via a short PowerShell P/Invoke so the
 * app keeps a pure-JS dependency tree.
 */
import { spawn } from "node:child_process";

/** PROCESS_SUSPEND_RESUME — the narrowest right that permits both calls. */
const PROCESS_SUSPEND_RESUME = 0x0800;

function powerShellScript(pid: number, entryPoint: "NtSuspendProcess" | "NtResumeProcess"): string {
  return `
$ErrorActionPreference = 'Stop'
$signature = @'
[DllImport("ntdll.dll", SetLastError = true)] public static extern int NtSuspendProcess(IntPtr handle);
[DllImport("ntdll.dll", SetLastError = true)] public static extern int NtResumeProcess(IntPtr handle);
[DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
'@
$native = Add-Type -MemberDefinition $signature -Name ProcessControl -Namespace InfinityPlay -PassThru
$handle = $native::OpenProcess(${PROCESS_SUSPEND_RESUME}, $false, ${pid})
if ($handle -eq [IntPtr]::Zero) { exit 2 }
$status = $native::${entryPoint}($handle)
$native::CloseHandle($handle) | Out-Null
if ($status -ne 0) { exit 3 }
exit 0
`.trim();
}

function runPowerShell(script: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { stdio: "ignore", windowsHide: true },
    );
    // A hardened host can block `Add-Type`; treat any failure as "could not suspend" so the
    // caller reports it rather than leaving the UI claiming a pause that never happened.
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));

    // The call is a handful of syscalls; anything slower means PowerShell itself is wedged.
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 10_000);
    child.on("close", () => clearTimeout(timer));
  });
}

async function signal(
  pid: number | undefined,
  posix: NodeJS.Signals,
  windows: "NtSuspendProcess" | "NtResumeProcess",
): Promise<boolean> {
  if (!pid) return false;

  if (process.platform === "win32") {
    return runPowerShell(powerShellScript(pid, windows));
  }

  try {
    process.kill(pid, posix);
    return true;
  } catch {
    return false;
  }
}

export function suspendProcess(pid: number | undefined): Promise<boolean> {
  return signal(pid, "SIGSTOP", "NtSuspendProcess");
}

export function resumeProcess(pid: number | undefined): Promise<boolean> {
  return signal(pid, "SIGCONT", "NtResumeProcess");
}
