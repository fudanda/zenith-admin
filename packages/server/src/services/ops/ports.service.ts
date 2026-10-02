import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import { resolveExecutor } from '../../lib/host-exec';

const execFileAsync = promisify(execFile);

export interface PortEntry {
  protocol: string;
  localAddress: string;
  localPort: number;
  state: string;
  pid: number | null;
  processName: string | null;
  serviceName: string | null;
}

/** 常见端口 → 服务名映射，便于快速识别端口用途 */
const COMMON_PORTS: Record<number, string> = {
  20: 'FTP-DATA', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
  67: 'DHCP', 68: 'DHCP', 69: 'TFTP', 80: 'HTTP', 110: 'POP3', 111: 'RPC',
  123: 'NTP', 135: 'MSRPC', 139: 'NetBIOS', 143: 'IMAP', 161: 'SNMP', 179: 'BGP',
  389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 514: 'Syslog', 587: 'SMTP',
  636: 'LDAPS', 873: 'rsync', 989: 'FTPS', 990: 'FTPS', 993: 'IMAPS', 995: 'POP3S',
  1080: 'SOCKS', 1433: 'MSSQL', 1521: 'Oracle', 1883: 'MQTT', 2049: 'NFS',
  2181: 'ZooKeeper', 2375: 'Docker', 2376: 'Docker-TLS', 2379: 'etcd', 27017: 'MongoDB',
  3000: 'Node/Dev', 3001: 'Node/Dev', 3306: 'MySQL', 3389: 'RDP', 4222: 'NATS',
  5000: 'Dev/Flask', 5432: 'PostgreSQL', 5601: 'Kibana', 5672: 'RabbitMQ', 5900: 'VNC',
  6379: 'Redis', 6380: 'Redis', 7001: 'WebLogic', 8000: 'HTTP-Alt', 8025: 'MailHog',
  8080: 'HTTP-Proxy', 8081: 'HTTP-Alt', 8443: 'HTTPS-Alt', 8848: 'Nacos', 9000: 'HTTP-Alt',
  9090: 'Prometheus', 9092: 'Kafka', 9200: 'Elasticsearch', 9300: 'Elasticsearch',
  11211: 'Memcached', 15672: 'RabbitMQ-UI', 5173: 'Vite', 3300: 'ArcBase-API',
};

function serviceNameForPort(port: number): string | null {
  return COMMON_PORTS[port] ?? null;
}

/**
 * 获取当前系统正在监听的端口列表。
 * Linux/macOS：使用 `ss -tlnp` 或回退到 `netstat -tlnp`。
 * Windows：使用 `netstat -ano`。
 */
export async function getListeningPorts(hostId?: number | null): Promise<PortEntry[]> {
  if (hostId != null) {
    const executor = await resolveExecutor(hostId);
    let entries: PortEntry[];
    try {
      entries = parseSsOutput((await executor.exec('ss', ['-tulnp'], { timeoutMs: 5000 })).stdout);
    } catch {
      try {
        entries = parseNetstatOutput((await executor.exec('netstat', ['-tlnp'], { timeoutMs: 5000 })).stdout);
      } catch {
        entries = [];
      }
    }
    for (const entry of entries) entry.serviceName = serviceNameForPort(entry.localPort);
    return entries;
  }
  const platform = os.platform();
  const entries = platform === 'win32' ? await getPortsWindows() : await getPortsUnix();
  for (const e of entries) e.serviceName = serviceNameForPort(e.localPort);
  return entries;
}

async function getPortsUnix(): Promise<PortEntry[]> {
  try {
    // 优先使用 ss（更现代，性能更好）
    const { stdout } = await execFileAsync('ss', ['-tulnp'], { timeout: 5000 });
    return parseSsOutput(stdout);
  } catch {
    // 回退到 netstat
    try {
      const { stdout } = await execFileAsync('netstat', ['-tlnp'], { timeout: 5000 });
      return parseNetstatOutput(stdout);
    } catch {
      return [];
    }
  }
}

