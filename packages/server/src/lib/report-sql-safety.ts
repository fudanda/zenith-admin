import { HTTPException } from 'hono/http-exception';
import { isSensitiveTable, SENSITIVE_COLUMN_RE } from './report-schema-meta';

const WRITE_OR_CONTROL_KEYWORDS = new Set([
  'alter',
  'analyze',
  'call',
  'cluster',
  'comment',
  'copy',
  'create',
  'deallocate',
  'delete',
  'discard',
  'do',
  'drop',
  'execute',
  'exec',
  'grant',
  'insert',
  'listen',
  'load',
  'lock',
  'merge',
  'notify',
  'prepare',
  'refresh',
  'reindex',
  'reset',
  'revoke',
  'set',
  'truncate',
  'update',
  'vacuum',
]);

/**
 * 用户手写 SQL 中禁止出现的函数：
 * - 服务器端文件 / 程序 / 大对象（pg_read_file、lo_import、adminpack…）
 * - 会话状态篡改（set_config 可在只读事务内 SET ROLE / 关闭 statement_timeout）
 * - 以字符串执行任意 SQL 或按名读表、绕过表 allowlist 的 XML 函数（query_to_xml、table_to_xml…）
 * - 跨库 / 后台进程控制 / 复制与备份控制
 * 只读事务与 arcbase_readonly 角色是真正的边界，这里是让错误更早、更可读的第一道闸。
 */
const DANGEROUS_FUNCTIONS = new Set([
  'benchmark',
  'cursor_to_xml',
  'cursor_to_xmlschema',
  'database_to_xml',
  'database_to_xml_and_xmlschema',
  'database_to_xmlschema',
  'dblink',
  'dblink_close',
  'dblink_connect',
  'dblink_connect_u',
  'dblink_disconnect',
  'dblink_exec',
  'dblink_fetch',
  'dblink_get_result',
  'dblink_open',
  'dblink_send_query',
  'dumpfile',
  'load_file',
  'lo_creat',
  'lo_create',
  'lo_export',
  'lo_from_bytea',
  'lo_import',
  'lo_put',
  'lo_unlink',
  'nextval',
  'openquery',
  'opendatasource',
  'openrowset',
  'pg_advisory_lock',
  'pg_advisory_lock_shared',
  'pg_advisory_xact_lock',
  'pg_advisory_xact_lock_shared',
  'pg_backup_start',
  'pg_backup_stop',
  'pg_cancel_backend',
  'pg_create_logical_replication_slot',
  'pg_create_physical_replication_slot',
  'pg_create_restore_point',
  'pg_current_logfile',
  'pg_drop_replication_slot',
  'pg_file_rename',
  'pg_file_unlink',
  'pg_file_write',
  'pg_logdir_ls',
  'pg_logical_slot_get_changes',
  'pg_logical_slot_peek_changes',
  'pg_ls_archive_statusdir',
  'pg_ls_dir',
  'pg_ls_logdir',
  'pg_ls_tmpdir',
  'pg_ls_waldir',
  'pg_promote',
  'pg_read_binary_file',
  'pg_read_file',
  'pg_reload_conf',
  'pg_rotate_logfile',
  'pg_sleep',
  'pg_sleep_for',
  'pg_sleep_until',
  'pg_start_backup',
  'pg_stat_file',
  'pg_stop_backup',
  'pg_switch_wal',
  'pg_terminate_backend',
  'query_to_xml',
  'query_to_xml_and_xmlschema',
  'query_to_xmlschema',
  'schema_to_xml',
  'schema_to_xml_and_xmlschema',
  'schema_to_xmlschema',
  'set_config',
  'setval',
  'sleep',
  'table_to_xml',
  'table_to_xml_and_xmlschema',
  'table_to_xmlschema',
  'xp_cmdshell',
]);
const QUOTED_DANGEROUS_FUNCTION_RE = new RegExp(
  `(?:"(?:${[...DANGEROUS_FUNCTIONS].join('|')})"|` +
  `\`(?:${[...DANGEROUS_FUNCTIONS].join('|')})\`|` +
  `\\[(?:${[...DANGEROUS_FUNCTIONS].join('|')})\\])\\s*\\(`,
  'i',
);
/** U&"..." Unicode 转义标识符可以把函数名拆成转义序列绕过词法匹配，用户 SQL 一律不允许 */
const UNICODE_ESCAPED_IDENTIFIER_RE = /\bU&"/i;

function maskSqlLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      out += '  ';
      i += 2;
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < sql.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (ch === '\'') {
      const close = ch;
      out += ' ';
      i++;
      while (i < sql.length) {
        if (sql[i] === close) {
          if (sql[i + 1] === close) {
            out += '  ';
            i += 2;
            continue;
          }
          out += ' ';
          i++;
          break;
        }
        if (sql[i] === '\\' && i + 1 < sql.length) {
          out += '  ';
          i += 2;
          continue;
        }
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      out += ' ';
      i++;
      while (i < sql.length) {
        if (sql[i] === close) {
          if (close !== ']' && sql[i + 1] === close) {
            out += '  ';
            i += 2;
            continue;
          }
          out += ' ';
          i++;
          break;
        }
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        out += ' '.repeat(tag.length);
        i += tag.length;
        const end = sql.indexOf(tag, i);
        if (end === -1) {
          out += ' '.repeat(sql.length - i);
          break;
        }
        out += sql.slice(i, end).replace(/[^\n]/g, ' ');
        out += ' '.repeat(tag.length);
        i = end + tag.length;
        continue;
      }
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * 拦截用户 SQL 中的危险函数调用（含引号 / Unicode 转义 / 可执行注释绕过）。
 * 供报表数据集与数据库管理控制台共用；`label` 用于错误信息前缀（如「报表 SQL」「控制台 SQL」）。
 * 返回屏蔽了字符串字面量与注释后的文本，便于调用方继续做关键字判断。
 */
export function assertNoDangerousSqlFunctions(sql: string, label: string): string {
  if (/\/\*(?:!|M!)/i.test(sql)) {
    throw new HTTPException(400, { message: `${label}禁止使用可执行注释` });
  }
  if (UNICODE_ESCAPED_IDENTIFIER_RE.test(sql)) {
    throw new HTTPException(400, { message: `${label}禁止使用 Unicode 转义标识符` });
  }
  if (QUOTED_DANGEROUS_FUNCTION_RE.test(sql)) {
    throw new HTTPException(400, { message: `${label}包含禁止的引号函数调用` });
  }
  const masked = maskSqlLiteralsAndComments(sql);
  const tokens = masked.match(/[A-Za-z_][A-Za-z0-9_$]*/g)?.map((token) => token.toLowerCase()) ?? [];
  const unsafeToken = tokens.find((token) => DANGEROUS_FUNCTIONS.has(token));
  if (unsafeToken) {
    throw new HTTPException(400, { message: `${label}包含禁止的函数：${unsafeToken}` });
  }
  return masked;
}

export function normalizeReadonlyReportSql(input: string): string {
  const sql = input.trim().replace(/;\s*$/, '').trim();
  if (!sql) throw new HTTPException(400, { message: '数据集 SQL 不能为空' });
  const masked = assertNoDangerousSqlFunctions(sql, '报表 SQL ');
  if (masked.includes(';')) {
    throw new HTTPException(400, { message: '报表 SQL 仅允许执行单条查询' });
  }

  const tokens = masked.match(/[A-Za-z_][A-Za-z0-9_$]*/g)?.map((token) => token.toLowerCase()) ?? [];
  const first = tokens[0];
  if (first !== 'select' && first !== 'with') {
    throw new HTTPException(400, { message: '报表 SQL 仅允许只读 SELECT/WITH 查询' });
  }
  if (first === 'with' && !tokens.includes('select')) {
    throw new HTTPException(400, { message: 'WITH 查询必须以 SELECT 返回结果' });
  }
  if (tokens.includes('into')) {
    throw new HTTPException(400, { message: '报表 SQL 禁止使用 SELECT INTO' });
  }

  const unsafeToken = tokens.find((token) => WRITE_OR_CONTROL_KEYWORDS.has(token));
  if (unsafeToken) {
    throw new HTTPException(400, { message: `报表 SQL 包含禁止关键字或函数：${unsafeToken}` });
  }
  return sql;
}

export function isReadonlyReportSql(input: string): boolean {
  try {
    normalizeReadonlyReportSql(input);
    return true;
  } catch {
    return false;
  }
}

const SENSITIVE_SCHEMAS = new Set(['information_schema', 'pg_catalog', 'pg_toast', 'sys', 'mysql', 'performance_schema']);
const FROM_TERMINATORS = new Set([
  'except', 'fetch', 'for', 'group', 'having', 'intersect', 'limit', 'offset',
  'order', 'qualify', 'returning', 'union', 'where', 'window',
]);

interface SqlToken {
  kind: 'identifier' | 'word' | 'symbol';
  value: string;
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replace(/""/g, '"');
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) return trimmed.slice(1, -1);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
}

function normalizeQualifiedIdentifier(value: string): string {
  return value.split('.').map((part) => unquoteIdentifier(part)).join('.').replace(/\s+/g, '').toLowerCase();
}

function tokenizeSqlStructure(input: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === '-' && next === '-') {
      index += 2;
      while (index < input.length && input[index] !== '\n') index++;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) index++;
      index = Math.min(input.length, index + 2);
      continue;
    }
    if (char === '\'') {
      index++;
      while (index < input.length) {
        if (input[index] === '\'' && input[index + 1] === '\'') {
          index += 2;
          continue;
        }
        if (input[index++] === '\'') break;
      }
      continue;
    }
    if (char === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(input.slice(index))?.[0];
      if (tag) {
        const end = input.indexOf(tag, index + tag.length);
        index = end < 0 ? input.length : end + tag.length;
        continue;
      }
    }
    if (char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char;
      let value = '';
      index++;
      while (index < input.length) {
        if (input[index] === close) {
          if (close !== ']' && input[index + 1] === close) {
            value += close;
            index += 2;
            continue;
          }
          index++;
          break;
        }
        value += input[index++];
      }
      tokens.push({ kind: 'identifier', value });
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(input.slice(index))?.[0];
    if (word) {
      tokens.push({ kind: 'word', value: word.toLowerCase() });
      index += word.length;
      continue;
    }
    if ('(),.'.includes(char)) tokens.push({ kind: 'symbol', value: char });
    index++;
  }
  return tokens;
}

