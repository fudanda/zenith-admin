import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Table, Toast } from '@douyinfe/semi-ui';
import { tenantContract, tenantPackageContract, type Tenant, type TenantPackageOption } from '@zenith/shared/identity';
import { downloadOperation, operation } from '@zenith/admin-client';
import { PageHeader } from '@zenith/admin-ui';

type Paged = { list: Tenant[]; total: number; page: number; pageSize: number };
type Form = { name: string; code: string; status: 'enabled' | 'disabled'; contactName: string; contactPhone: string; maxUsers: number | null; packageId: number | null; remark: string };
const empty: Form = { name: '', code: '', status: 'enabled', contactName: '', contactPhone: '', maxUsers: null, packageId: null, remark: '' };

export function TenantsPage() {
  const client = useQueryClient(); const [page,setPage] = useState(1); const [keyword,setKeyword] = useState(''); const [search,setSearch] = useState(''); const [status,setStatus] = useState('');
  const [editing,setEditing] = useState<Tenant | null>(null); const [open,setOpen] = useState(false); const [form,setForm] = useState<Form>(empty);
  const list = useQuery({ queryKey: ['tenants', page, search, status], queryFn: () => operation<Paged>(tenantContract.list, { query: { page, pageSize: 10, keyword: search, status } }) });
  const exportCsv = useMutation({ mutationFn: () => downloadOperation(tenantContract.exportCsv, { query: { keyword: search, status } }), onSuccess: blob => {
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'tenants.csv'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, onError: error => Toast.error(String(error)) });
  const packages = useQuery({ queryKey: ['package-options'], queryFn: () => operation<TenantPackageOption[]>(tenantPackageContract.all) });
  const save = useMutation({ mutationFn: () => editing ? operation<Tenant>(tenantContract.update,{ id: editing.id, body: form }) : operation<Tenant>(tenantContract.create,{ body: form }),
    onSuccess: () => { setOpen(false); void client.invalidateQueries({ queryKey: ['tenants'] }); void client.invalidateQueries({ queryKey: ['tenant-options'] }); Toast.success('保存成功'); }, onError: error => Toast.error(String(error)) });
  const create = () => { setEditing(null); setForm(empty); setOpen(true); };
  const edit = (row: Tenant) => { setEditing(row); setForm({ name: row.name, code: row.code, status: row.status, contactName: row.contactName ?? '', contactPhone: row.contactPhone ?? '', maxUsers: row.maxUsers ?? null, packageId: row.packageId ?? null, remark: row.remark ?? '' }); setOpen(true); };
  return <><PageHeader title="租户管理" description="维护租户状态、套餐和用户配额" actions={<Button theme="solid" onClick={create}>新增租户</Button>}/>
    <div className="zenith-card"><div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}><Input placeholder="搜索租户名称或编码" value={keyword} onChange={setKeyword} onEnterPress={() => {setSearch(keyword);setPage(1);}} style={{width:240}}/><Select value={status} onChange={value=>{setStatus(String(value));setPage(1);}} style={{width:120}} optionList={[{label:'全部状态',value:''},{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]}/><Button onClick={() => {setSearch(keyword);setPage(1);}}>查询</Button><Button onClick={()=>{setKeyword('');setSearch('');setStatus('');setPage(1);}}>重置</Button><Button loading={exportCsv.isPending} onClick={()=>exportCsv.mutate()}>导出 CSV</Button></div>
      {list.isError && <p role="alert">{String(list.error)}</p>}
      <Table<Tenant> rowKey="id" dataSource={list.data?.list ?? []} loading={list.isLoading} pagination={{ currentPage:page,pageSize:10,total:list.data?.total ?? 0,onPageChange:setPage }} columns={[
        { title:'名称',dataIndex:'name' },{ title:'编码',dataIndex:'code' },{ title:'状态',dataIndex:'status',render:value=>value==='enabled'?'启用':'停用' },
        { title:'套餐',dataIndex:'packageId',render:value=>packages.data?.find(item=>item.id===value)?.name ?? '无限制' },
        { title:'用户上限',dataIndex:'maxUsers',render:value=>value ?? '无限制' },
        { title:'操作',render:(_,row)=><Button theme="borderless" onClick={()=>edit(row)}>编辑</Button> },
      ]}/></div>
    <Modal title={editing?'编辑租户':'新增租户'} visible={open} onCancel={()=>setOpen(false)} onOk={()=>save.mutate()} okButtonProps={{loading:save.isPending}}>
      <div style={{display:'grid',gap:12}}>
        <div className="zenith-form-row"><label>租户名称</label><Input value={form.name} onChange={name=>setForm({...form,name})}/></div>
        <div className="zenith-form-row"><label>租户编码</label><Input value={form.code} onChange={code=>setForm({...form,code})}/></div>
        <div className="zenith-form-row"><label>状态</label><Select value={form.status} onChange={value=>setForm({...form,status:value as Form['status']})} optionList={[{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]}/></div>
        <div className="zenith-form-row"><label>套餐</label><Select value={form.packageId ?? 0} onChange={value=>setForm({...form,packageId:Number(value)||null})} optionList={[{label:'无限制',value:0},...(packages.data ?? []).map(item=>({label:item.name,value:item.id}))]}/></div>
        <div className="zenith-form-row"><label>联系人</label><Input value={form.contactName} onChange={contactName=>setForm({...form,contactName})}/></div>
        <div className="zenith-form-row"><label>联系电话</label><Input value={form.contactPhone} onChange={contactPhone=>setForm({...form,contactPhone})}/></div>
        <div className="zenith-form-row"><label>用户上限（留空不限）</label><Input type="number" value={form.maxUsers?.toString() ?? ''} onChange={value=>setForm({...form,maxUsers:value?Number(value):null})}/></div>
        <div className="zenith-form-row"><label>备注</label><Input value={form.remark} onChange={remark=>setForm({...form,remark})}/></div>
      </div>
    </Modal>
  </>;
}
