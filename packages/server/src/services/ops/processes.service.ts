import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime } from '../../lib/datetime';
import { localExecutor, resolveExecutor, type HostExecutor } from '../../lib/host-exec';
import type { ProcessInfo, ProcessListResponse, ProcessNetConn, SetProcessPriorityInput } from '@arcbase/shared/ops';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 20 * 1024 * 1024;
const PLATFORM = os.platform();

// ─── 端口缓存（每 15 秒刷新一次，避免 SSE 每帧都调 netstat）─────────────────
let portsCache: Map<number, string> | null = null;
let portsCacheAt = 0;
const PORTS_TTL = 15_000;

async function fetchPortsByPid(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    if (PLATFORM === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command',
          'Get-NetTCPConnection -State Listen | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress'],
        { maxBuffer: 2 * 1024 * 1024, timeout: 8000 },
      );
      const raw = JSON.parse(stdout.trim() || '[]') as unknown;
      const arr: Array<{ LocalPort?: number; OwningProcess?: number }> = Array.isArray(raw) ? raw : [raw];
      for (const r of arr) {
        const pid = Number(r.OwningProcess);
        const port = Number(r.LocalPort);
        if (pid > 0 && port > 0) {
          const existing = map.get(pid);
          map.set(pid, existing ? `${existing}, ${port}` : String(port));
        }
      }
    } else if (PLATFORM === 'darwin') {
      // macOS: lsof -i -n -P (faster than netstat)
      const { stdout } = await execFileAsync('lsof', ['-i', '-n', '-P'], { maxBuffer: 4 * 1024 * 1024, timeout: 8000 });
      for (const line of stdout.split('\n')) {
        if (!line.includes('(LISTEN)') && !line.includes('UDP')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number.parseInt(parts[1] ?? '', 10);
        const addr = parts[8] ?? '';
        const portMatch = addr.match(/:(\d+)$/);
        if (Number.isNaN(pid) || !portMatch) continue;
        const port = portMatch[1];
        const existing = map.get(pid);
        if (!existing?.includes(port)) {
          map.set(pid, existing ? `${existing}, ${port}` : port);
        }
      }
    } else {
      // Linux: ss is faster than netstat
      const { stdout } = await execFileAsync('ss', ['-tlnpH'], { maxBuffer: 4 * 1024 * 1024, timeout: 8000 });
      for (const line of stdout.split('\n')) {
        const portMatch = line.match(/:(\d+)\s/);
        const pidMatch = line.match(/pid=(\d+)/);
        if (!portMatch || !pidMatch) continue;
        const pid = Number.parseInt(pidMatch[1], 10);
        const port = portMatch[1];
        const existing = map.get(pid);
        if (!existing?.includes(port)) {
          map.set(pid, existing ? `${existing}, ${port}` : port);
        }
      }
    }
  } catch { /* best-effort */ }
  return map;
}

async function getPortsByPid(): Promise<Map<number, string>> {
  if (portsCache && Date.now() - portsCacheAt < PORTS_TTL) return portsCache;
  const map = await fetchPortsByPid();
  portsCache = map;
  portsCacheAt = Date.now();
  return map;
}

function mapUnixState(stat: string): string {
  if (!stat) return 'unknown';
  switch (stat.charAt(0).toUpperCase()) {
    case 'R': return 'running';
    case 'S': return 'sleeping';
    case 'D': return 'disk-sleep';
    case 'T': return 'stopped';
    case 'Z': return 'zombie';
    case 'I': return 'idle';
    default: return 'unknown';
  }
}