function findClosingParenthesis(tokens: SqlToken[], openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index++) {
    if (tokens[index].value === '(') depth++;
    if (tokens[index].value === ')' && --depth === 0) return index;
  }
  return tokens.length - 1;
}

function extractCteNames(tokens: SqlToken[]): Set<string> {
  const names = new Set<string>();
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].value !== 'with') continue;
    let cursor = index + 1;
    if (tokens[cursor]?.value === 'recursive') cursor++;
    while (cursor < tokens.length) {
      const name = tokens[cursor];
      if (!name || name.kind === 'symbol') break;
      cursor++;
      if (tokens[cursor]?.value === '(') cursor = findClosingParenthesis(tokens, cursor) + 1;
      if (tokens[cursor]?.value !== 'as' || tokens[cursor + 1]?.value !== '(') break;
      names.add(name.value.toLowerCase());
      cursor = findClosingParenthesis(tokens, cursor + 1) + 1;
      if (tokens[cursor]?.value !== ',') break;
      cursor++;
    }
  }
  return names;
}

function readRelation(tokens: SqlToken[], start: number): { name: string | null; end: number } {
  let cursor = start;
  while (tokens[cursor]?.value === 'lateral' || tokens[cursor]?.value === 'only') cursor++;
  if (!tokens[cursor] || tokens[cursor].value === '(') return { name: null, end: cursor };
  if (tokens[cursor].kind === 'symbol') return { name: null, end: cursor };
  const parts = [tokens[cursor].value];
  cursor++;
  while (tokens[cursor]?.value === '.' && tokens[cursor + 1] && tokens[cursor + 1].kind !== 'symbol') {
    parts.push(tokens[cursor + 1].value);
    cursor += 2;
  }
  return { name: normalizeQualifiedIdentifier(parts.join('.')), end: cursor };
}

