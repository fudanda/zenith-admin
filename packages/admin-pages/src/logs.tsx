import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Input, Button, Select, Table, Toast } from '@douyinfe/semi-ui';
import { loginLogContract } from '@zenith/shared/identity';
import { operationLogContract } from '@zenith/shared/platform';
import { downloadOperation, request } from '@zenith/admin-client';
import { PageHeader } from '@zenith/admin-ui';

type Paged<T> = { list: T[]; total: number; page: number; pageSize: number };
type LoginRow = { id: number; userId: number | null; username: string; ip: string | null; eventType: string; status: string; message: string | null; createdAt: string };
type AuditRow = { id: number; actorId: number; operation: string; resource: string; resourceId: number | null; requestId: string; createdAt: string };
type LogSearch = { userId: string; keyword: string; status: string; startTime: string; endTime: string };
const emptySearch: LogSearch = { userId: '', keyword: '', status: '', startTime: '', endTime: '' };

function queryString(page: number, search: LogSearch, kind: 'login' | 'audit') {
  const query = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (search.userId) query.set('userId', search.userId);
  if (search.keyword) query.set(kind === 'login' ? 'username' : 'module', search.keyword);
  if (kind === 'login' && search.status) query.set('status', search.status);
  if (search.startTime) query.set('startTime', search.startTime);
  if (search.endTime) query.set('endTime', search.endTime);
  return query.toString();
}

function saveCSV(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function SearchBar({ draft, setDraft, onSearch, onReset, onExport, exporting, kind }: {
  draft: LogSearch;
  setDraft: (value: LogSearch) => void;
  onSearch: () => void;
  onReset: () => void;
  onExport: () => void;
  exporting: boolean;
  kind: 'login' | 'audit';
}) {
  const update = (key: keyof LogSearch, value: string) => setDraft({ ...draft, [key]: value });
  return <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
    <Input placeholder="用户 ID" value={draft.userId} onChange={value => update('userId', value)} style={{ width: 110 }}/>
    <Input placeholder={kind === 'login' ? '用户名' : '资源模块'} value={draft.keyword} onChange={value => update('keyword', value)} onEnterPress={onSearch} style={{ width: 180 }}/>
    {kind === 'login' && <Select value={draft.status} onChange={value => update('status', String(value))} style={{ width: 115 }} optionList={[{ label: '全部结果', value: '' }, { label: '成功', value: 'success' }, { label: '失败', value: 'fail' }]}/>}
    <Input placeholder="开始 YYYY-MM-DD" value={draft.startTime} onChange={value => update('startTime', value)} style={{ width: 160 }}/>
    <Input placeholder="结束 YYYY-MM-DD" value={draft.endTime} onChange={value => update('endTime', value)} style={{ width: 160 }}/>
    <Button onClick={onSearch}>查询</Button>
    <Button onClick={onReset}>重置</Button>
    <Button loading={exporting} onClick={onExport}>导出 CSV</Button>
  </div>;
}

function useLogSearch() {
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<LogSearch>(emptySearch);
  const [search, setSearch] = useState<LogSearch>(emptySearch);
  const submit = () => { setSearch({ ...draft }); setPage(1); };
  const reset = () => { setDraft(emptySearch); setSearch(emptySearch); setPage(1); };
  return { page, setPage, draft, setDraft, search, submit, reset };
}

export function LoginLogsPage() {
  const state = useLogSearch();
  const rows = useQuery({ queryKey: ['login-logs', state.page, state.search], queryFn: () => request<Paged<LoginRow>>(`/login-logs?${queryString(state.page, state.search, 'login')}`) });
  const exporting = useMutation({ mutationFn: () => downloadOperation(loginLogContract.exportCsv, { query: { userId: state.search.userId, username: state.search.keyword, status: state.search.status, startTime: state.search.startTime, endTime: state.search.endTime } }), onSuccess: blob => saveCSV(blob, 'login-logs.csv'), onError: error => Toast.error(String(error)) });
  return <><PageHeader title="登录日志" description="查看真实的登录成功和失败记录"/><div className="zenith-card">
    <SearchBar draft={state.draft} setDraft={state.setDraft} onSearch={state.submit} onReset={state.reset} onExport={() => exporting.mutate()} exporting={exporting.isPending} kind="login"/>
    <Table<LoginRow> rowKey="id" dataSource={rows.data?.list ?? []} loading={rows.isLoading} pagination={{ currentPage: state.page, pageSize: 10, total: rows.data?.total ?? 0, onPageChange: state.setPage }} columns={[
      { title: '用户 ID', dataIndex: 'userId' }, { title: '用户名', dataIndex: 'username' }, { title: 'IP', dataIndex: 'ip' },
      { title: '结果', dataIndex: 'status', render: value => value === 'success' ? '成功' : '失败' },
      { title: '说明', dataIndex: 'message' }, { title: '时间', dataIndex: 'createdAt', render: value => new Date(String(value)).toLocaleString() },
    ]}/>
  </div></>;
}

export function OperationLogsPage() {
  const state = useLogSearch();
  const rows = useQuery({ queryKey: ['operation-logs', state.page, state.search], queryFn: () => request<Paged<AuditRow>>(`/operation-logs?${queryString(state.page, state.search, 'audit')}`) });
  const exporting = useMutation({ mutationFn: () => downloadOperation(operationLogContract.exportCsv, { query: { userId: state.search.userId, module: state.search.keyword, startTime: state.search.startTime, endTime: state.search.endTime } }), onSuccess: blob => saveCSV(blob, 'operation-logs.csv'), onError: error => Toast.error(String(error)) });
  return <><PageHeader title="操作审计" description="查看基础领域的实际写入审计"/><div className="zenith-card">
    <SearchBar draft={state.draft} setDraft={state.setDraft} onSearch={state.submit} onReset={state.reset} onExport={() => exporting.mutate()} exporting={exporting.isPending} kind="audit"/>
    <Table<AuditRow> rowKey="id" dataSource={rows.data?.list ?? []} loading={rows.isLoading} pagination={{ currentPage: state.page, pageSize: 10, total: rows.data?.total ?? 0, onPageChange: state.setPage }} columns={[
      { title: '操作人 ID', dataIndex: 'actorId' }, { title: '操作', dataIndex: 'operation' }, { title: '资源', dataIndex: 'resource' }, { title: '资源 ID', dataIndex: 'resourceId' },
      { title: '时间', dataIndex: 'createdAt', render: value => new Date(String(value)).toLocaleString() },
    ]}/>
  </div></>;
}