/** 解析 POSIX ps 输出；导出供多主机解析单测复用 */
export function parseUnixProcessList(stdout: string): ProcessInfo[] {
  const lines = stdout.split('\n').filter((s) => s.trim().length > 0);
  const result: ProcessInfo[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10) continue;
    const [pidStr, ppidStr, user, stat, cpuStr, memStr, rssStr, nlwpStr, niStr, ...nameParts] = parts;
    const pid = Number.parseInt(pidStr, 10);
    if (Number.isNaN(pid) || pid <= 0) continue;
    result.push({
      pid,
      ppid: Number.parseInt(ppidStr, 10) || 0,
      user: user || '',
      name: nameParts.join(' ') || pidStr,
      status: mapUnixState(stat),
      cpu: Number.parseFloat(cpuStr) || 0,
      memoryPercent: Number.parseFloat(memStr) || 0,
      memory: (Number.parseInt(rssStr, 10) || 0) * 1024,
      startTime: null,
      command: nameParts.join(' ') || '',
      threads: Number.parseInt(nlwpStr, 10) || 1,
      nice: Number.parseInt(niStr, 10),
      priorityClass: null,
      ports: null,
      connections: null,
    });
  }
  return result;
}

async function listProcessesUnix(executor: HostExecutor = localExecutor): Promise<ProcessInfo[]> {
  const fields = 'pid=,ppid=,user=,stat=,%cpu=,%mem=,rss=,nlwp=,ni=,comm=';
  try {
    const { stdout } = await executor.exec('ps', ['-ax', '-o', fields], { maxBuffer: MAX_BUFFER });
    return parseUnixProcessList(stdout);
  } catch (err) {
    throw new HTTPException(500, { message: `获取进程列表失败: ${String(err)}` });
  }
}

async function listProcessesWindows(): Promise<ProcessInfo[]> {
  const totalMem = os.totalmem();
  // 使用换行符拼接（PowerShell 不允许 @{; key=val} 语法，分号拼接会报错）
  const script = `
$ErrorActionPreference = "SilentlyContinue"
$result = Get-Process | ForEach-Object {
  [PSCustomObject]@{
    pid = $_.Id
    name = $_.Name
    cpu = [Math]::Round($_.CPU, 2)
    memory = $_.WorkingSet64
    threads = $_.Threads.Count
    startTime = if ($_.StartTime) { $_.StartTime.ToString("yyyy-MM-dd HH:mm:ss") } else { "" }
    priorityClass = try { $_.PriorityClass.ToString() } catch { "Normal" }
  }
}
if ($null -eq $result) { "[]" }
elseif ($result -is [array]) { $result | ConvertTo-Json -Depth 1 -Compress }
else { "[" + ($result | ConvertTo-Json -Depth 1 -Compress) + "]" }
`.trim();
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { maxBuffer: MAX_BUFFER, timeout: 15000 }, // 15s 超时防止卡死
    );
    const raw: unknown[] = JSON.parse(stdout.trim() || '[]');
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map((p) => {
        const mem = Number(p.memory) || 0;
        const name = typeof p.name === 'string' ? p.name : '';
        const startTime = typeof p.startTime === 'string' && p.startTime ? p.startTime : null;
        const priorityClass = typeof p.priorityClass === 'string' ? p.priorityClass : 'Normal';
        return {
          pid: Number(p.pid) || 0,
          ppid: 0,
          user: '',
          name,
          status: 'running',
          cpu: Number(p.cpu) || 0,
          memoryPercent: totalMem > 0 ? Math.round((mem / totalMem) * 10000) / 100 : 0,
          memory: mem,
          startTime,
          command: name,
          threads: Number(p.threads) || 1,
          nice: null,
          priorityClass,
          ports: null,
          connections: null,
        };
      });
  } catch (err) {
    throw new HTTPException(500, { message: `获取进程列表失败: ${String(err)}` });
  }
}

async function fetchRemotePortsByPid(executor: HostExecutor): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const { stdout } = await executor.exec('ss', ['-tlnpH'], { maxBuffer: 4 * 1024 * 1024 });
    for (const line of stdout.split('\n')) {
      const portMatch = line.match(/:(\d+)\s/);
      const pidMatch = line.match(/pid=(\d+)/);
      if (!portMatch || !pidMatch) continue;
      const pid = Number(pidMatch[1]);
      const port = portMatch[1];
      const existing = map.get(pid);
      if (!existing?.split(', ').includes(port)) {
        map.set(pid, existing ? `${existing}, ${port}` : port);
      }
    }
  } catch { /* ss 不可用或无权限时不阻断进程列表 */ }
  return map;
}