async function getPortsWindows(): Promise<PortEntry[]> {
  try {
    const { stdout } = await execFileAsync('netstat', ['-ano'], { timeout: 5000 });
    return parseNetstatWindowsOutput(stdout);
  } catch {
    return [];
  }
}

/** 解析 `ss -tlnp` 输出 */
export function parseSsOutput(output: string): PortEntry[] {
  const entries: PortEntry[] = [];
  const lines = output.split('\n').slice(1); // 跳过标题行
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [proto, state, , , local] = parts;
    if (!proto || (!proto.startsWith('tcp') && !proto.startsWith('udp'))) continue;
    const colonIdx = local.lastIndexOf(':');
    if (colonIdx < 0) continue;
    const localAddr = local.slice(0, colonIdx);
    const localPort = Number.parseInt(local.slice(colonIdx + 1), 10);
    if (Number.isNaN(localPort)) continue;
    // 解析进程信息：users:(("nginx",pid=123,fd=6))
    const processInfo = parts.find((p) => p.startsWith('users:'));
    let pid: number | null = null;
    let processName: string | null = null;
    if (processInfo) {
      const nameMatch = /"([^"]+)"/.exec(processInfo);
      const pidMatch = /pid=(\d+)/.exec(processInfo);
      if (nameMatch) processName = nameMatch[1];
      if (pidMatch) pid = Number.parseInt(pidMatch[1], 10);
    }
    entries.push({ protocol: proto.replace(/\d$/, ''), localAddress: localAddr, localPort, state: state || 'LISTEN', pid, processName, serviceName: null });
  }
  return entries;
}

/** 解析 `netstat -tlnp` 输出（Linux） */
export function parseNetstatOutput(output: string): PortEntry[] {
  const entries: PortEntry[] = [];
  const lines = output.split('\n').slice(2); // 跳过两行标题
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [proto, , , local, , stateOrPid] = parts;
    if (!proto || (!proto.startsWith('tcp') && !proto.startsWith('udp'))) continue;
    const colonIdx = local.lastIndexOf(':');
    if (colonIdx < 0) continue;
    const localAddr = local.slice(0, colonIdx);
    const localPort = Number.parseInt(local.slice(colonIdx + 1), 10);
    if (Number.isNaN(localPort)) continue;
    // state 字段在 tcp 中是第 6 列，pid/program 在第 7 列
    const state = stateOrPid === 'LISTEN' ? 'LISTEN' : parts[5] ?? '';
    const pidInfo = parts[6] ?? '';
    const pidMatch = /^(\d+)\/(.+)/.exec(pidInfo);
    const pid = pidMatch ? Number.parseInt(pidMatch[1], 10) : null;
    const processName = pidMatch ? pidMatch[2] : null;
    entries.push({ protocol: proto.replace(/\d$/, ''), localAddress: localAddr, localPort, state, pid, processName, serviceName: null });
  }
  return entries;
}

/** 解析 `netstat -ano` 输出（Windows） */
function parseNetstatWindowsOutput(output: string): PortEntry[] {
  const entries: PortEntry[] = [];
  const lines = output.split('\n').slice(4); // 跳过标题
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [proto, local, , state, pidStr] = parts;
    if (!proto || (!proto.startsWith('TCP') && !proto.startsWith('UDP'))) continue;
    if (state !== 'LISTENING') continue;
    const colonIdx = local.lastIndexOf(':');
    if (colonIdx < 0) continue;
    const localAddr = local.slice(0, colonIdx);
    const localPort = Number.parseInt(local.slice(colonIdx + 1), 10);
    if (Number.isNaN(localPort)) continue;
    const pid = pidStr ? Number.parseInt(pidStr, 10) : null;
    entries.push({ protocol: proto.toLowerCase().replace(/\d$/, ''), localAddress: localAddr, localPort, state: 'LISTEN', pid, processName: null, serviceName: null });
  }
  return entries;
}