/** 提取 SELECT/WITH 中实际读取的表；CTE 名称会被排除。 */
export function extractReportSqlTableReferences(input: string): string[] {
  const sql = normalizeReadonlyReportSql(input);
  const tokens = tokenizeSqlStructure(sql);
  const ctes = extractCteNames(tokens);
  const tables = new Set<string>();
  const activeFromDepths = new Set<number>();
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.value === '(') {
      const previous = tokens[index - 1];
      const beginsTableGroup = previous?.value === 'from'
        || previous?.value === 'join'
        || (previous?.value === ',' && activeFromDepths.has(depth))
        || (previous?.value === '(' && activeFromDepths.has(depth));
      depth++;
      const next = tokens[index + 1];
      if (beginsTableGroup && next?.value !== 'select' && next?.value !== 'with') {
        activeFromDepths.add(depth);
        const relation = readRelation(tokens, index + 1);
        if (relation.name && !ctes.has(relation.name)) tables.add(relation.name);
      }
      continue;
    }
    if (token.value === ')') {
      activeFromDepths.delete(depth);
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (FROM_TERMINATORS.has(token.value)) activeFromDepths.delete(depth);
    const beginsRelation = token.value === 'from'
      || token.value === 'join'
      || (token.value === ',' && activeFromDepths.has(depth));
    if (!beginsRelation) continue;
    if (token.value === 'from') activeFromDepths.add(depth);
    const relation = readRelation(tokens, index + 1);
    if (relation.name && !ctes.has(relation.name)) tables.add(relation.name);
  }
  return [...tables];
}

/** ChatBI 的第二道 SQL 防火墙：禁止系统 schema/敏感表，并强制命中冻结 allowlist。 */
export function assertReportSqlTableAllowlist(input: string, allowedTables: readonly string[]): string {
  const sql = normalizeReadonlyReportSql(input);
  const sensitiveColumn = tokenizeSqlStructure(sql)
    .find((token) => token.kind !== 'symbol' && SENSITIVE_COLUMN_RE.test(token.value));
  if (sensitiveColumn) {
    throw new HTTPException(400, { message: `ChatBI SQL 禁止访问敏感字段：${sensitiveColumn.value}` });
  }
  const references = extractReportSqlTableReferences(sql);
  if (references.length === 0) {
    throw new HTTPException(400, { message: 'ChatBI SQL 必须读取已授权的数据表' });
  }
  const allowed = new Set(allowedTables.map((name) => normalizeQualifiedIdentifier(name)));
  for (const reference of references) {
    const parts = reference.split('.');
    const table = parts.at(-1)!;
    const schema = parts.length > 1 ? parts.at(-2)! : null;
    if ((schema && SENSITIVE_SCHEMAS.has(schema)) || isSensitiveTable(table)) {
      throw new HTTPException(400, { message: `ChatBI SQL 禁止访问敏感表：${reference}` });
    }
    if (!allowed.has(reference) && !allowed.has(table)) {
      throw new HTTPException(400, { message: `ChatBI SQL 访问了未授权的数据表：${reference}` });
    }
  }
  return sql;
}