export async function listProcesses(hostId?: number | null): Promise<ProcessListResponse> {
  const timestamp = formatDateTime(new Date());
  if (hostId != null) {
    const executor = await resolveExecutor(hostId);
    const [processes, portsMap] = await Promise.all([
      listProcessesUnix(executor),
      fetchRemotePortsByPid(executor),
    ]);
    for (const processItem of processes) {
      processItem.ports = portsMap.get(processItem.pid) ?? null;
    }
    return { platform: 'linux', processes, total: processes.length, timestamp };
  }
  const [processes, portsMap] = await Promise.all([
    PLATFORM === 'win32' ? listProcessesWindows() : listProcessesUnix(),
    getPortsByPid(),
  ]);
  // Merge port data into process list
  for (const p of processes) {
    const ports = portsMap.get(p.pid);
    if (ports) p.ports = ports;
  }
  return { platform: PLATFORM, processes, total: processes.length, timestamp };
}

async function getProcessDetailUnix(pid: number): Promise<ProcessInfo> {
  const fields = 'pid=,ppid=,user=,stat=,%cpu=,%mem=,rss=,nlwp=,ni=,comm=';
  try {
    const [mainResult, lstartResult, cmdResult] = await Promise.allSettled([
      execFileAsync('ps', ['-p', String(pid), '-o', fields], { maxBuffer: 1024 * 1024 }),
      execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], { maxBuffer: 64 * 1024 }),
      execFileAsync('ps', ['-p', String(pid), '-o', 'command='], { maxBuffer: 256 * 1024 }),
    ]);
    if (mainResult.status === 'rejected') {
      throw new HTTPException(404, { message: `进程 ${pid} 不存在或无权限访问` });
    }
    const lines = mainResult.value.stdout.split('\n').filter((s) => s.trim().length > 0);
    if (lines.length === 0) throw new HTTPException(404, { message: `进程 ${pid} 不存在` });
    const parts = lines[0].trim().split(/\s+/);
    if (parts.length < 10) throw new HTTPException(404, { message: `进程 ${pid} 信息不完整` });
    const [pidStr, ppidStr, user, stat, cpuStr, memStr, rssStr, nlwpStr, niStr, ...nameParts] = parts;
    let startTime: string | null = null;
    if (lstartResult.status === 'fulfilled') {
      const raw = lstartResult.value.stdout.trim();
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) startTime = formatDateTime(d);
    }
    const fullCmd = cmdResult.status === 'fulfilled' ? cmdResult.value.stdout.trim() : null;
    const [connections, procExtra] = await Promise.all([
      getConnectionsByPid(pid).catch(() => null),
      readProcEnvCwd(pid),
    ]);
    return {
      pid: Number.parseInt(pidStr, 10),
      ppid: Number.parseInt(ppidStr, 10) || 0,
      user: user || '',
      name: nameParts.join(' ') || pidStr,
      status: mapUnixState(stat),
      cpu: Number.parseFloat(cpuStr) || 0,
      memoryPercent: Number.parseFloat(memStr) || 0,
      memory: (Number.parseInt(rssStr, 10) || 0) * 1024,
      startTime,
      command: fullCmd || nameParts.join(' ') || '',
      threads: Number.parseInt(nlwpStr, 10) || 1,
      nice: Number.parseInt(niStr, 10),
      priorityClass: null,
      ports: portsCache?.get(Number.parseInt(pidStr, 10)) ?? null,
      connections,
      cwd: procExtra.cwd,
      env: procExtra.env,
    };
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(500, { message: `获取进程详情失败: ${String(err)}` });
  }
}

