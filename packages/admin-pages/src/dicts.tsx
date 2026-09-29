import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Table, Toast } from '@douyinfe/semi-ui';
import { dictContract, type Dict, type DictItem } from '@zenith/shared/platform';
import { downloadOperation, operation } from '@zenith/admin-client';
import { useAuth } from '@zenith/admin-core';
import { PageHeader } from '@zenith/admin-ui';

type Paged = { list: Dict[]; total: number; page: number; pageSize: number };
type DictForm = { name: string; code: string; description: string; status: 'enabled' | 'disabled' };
type ItemForm = { label: string; value: string; color: string; sort: number; status: 'enabled' | 'disabled' };
const blankDict: DictForm = { name: '', code: '', description: '', status: 'enabled' };
const blankItem: ItemForm = { label: '', value: '', color: '', sort: 0, status: 'enabled' };

export function DictsPage() {
  const { can } = useAuth(); const cache = useQueryClient();
  const [page, setPage] = useState(1); const [keyword, setKeyword] = useState(''); const [search, setSearch] = useState('');
  const [status, setStatus] = useState(''); const [startDate, setStartDate] = useState(''); const [endDate, setEndDate] = useState('');
  const [range, setRange] = useState({ startDate: '', endDate: '' });
  const [editing, setEditing] = useState<Dict | null>(null); const [open, setOpen] = useState(false); const [form, setForm] = useState<DictForm>(blankDict);
  const [selected, setSelected] = useState<Dict | null>(null); const [editingItem, setEditingItem] = useState<DictItem | null>(null); const [itemOpen, setItemOpen] = useState(false); const [itemForm, setItemForm] = useState<ItemForm>(blankItem);
  const list = useQuery({ queryKey: ['dicts', page, search, status, range], queryFn: () => operation<Paged>(dictContract.list, { query: { page, pageSize: 10, keyword: search, status, ...range } }) });
  const exportCsv = useMutation({ mutationFn: () => downloadOperation(dictContract.exportCsv, { query: { keyword: search, status, ...range } }), onSuccess: blob => {
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'dicts.csv'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, onError: error => Toast.error(String(error)) });
  const items = useQuery({ queryKey: ['dict-items', selected?.id], queryFn: () => operation<DictItem[]>(dictContract.items, { id: selected!.id }), enabled: selected !== null });
  const save = useMutation({ mutationFn: () => editing ? operation<Dict>(dictContract.update, { id: editing.id, body: form }) : operation<Dict>(dictContract.create, { body: form }), onSuccess: () => { setOpen(false); void cache.invalidateQueries({ queryKey: ['dicts'] }); Toast.success('保存成功'); }, onError: error => Toast.error(String(error)) });
  const remove = useMutation({ mutationFn: (id: number) => operation<null>(dictContract.remove, { id }), onSuccess: () => { void cache.invalidateQueries({ queryKey: ['dicts'] }); Toast.success('已删除'); }, onError: error => Toast.error(String(error)) });
  const saveItem = useMutation({ mutationFn: () => {
    const body = { ...itemForm, color: itemForm.color || null };
    return editingItem ? operation<DictItem>(dictContract.updateItem, { params: { id: selected!.id, itemId: editingItem.id }, body }) : operation<DictItem>(dictContract.createItem, { id: selected!.id, body });
  }, onSuccess: () => { setItemOpen(false); void cache.invalidateQueries({ queryKey: ['dict-items'] }); Toast.success('字典项已保存'); }, onError: error => Toast.error(String(error)) });
  const removeItem = useMutation({ mutationFn: (id: number) => operation<null>(dictContract.removeItem, { params: { id: selected!.id, itemId: id } }), onSuccess: () => { void cache.invalidateQueries({ queryKey: ['dict-items'] }); Toast.success('字典项已删除'); }, onError: error => Toast.error(String(error)) });
  const applyFilters = () => { setSearch(keyword); setRange({ startDate, endDate }); setPage(1); };
  return <><PageHeader title="字典管理" description="维护业务枚举与字典项" actions={can('system:dict:create') ? <Button theme="solid" onClick={() => { setEditing(null); setForm(blankDict); setOpen(true); }}>新增字典</Button> : null}/>
    <div className="zenith-card"><div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      <Input placeholder="名称或编码" value={keyword} onChange={setKeyword} onEnterPress={applyFilters} style={{ width: 200 }}/>
      <Select value={status} onChange={value => { setStatus(String(value)); setPage(1); }} style={{ width: 120 }} optionList={[{ label: '全部状态', value: '' }, { label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]}/>
      <Input placeholder="开始 YYYY-MM-DD" value={startDate} onChange={setStartDate} style={{ width: 160 }}/>
      <Input placeholder="结束 YYYY-MM-DD" value={endDate} onChange={setEndDate} style={{ width: 160 }}/>
      <Button onClick={applyFilters}>查询</Button><Button onClick={() => { setKeyword(''); setSearch(''); setStatus(''); setStartDate(''); setEndDate(''); setRange({ startDate: '', endDate: '' }); setPage(1); }}>重置</Button>
      {can('system:dict:list') && <Button loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}>导出 CSV</Button>}
    </div>
      {list.isError && <p role="alert">{String(list.error)}</p>}
      <Table<Dict> rowKey="id" dataSource={list.data?.list ?? []} loading={list.isLoading} pagination={{ currentPage: page, pageSize: 10, total: list.data?.total ?? 0, onPageChange: setPage }} columns={[
        { title: '名称', dataIndex: 'name' }, { title: '编码', dataIndex: 'code' }, { title: '状态', dataIndex: 'status', render: value => value === 'enabled' ? '启用' : '停用' },
        { title: '操作', render: (_, row) => <div style={{ display: 'flex', gap: 4 }}><Button theme="borderless" onClick={() => setSelected(row)}>字典项</Button>{can('system:dict:update') && <Button theme="borderless" onClick={() => { setEditing(row); setForm({ name: row.name, code: row.code, description: row.description ?? '', status: row.status }); setOpen(true); }}>编辑</Button>}{can('system:dict:delete') && <Button theme="borderless" type="danger" onClick={() => Modal.confirm({ title: `删除字典「${row.name}」及其字典项？`, onOk: () => remove.mutateAsync(row.id) })}>删除</Button>}</div> },
      ]}/></div>
    <Modal title={editing ? '编辑字典' : '新增字典'} visible={open} onCancel={() => setOpen(false)} onOk={() => save.mutate()} okButtonProps={{ loading: save.isPending }}><div style={{ display: 'grid', gap: 12 }}>
      <div className="zenith-form-row"><label>名称</label><Input value={form.name} onChange={name => setForm({ ...form, name })}/></div>
      <div className="zenith-form-row"><label>编码</label><Input value={form.code} onChange={code => setForm({ ...form, code })}/></div>
      <div className="zenith-form-row"><label>说明</label><Input value={form.description} onChange={description => setForm({ ...form, description })}/></div>
      <div className="zenith-form-row"><label>状态</label><Select value={form.status} onChange={value => setForm({ ...form, status: value as DictForm['status'] })} optionList={[{ label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]}/></div>
    </div></Modal>
    <Modal title={`字典项 · ${selected?.name ?? ''}`} visible={selected !== null} onCancel={() => setSelected(null)} footer={null} width={760}><div style={{ marginBottom: 12 }}>{can('system:dict:item') && <Button theme="solid" onClick={() => { setEditingItem(null); setItemForm(blankItem); setItemOpen(true); }}>新增字典项</Button>}</div><Table<DictItem> rowKey="id" dataSource={items.data ?? []} loading={items.isLoading} pagination={false} columns={[
      { title: '标签', dataIndex: 'label' }, { title: '值', dataIndex: 'value' }, { title: '排序', dataIndex: 'sort' }, { title: '状态', dataIndex: 'status', render: value => value === 'enabled' ? '启用' : '停用' },
      { title: '操作', render: (_, row) => can('system:dict:item') ? <div style={{ display: 'flex', gap: 4 }}><Button theme="borderless" onClick={() => { setEditingItem(row); setItemForm({ label: row.label, value: row.value, color: row.color ?? '', sort: row.sort, status: row.status }); setItemOpen(true); }}>编辑</Button><Button theme="borderless" type="danger" onClick={() => Modal.confirm({ title: `删除字典项「${row.label}」？`, onOk: () => removeItem.mutateAsync(row.id) })}>删除</Button></div> : null },
    ]}/></Modal>
    <Modal title={editingItem ? '编辑字典项' : '新增字典项'} visible={itemOpen} onCancel={() => setItemOpen(false)} onOk={() => saveItem.mutate()} okButtonProps={{ loading: saveItem.isPending }}><div style={{ display: 'grid', gap: 12 }}>
      <div className="zenith-form-row"><label>标签</label><Input value={itemForm.label} onChange={label => setItemForm({ ...itemForm, label })}/></div>
      <div className="zenith-form-row"><label>值</label><Input value={itemForm.value} onChange={value => setItemForm({ ...itemForm, value })}/></div>
      <div className="zenith-form-row"><label>颜色</label><Input value={itemForm.color} onChange={color => setItemForm({ ...itemForm, color })}/></div>
      <div className="zenith-form-row"><label>排序</label><Input type="number" value={String(itemForm.sort)} onChange={value => setItemForm({ ...itemForm, sort: Number(value) })}/></div>
      <div className="zenith-form-row"><label>状态</label><Select value={itemForm.status} onChange={value => setItemForm({ ...itemForm, status: value as ItemForm['status'] })} optionList={[{ label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]}/></div>
    </div></Modal>
  </>;
}
