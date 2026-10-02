import '@arcbase/admin/styles.css';
import { ArcBaseAdmin, type ArcBaseAdminModule, type ArcBasePageProps } from '@arcbase/admin';
import { Client, call } from '@arcbase/client';
import { PermissionGuard } from '@arcbase/elements';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Table, Typography } from '@douyinfe/semi-ui';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hostPositionContract } from './contracts';
import { hostPermissions } from './permissions';

function Positions({ client }: ArcBasePageProps) {
  const cache = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const list = useQuery({ queryKey: ['host-positions', keyword], queryFn: ({ signal }) => call(client, hostPositionContract.list, { query: { keyword, page: 1, pageSize: 10 } }, { signal }) });
  const create = useMutation({ mutationFn: () => call(client, hostPositionContract.create, { body: { name, code } }), onSuccess: () => { setName(''); setCode(''); void cache.invalidateQueries({ queryKey: ['host-positions'] }); } });
  return <section style={{ padding: 24 }}>
    <Typography.Title heading={4}>岗位业务模块</Typography.Title>
    <Input placeholder="宿主岗位筛选" value={keyword} onChange={setKeyword} />
    <PermissionGuard permission={[hostPermissions.create, 'system:position:create']} mode="all"><div data-testid="host-create-action" style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
      <Input placeholder="宿主岗位名称" value={name} onChange={setName} /><Input placeholder="宿主岗位编码" value={code} onChange={setCode} />
      <Button onClick={() => create.mutate()} loading={create.isPending}>添加岗位</Button>
    </div></PermissionGuard>
    {(list.error || create.error) && <div role="alert">{(list.error || create.error)?.message}</div>}
    <Table dataSource={list.data?.list ?? []} rowKey="id" loading={list.isPending} pagination={false} columns={[{ title: '岗位名称', dataIndex: 'name' }, { title: '岗位编码', dataIndex: 'code' }]} />
  </section>;
}
const modules: ArcBaseAdminModule[] = [{ id: 'position-host', title: '宿主业务', icon: 'IconApps', pages: [{ id: 'positions', title: '岗位业务模块', path: '/extensions/position-host/positions', permission: 'system:position:list', component: Positions }] }];
const client = new Client({ operations: [hostPositionContract.list, hostPositionContract.create] });
createRoot(document.getElementById('root')!).render(<ArcBaseAdmin client={client} basePath={import.meta.env.BASE_URL} assetBasePath={`${import.meta.env.BASE_URL}arcbase-assets/`} modules={modules} brand={{ name: '独立宿主验收' }} />);
