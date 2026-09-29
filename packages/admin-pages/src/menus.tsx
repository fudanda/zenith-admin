import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Switch, Table, Toast } from '@douyinfe/semi-ui';
import { menuContract, type Menu } from '@zenith/shared/identity';
import { operation } from '@zenith/admin-client';
import { useAuth } from '@zenith/admin-core';
import { firstReleaseModules } from '@zenith/admin-modules';
import { PageHeader } from '@zenith/admin-ui';

type MenuForm = {
  parentId: number; title: string; name: string; path: string; component: string; icon: string;
  type: 'directory' | 'menu' | 'button'; permission: string; query: string | null;
  isExternal: boolean; embed: boolean; keepAlive: boolean; sort: number;
  status: 'enabled' | 'disabled'; visible: boolean;
};
const blank: MenuForm = {
  parentId: 0, title: '', name: '', path: '', component: '', icon: '', type: 'menu',
  permission: '', query: null, isExternal: false, embed: false, keepAlive: false,
  sort: 0, status: 'enabled', visible: true,
};
const rowToForm = (row: Menu): MenuForm => ({
  parentId: row.parentId, title: row.title, name: row.name ?? '', path: row.path ?? '',
  component: row.component ?? '', icon: row.icon ?? '', type: row.type,
  permission: row.permission ?? '', query: row.query ?? null, isExternal: row.isExternal ?? false,
  embed: row.embed ?? false, keepAlive: row.keepAlive ?? false, sort: row.sort,
  status: row.status, visible: row.visible,
});

export function MenusPage() {
  const { can } = useAuth();
  const cache = useQueryClient();
  const [editing, setEditing] = useState<Menu | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<MenuForm>(blank);
  const menus = useQuery({ queryKey: ['menus-flat'], queryFn: () => operation<Menu[]>(menuContract.flat) });
  const rows = menus.data ?? [];
  const canEdit = can('platform');
  const save = useMutation({
    mutationFn: async () => {
      const schema = editing ? menuContract.update.body : menuContract.create.body;
      const parsed = schema?.safeParse(form);
      if (parsed && !parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '表单无效');
      return editing
        ? operation<Menu>(menuContract.update, { id: editing.id, body: form })
        : operation<Menu>(menuContract.create, { body: form });
    },
    onSuccess: () => {
      setOpen(false);
      void cache.invalidateQueries({ queryKey: ['menus-flat'] });
      void cache.invalidateQueries({ queryKey: ['menus-user'] });
      Toast.success('菜单已保存');
    },
    onError: error => Toast.error(String(error)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => operation<null>(menuContract.remove, { id }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['menus-flat'] });
      void cache.invalidateQueries({ queryKey: ['menus-user'] });
      Toast.success('菜单已删除');
    },
    onError: error => Toast.error(String(error)),
  });
  const parents = rows.filter(row => row.type !== 'button' && row.id !== editing?.id);
  const permissions = [...new Set(rows.map(row => row.permission).filter((code): code is string => !!code))].sort();
  const pagePaths = [...new Set(firstReleaseModules.map(item => item.path))];
  return <>
    <PageHeader title="菜单管理" description="管理首版页面、目录与按钮权限；未迁移页面不能作为菜单路径"
      actions={canEdit && can('system:menu:create') ? <Button theme="solid" onClick={() => { setEditing(null); setForm(blank); setOpen(true); }}>新增菜单</Button> : null}/>
    <div className="zenith-card">
      {menus.isError && <p>加载失败：{String(menus.error)}</p>}
      <Table<Menu> rowKey="id" dataSource={rows} loading={menus.isLoading} pagination={{ pageSize: 20 }}
        columns={[
          { title: '标题', dataIndex: 'title' },
          { title: '类型', dataIndex: 'type', render: value => ({ directory: '目录', menu: '页面', button: '按钮' }[String(value)] ?? String(value)) },
          { title: '上级', dataIndex: 'parentId', render: value => Number(value) === 0 ? '根' : rows.find(row => row.id === Number(value))?.title ?? String(value) },
          { title: '路径 / 权限', render: (_, row) => row.path || row.permission || '—' },
          { title: '排序', dataIndex: 'sort' },
          { title: '状态', dataIndex: 'status', render: value => value === 'enabled' ? '启用' : '停用' },
          { title: '操作', render: (_, row) => <div style={{ display: 'flex', gap: 8 }}>
            {canEdit && can('system:menu:update') && <Button theme="borderless" onClick={() => { setEditing(row); setForm(rowToForm(row)); setOpen(true); }}>编辑</Button>}
            {canEdit && can('system:menu:delete') && <Button theme="borderless" type="danger" onClick={() => Modal.confirm({
              title: `删除菜单「${row.title}」及其子菜单？`, content: '已分配给普通角色或账号的菜单不能删除。',
              okType: 'danger', onOk: () => remove.mutateAsync(row.id),
            })}>删除</Button>}
          </div> },
        ]}/>
    </div>
    <Modal title={editing ? '编辑菜单' : '新增菜单'} visible={open} onCancel={() => setOpen(false)}
      onOk={() => save.mutate()} okButtonProps={{ loading: save.isPending }} width={660}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="zenith-form-row"><label>标题</label><Input value={form.title} onChange={title => setForm({ ...form, title })}/></div>
        <div className="zenith-form-row"><label>标识</label><Input value={form.name} onChange={name => setForm({ ...form, name })}/></div>
        <div className="zenith-form-row"><label>类型</label><Select value={form.type} onChange={value => setForm({ ...form, type: value as MenuForm['type'] })}
          optionList={[{ label: '目录', value: 'directory' }, { label: '页面', value: 'menu' }, { label: '按钮', value: 'button' }]}/></div>
        <div className="zenith-form-row"><label>上级菜单</label><Select filter value={form.parentId} onChange={value => setForm({ ...form, parentId: Number(value) })}
          optionList={[{ label: '根', value: 0 }, ...parents.map(row => ({ label: row.title, value: row.id }))]}/></div>
        {form.type === 'menu' && <div className="zenith-form-row"><label>页面路径</label><Select filter value={form.path} onChange={value => setForm({ ...form, path: String(value) })}
          optionList={[{ label: '无路径', value: '' }, ...pagePaths.map(path => ({ label: path, value: path }))]}/></div>}
        {form.type === 'button' && <div className="zenith-form-row"><label>权限码</label><Select filter value={form.permission} onChange={value => setForm({ ...form, permission: String(value) })}
          optionList={permissions.map(code => ({ label: code, value: code }))}/></div>}
        <div className="zenith-form-row"><label>图标</label><Input value={form.icon} onChange={icon => setForm({ ...form, icon })}/></div>
        <div className="zenith-form-row"><label>组件</label><Input value={form.component} onChange={component => setForm({ ...form, component })}/></div>
        <div className="zenith-form-row"><label>排序</label><Input type="number" value={String(form.sort)} onChange={sort => setForm({ ...form, sort: Number(sort) })}/></div>
        <div className="zenith-form-row"><label>状态</label><Select value={form.status} onChange={value => setForm({ ...form, status: value as MenuForm['status'] })}
          optionList={[{ label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]}/></div>
        <div className="zenith-form-row"><label>导航显示</label><Switch checked={form.visible} onChange={visible => setForm({ ...form, visible })}/></div>
        <div className="zenith-form-row"><label>页面缓存</label><Switch checked={form.keepAlive} onChange={keepAlive => setForm({ ...form, keepAlive })}/></div>
      </div>
    </Modal>
  </>;
}
