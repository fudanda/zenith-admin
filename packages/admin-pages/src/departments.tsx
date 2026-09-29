import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Table, Toast } from '@douyinfe/semi-ui';
import { departmentContract, type Department } from '@zenith/shared/identity';
import { operation } from '@zenith/admin-client';
import { useAuth } from '@zenith/admin-core';
import { PageHeader } from '@zenith/admin-ui';

type Form = { parentId:number; name:string; code:string; category:string; sort:number; status:'enabled'|'disabled' };
const empty:Form={parentId:0,name:'',code:'',category:'department',sort:0,status:'enabled'};

export function DepartmentsPage(){
  const {can}=useAuth();const client=useQueryClient();const [editing,setEditing]=useState<Department|null>(null);const [open,setOpen]=useState(false);const [form,setForm]=useState<Form>(empty);
  const rows=useQuery({queryKey:['departments'],queryFn:()=>operation<Department[]>(departmentContract.flat)});
  const save=useMutation({mutationFn:()=>editing?operation<Department>(departmentContract.update,{id:editing.id,body:form}):operation<Department>(departmentContract.create,{body:form}),
    onSuccess:()=>{setOpen(false);void client.invalidateQueries({queryKey:['departments']});Toast.success('保存成功');},onError:error=>Toast.error(String(error))});
  const remove=useMutation({mutationFn:(id:number)=>operation<null>(departmentContract.remove,{id}),onSuccess:()=>{void client.invalidateQueries({queryKey:['departments']});Toast.success('删除成功');},onError:error=>Toast.error(String(error))});
  const startEdit=(row:Department)=>{setEditing(row);setForm({parentId:row.parentId,name:row.name,code:row.code,category:row.category,sort:row.sort,status:row.status});setOpen(true);};
  return <><PageHeader title="部门管理" description="维护部门层级与负责人" actions={can('system:department:create')?<Button theme="solid" onClick={()=>{setEditing(null);setForm(empty);setOpen(true);}}>新增部门</Button>:null}/>
    <div className="zenith-card"><Table<Department> rowKey="id" dataSource={rows.data??[]} loading={rows.isLoading} pagination={false} columns={[
      {title:'部门名称',dataIndex:'name'},{title:'编码',dataIndex:'code'},{title:'上级部门',dataIndex:'parentId',render:value=>Number(value)===0?'根部门':rows.data?.find(item=>item.id===value)?.name??'—'},
      {title:'负责人',dataIndex:'leaderName',render:value=>value??'—'},{title:'成员',dataIndex:'userCount',render:value=>Number(value)},{title:'状态',dataIndex:'status',render:value=>value==='enabled'?'启用':'停用'},
      {title:'操作',render:(_,row)=><div style={{display:'flex',gap:8}}>{can('system:department:update')&&<Button theme="borderless" onClick={()=>startEdit(row)}>编辑</Button>}{can('system:department:delete')&&<Button theme="borderless" type="danger" onClick={()=>Modal.confirm({title:`删除部门「${row.name}」？`,onOk:()=>remove.mutateAsync(row.id)})}>删除</Button>}</div>},
    ]}/></div>
    <Modal title={editing?'编辑部门':'新增部门'} visible={open} onCancel={()=>setOpen(false)} onOk={()=>save.mutate()} okButtonProps={{loading:save.isPending}}><div style={{display:'grid',gap:12}}>
      <div className="zenith-form-row"><label>部门名称</label><Input value={form.name} onChange={name=>setForm({...form,name})}/></div>
      <div className="zenith-form-row"><label>编码</label><Input value={form.code} onChange={code=>setForm({...form,code})}/></div>
      <div className="zenith-form-row"><label>上级部门</label><Select value={form.parentId} onChange={value=>setForm({...form,parentId:Number(value)})} optionList={[{label:'根部门',value:0},...(rows.data??[]).filter(item=>item.id!==editing?.id).map(item=>({label:item.name,value:item.id}))]}/></div>
      <div className="zenith-form-row"><label>排序</label><Input type="number" value={String(form.sort)} onChange={value=>setForm({...form,sort:Number(value)})}/></div>
      <div className="zenith-form-row"><label>状态</label><Select value={form.status} onChange={value=>setForm({...form,status:value as Form['status']})} optionList={[{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]}/></div>
    </div></Modal>
  </>;
}
