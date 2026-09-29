import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Table, Toast } from '@douyinfe/semi-ui';
import { tenantPackageContract, type TenantPackage } from '@zenith/shared/identity';
import { operation } from '@zenith/admin-client';
import { PageHeader } from '@zenith/admin-ui';

type Paged = { list: TenantPackage[]; total: number; page: number; pageSize: number };
type Form = { name: string; status: 'enabled' | 'disabled'; remark: string; quotas: Record<string, number> | null; features: string[] };
const empty: Form = { name:'',status:'enabled',remark:'',quotas:null,features:[] };

export function TenantPackagesPage() {
  const client=useQueryClient();const [page,setPage]=useState(1);const [keyword,setKeyword]=useState('');const [search,setSearch]=useState('');const [status,setStatus]=useState('');const [selectedIds,setSelectedIds]=useState<number[]>([]);const [editing,setEditing]=useState<TenantPackage|null>(null);const [open,setOpen]=useState(false);const [form,setForm]=useState<Form>(empty);
  const list=useQuery({queryKey:['tenant-packages',page,search,status],queryFn:()=>operation<Paged>(tenantPackageContract.list,{query:{page,pageSize:10,keyword:search,status}})});
  const save=useMutation({mutationFn:()=>editing?operation<TenantPackage>(tenantPackageContract.update,{id:editing.id,body:form}):operation<TenantPackage>(tenantPackageContract.create,{body:form}),
    onSuccess:()=>{setOpen(false);void client.invalidateQueries({queryKey:['tenant-packages']});void client.invalidateQueries({queryKey:['package-options']});Toast.success('保存成功');},onError:error=>Toast.error(String(error))});
  const remove=useMutation({mutationFn:(id:number)=>operation<null>(tenantPackageContract.remove,{id}),onSuccess:()=>{void client.invalidateQueries({queryKey:['tenant-packages']});void client.invalidateQueries({queryKey:['package-options']});Toast.success('已删除');},onError:error=>Toast.error(String(error))});
  const removeBatch=useMutation({mutationFn:()=>operation<null>(tenantPackageContract.removeBatch,{body:{ids:selectedIds}}),onSuccess:()=>{setSelectedIds([]);void client.invalidateQueries({queryKey:['tenant-packages']});void client.invalidateQueries({queryKey:['package-options']});Toast.success('已批量删除');},onError:error=>Toast.error(String(error))});
  const edit=(row:TenantPackage)=>{setEditing(row);setForm({name:row.name,status:row.status,remark:row.remark??'',quotas:row.quotas as Record<string,number>|null,features:row.features??[]});setOpen(true);};
  return <><PageHeader title="租户套餐" description="维护套餐及可授权功能范围" actions={<Button theme="solid" onClick={()=>{setEditing(null);setForm(empty);setOpen(true);}}>新增套餐</Button>}/>
    <div className="zenith-card"><div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}><Input placeholder="套餐名称" value={keyword} onChange={setKeyword} onEnterPress={()=>{setSearch(keyword);setPage(1);}} style={{width:200}}/><Select value={status} onChange={value=>{setStatus(String(value));setPage(1);}} style={{width:120}} optionList={[{label:'全部状态',value:''},{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]}/><Button onClick={()=>{setSearch(keyword);setPage(1);}}>查询</Button><Button onClick={()=>{setKeyword('');setSearch('');setStatus('');setPage(1);}}>重置</Button><Button type="danger" disabled={selectedIds.length===0} loading={removeBatch.isPending} onClick={()=>Modal.confirm({title:`删除选中的 ${selectedIds.length} 个套餐？`,content:'已绑定租户的套餐不可删除。',okType:'danger',onOk:()=>removeBatch.mutateAsync()})}>批量删除</Button></div>
      {list.isError && <p role="alert">{String(list.error)}</p>}
      <Table<TenantPackage> rowKey="id" dataSource={list.data?.list??[]} loading={list.isLoading} rowSelection={{selectedRowKeys:selectedIds,onChange:keys=>setSelectedIds(keys as number[])}} pagination={{currentPage:page,pageSize:10,total:list.data?.total??0,onPageChange:setPage}} columns={[
      {title:'套餐名称',dataIndex:'name'},{title:'状态',dataIndex:'status',render:value=>value==='enabled'?'启用':'停用'},{title:'功能数量',dataIndex:'features',render:value=>Array.isArray(value)?value.length:0},
      {title:'操作',render:(_,row)=><><Button theme="borderless" onClick={()=>edit(row)}>编辑</Button><Button theme="borderless" type="danger" onClick={()=>Modal.confirm({title:`删除套餐「${row.name}」？`,content:'已绑定租户的套餐不可删除。',okType:'danger',onOk:()=>remove.mutateAsync(row.id)})}>删除</Button></>},
    ]}/></div>
    <Modal title={editing?'编辑套餐':'新增套餐'} visible={open} onCancel={()=>setOpen(false)} onOk={()=>save.mutate()} okButtonProps={{loading:save.isPending}}>
      <div style={{display:'grid',gap:12}}><div className="zenith-form-row"><label>套餐名称</label><Input value={form.name} onChange={name=>setForm({...form,name})}/></div>
        <div className="zenith-form-row"><label>状态</label><Select value={form.status} onChange={value=>setForm({...form,status:value as Form['status']})} optionList={[{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]}/></div>
        <div className="zenith-form-row"><label>功能标识（逗号分隔）</label><Input value={form.features.join(',')} onChange={value=>setForm({...form,features:value.split(',').map(item=>item.trim()).filter(Boolean)})}/></div>
        <div className="zenith-form-row"><label>最大用户数（留空不限）</label><Input type="number" value={form.quotas?.maxUsers?.toString()??''} onChange={value=>setForm({...form,quotas:value?{maxUsers:Number(value)}:null})}/></div>
        <div className="zenith-form-row"><label>备注</label><Input value={form.remark} onChange={remark=>setForm({...form,remark})}/></div>
      </div>
    </Modal>
  </>;
}