async function getRemoteProcessDetail(pid: number, executor: HostExecutor): Promise<ProcessInfo> {
  const fields = 'pid=,ppid=,user=,stat=,%cpu=,%mem=,rss=,nlwp=,ni=,comm=';
  const [main, started, command, cwd, envRaw, connectionsRaw] = await Promise.allSettled([
    executor.exec('ps', ['-p', String(pid), '-o', fields]),
    executor.exec('ps', ['-p', String(pid), '-o', 'lstart=']),
    executor.exec('ps', ['-p', String(pid), '-o', 'command=']),
    executor.exec('readlink', ['-f', `/proc/${pid}/cwd`]),
    executor.exec('cat', [`/proc/${pid}/environ`]),
    executor.exec('ss', ['-ntp']),
  ]);
  if (main.status === 'rejected') {
    throw new HTTPException(404, { message: `进程 ${pid} 不存在或无权限访问` });
  }
  const processItem = parseUnixProcessList(main.value.stdout)[0];
  if (!processItem) throw new HTTPException(404, { message: `进程 ${pid} 不存在` });

  if (started.status === 'fulfilled') {
    const date = new Date(started.value.stdout.trim());
    if (!Number.isNaN(date.getTime())) processItem.startTime = formatDateTime(date);
  }
  if (command.status === 'fulfilled') processItem.command = command.value.stdout.trim() || processItem.command;
  processItem.cwd = cwd.status === 'fulfilled' ? cwd.value.stdout.trim() || null : null;
  if (envRaw.status === 'fulfilled') {
    const env: Record<string, string> = {};
    for (const pair of envRaw.value.stdout.split('\0')) {
      const index = pair.indexOf('=');
      if (index > 0) env[pair.slice(0, index)] = pair.slice(index + 1);
    }
    processItem.env = Object.keys(env).length > 0 ? env : null;
  } else {
    processItem.env = null;
  }
  if (connectionsRaw.status === 'fulfilled') {
    const connections: ProcessNetConn[] = [];
    for (const line of connectionsRaw.value.stdout.split('\n').slice(1)) {
      if (![...line.matchAll(/pid=(\d+)/g)].some((match) => Number(match[1]) === pid)) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const local = parts[3] ?? '';
      const remote = parts[4] ?? '';
      connections.push({
        localAddr: local,
        localPort: Number(local.split(':').pop()) || 0,
        remoteAddr: remote,
        remotePort: Number(remote.split(':').pop()) || 0,
        state: parts[0] ?? '',
        protocol: 'tcp',
      });
    }
    processItem.connections = connections;
  }
  return processItem;
}

/** 读取进程的工作目录与环境变量（仅 Linux /proc；无权限时返回 null） */
async function readProcEnvCwd(pid: number): Promise<{ env: Record<string, string> | null; cwd: string | null }> {
  if (process.platform !== 'linux') return { env: null, cwd: null };
  const env: Record<string, string> = {};
  try {
    const raw = await fsp.readFile(`/proc/${pid}/environ`, 'utf8');
    for (const pair of raw.split('\0')) {
      if (!pair) continue;
      const i = pair.indexOf('=');
      if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1);
    }
  } catch { /* 无权限或进程已退出 */ }
  let cwd: string | null = null;
  try { cwd = await fsp.readlink(`/proc/${pid}/cwd`); } catch { /* 无权限 */ }
  return { env: Object.keys(env).length > 0 ? env : null, cwd };
}

