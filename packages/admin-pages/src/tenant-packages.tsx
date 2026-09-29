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
  const client=useQueryClient();const [page,setPage]=useState(1);const [editing,setEditing]=useState<TenantPackage|null>(null);const [open,setOpen]=useState(false);const [form,setForm]=useState<Form>(empty);
  const list=useQuery({queryKey:['tenant-packages',page],queryFn:()=>operation<Paged>(tenantPackageContract.list,{query:{page,pageSize:10}})});
  const save=useMutation({mutationFn:()=>editing?operation<TenantPackage>(tenantPackageContract.update,{id:editing.id,body:form}):operation<TenantPackage>(tenantPackageContract.create,{body:form}),
    onSuccess:()=>{setOpen(false);void client.invalidateQueries({queryKey:['tenant-packages']});void client.invalidateQueries({queryKey:['package-options']});Toast.success('保存成功');},onError:error=>Toast.error(String(error))});
  const edit=(row:TenantPackage)=>{setEditing(row);setForm({name:row.name,status:row.status,remark:row.remark??'',quotas:row.quotas as Record<string,number>|null,features:row.features??[]});setOpen(true);};
  return <><PageHeader title="租户套餐" description="维护套餐及可授权功能范围" actions={<Button theme="solid" onClick={()=>{setEditing(null);setForm(empty);setOpen(true);}}>新增套餐</Button>}/>
    <div className="zenith-card"><Table<TenantPackage> rowKey="id" dataSource={list.data?.list??[]} loading={list.isLoading} pagination={{currentPage:page,pageSize:10,total:list.data?.total??0,onPageChange:setPage}} columns={[
      {title:'套餐名称',dataIndex:'name'},{title:'状态',dataIndex:'status',render:value=>value==='enabled'?'启用':'停用'},{title:'功能数量',dataIndex:'features',render:value=>Array.isArray(value)?value.length:0},
      {title:'操作',render:(_,row)=><Button theme="borderless" onClick={()=>edit(row)}>编辑</Button>},
    ]}/></div>
    <Modal title={editing?'编辑套餐':'新增套餐'} visible={open} onCancel={()=>setOpen(false)} onOk={()=>save.mutate()} okButtonProps={{loading:save.isPending}}>
      <div style={{display:'grid',gap:12}}><div className="zenith-form-row"><label>套餐名称</label><Input value={form.name} onChange={name=>setForm({...form,name})}/></div>
        <div className="zenith-form-row"><label>状态</label><Select value={form.status} onChange={value=>setForm({...form,status:value as Form['status']})} optionList={[{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]}/></div>
        <div className="zenith-form-row"><label>功能标识（逗号分隔）</label><Input value={form.features.join(',')} onChange={value=>setForm({...form,features:value.split(',').map(item=>item.trim()).filter(Boolean)})}/></div>
        <div className="zenith-form-row"><label>备注</label><Input value={form.remark} onChange={remark=>setForm({...form,remark})}/></div>
      </div>
    </Modal>
  </>;
}