async function getProcessDetailWindows(pid: number): Promise<ProcessInfo> {
  const script = `
$ErrorActionPreference = "Stop"
$p = Get-Process -Id ${pid}
$c = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"
[PSCustomObject]@{
  pid = $p.Id
  ppid = if ($c) { $c.ParentProcessId } else { 0 }
  name = $p.Name
  cpu = [Math]::Round($p.CPU, 2)
  memory = $p.WorkingSet64
  threads = $p.Threads.Count
  startTime = if ($p.StartTime) { $p.StartTime.ToString("yyyy-MM-dd HH:mm:ss") } else { "" }
  command = if ($c -and $c.CommandLine) { $c.CommandLine } else { $p.Name }
  priorityClass = $p.PriorityClass.ToString()
} | ConvertTo-Json -Compress
`.trim();
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { maxBuffer: 256 * 1024 },
    );
    const p = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const mem = Number(p.memory) || 0;
    const totalMem = os.totalmem();
    const name = typeof p.name === 'string' ? p.name : '';
    const command = typeof p.command === 'string' ? p.command : name;
    const startTime = typeof p.startTime === 'string' && p.startTime ? p.startTime : null;
    const priorityClass = typeof p.priorityClass === 'string' ? p.priorityClass : 'Normal';
    const connections = await getConnectionsByPid(pid).catch(() => null);
    return {
      pid,
      ppid: Number(p.ppid) || 0,
      user: '',
      name,
      status: 'running',
      cpu: Number(p.cpu) || 0,
      memoryPercent: totalMem > 0 ? Math.round((mem / totalMem) * 10000) / 100 : 0,
      memory: mem,
      startTime,
      command: command || name,
      threads: Number(p.threads) || 1,
      nice: null,
      priorityClass,
      ports: portsCache?.get(pid) ?? null,
      connections,
    };
  } catch {
    throw new HTTPException(404, { message: `进程 ${pid} 不存在或无法访问` });
  }
}

// ─── 获取单个进程的网络连接详情 ──────────────────────────────────────────────

async function getConnectionsByPid(pid: number): Promise<ProcessNetConn[] | null> {
  try {
    if (PLATFORM === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command',
          `Get-NetTCPConnection -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State | ConvertTo-Json -Compress`],
        { maxBuffer: 512 * 1024, timeout: 8000 },
      );
      const raw = JSON.parse(stdout.trim() || '[]') as unknown;
      let arr: Array<Record<string, unknown>>;
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (raw) {
        arr = [raw as Record<string, unknown>];
      } else {
        arr = [];
      }
      return arr.map((r) => {
        const la = typeof r.LocalAddress === 'string' ? r.LocalAddress : '';
        const ra = typeof r.RemoteAddress === 'string' ? r.RemoteAddress : '';
        let st: string;
        if (typeof r.State === 'string') {
          st = r.State;
        } else if (typeof r.State === 'number') {
          st = String(r.State);
        } else {
          st = '';
        }
        return {
          localAddr: la,
          localPort: Number(r.LocalPort) || 0,
          remoteAddr: ra,
          remotePort: Number(r.RemotePort) || 0,
          state: st,
          protocol: 'tcp',
        };
      });
    } else if (PLATFORM === 'darwin') {
      const { stdout } = await execFileAsync(
        'lsof', ['-i', '-n', '-P', '-p', String(pid)],
        { maxBuffer: 512 * 1024, timeout: 6000 },
      );
      const conns: ProcessNetConn[] = [];
      for (const line of stdout.split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 9) continue;
        const proto = (parts[7] ?? '').toLowerCase();
        const addr = parts[8] ?? '';
        const state = (parts[9] ?? '').replace(/[()]/g, '');
        const [localFull = '', remoteFull = ''] = addr.includes('->') ? addr.split('->') : [addr, ''];
        const localPort = Number(localFull.split(':').pop()) || 0;
        const remotePort = Number(remoteFull.split(':').pop()) || 0;
        const proto6 = proto.includes('6') ? 'tcp6' : 'tcp';
        conns.push({ localAddr: localFull, localPort, remoteAddr: remoteFull, remotePort, state, protocol: proto6 });
      }
      return conns;
    } else {
      // Linux: ss -ntp
      const { stdout } = await execFileAsync(
        'ss', ['-ntp', `"( pid = ${pid} )"`],
        { maxBuffer: 512 * 1024, timeout: 6000, shell: true },
      );
      const conns: ProcessNetConn[] = [];
      for (const line of stdout.split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const state = parts[0] ?? '';
        const local = parts[3] ?? '';
        const remote = parts[4] ?? '';
        const localPort = Number((local).split(':').pop()) || 0;
        const remotePort = Number((remote).split(':').pop()) || 0;
        conns.push({ localAddr: local, localPort, remoteAddr: remote, remotePort, state, protocol: 'tcp' });
      }
      return conns;
    }
  } catch { return null; }
}

export async function getProcessDetail(pid: number, hostId?: number | null): Promise<ProcessInfo> {
  if (hostId != null) return getRemoteProcessDetail(pid, await resolveExecutor(hostId));
  return PLATFORM === 'win32' ? getProcessDetailWindows(pid) : getProcessDetailUnix(pid);
}

export async function killProcess(pid: number, signal: string, hostId?: number | null): Promise<void> {
  const VALID_SIGNALS = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP'];
  if (!VALID_SIGNALS.includes(signal)) {
    throw new HTTPException(400, { message: `不支持的信号: ${signal}` });
  }
  if (hostId != null) {
    try {
      await (await resolveExecutor(hostId)).exec('kill', [`-${signal}`, String(pid)]);
      return;
    } catch (err) {
      throw new HTTPException(400, { message: `结束远端进程 ${pid} 失败: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  if (PLATFORM === 'win32') {
    try {
      await execFileAsync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Stop-Process -Id ${pid} -Force -ErrorAction Stop`,
      ]);
    } catch {
      throw new HTTPException(400, { message: `结束进程 ${pid} 失败，进程可能不存在或无权限` });
    }
    return;
  }
  try {
    process.kill(pid, signal as NodeJS.Signals);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ESRCH') throw new HTTPException(404, { message: `进程 ${pid} 不存在` });
    if (code === 'EPERM') throw new HTTPException(403, { message: `无权限结束进程 ${pid}` });
    throw new HTTPException(500, { message: `结束进程 ${pid} 失败: ${err instanceof Error ? err.message : 'unknown error'}` });
  }
}

export async function setProcessPriority(pid: number, input: SetProcessPriorityInput, hostId?: number | null): Promise<void> {
  if (hostId != null) {
    if (input.nice === undefined) {
      throw new HTTPException(400, { message: '远端 Linux 主机需要提供 nice 参数（-20 到 19）' });
    }
    try {
      await (await resolveExecutor(hostId)).exec('renice', ['-n', String(input.nice), '-p', String(pid)]);
      return;
    } catch (err) {
      throw new HTTPException(400, { message: `调整远端进程 ${pid} 优先级失败: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  if (PLATFORM === 'win32') {
    if (input.priorityClass === undefined) {
      throw new HTTPException(400, { message: 'Windows 下需要提供 priorityClass 参数' });
    }
    const validClasses = ['Idle', 'BelowNormal', 'Normal', 'AboveNormal', 'High', 'RealTime'];
    if (!validClasses.includes(input.priorityClass)) {
      throw new HTTPException(400, { message: `无效的优先级类: ${input.priorityClass}` });
    }
    const script = `$ErrorActionPreference="Stop"; (Get-Process -Id ${pid}).PriorityClass = "${input.priorityClass}"`;
    try {
      await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    } catch {
      throw new HTTPException(400, { message: `设置进程 ${pid} 优先级失败` });
    }
    return;
  }
  if (input.nice === undefined) {
    throw new HTTPException(400, { message: 'Linux/macOS 下需要提供 nice 参数（-20 到 19）' });
  }
  try {
    await execFileAsync('renice', ['-n', String(input.nice), '-p', String(pid)]);
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string })?.stderr ?? (err instanceof Error ? err.message : 'unknown error');
    if (stderr.includes('Operation not permitted') || stderr.includes('EPERM')) {
      throw new HTTPException(403, { message: `无权限调整进程 ${pid} 的 nice 值（降低 nice 值需要 root 权限）` });
    }
    throw new HTTPException(400, { message: `调整进程 ${pid} 优先级失败: ${stderr}` });
  }
}
