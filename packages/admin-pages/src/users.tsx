import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Table, Toast } from '@douyinfe/semi-ui';
import { userContract, departmentContract, positionContract, menuContract, type User, type Department, type Position, type Menu } from '@zenith/shared/identity';
import { operation } from '@zenith/admin-client';
import { useAuth } from '@zenith/admin-core';
import { PageHeader } from '@zenith/admin-ui';

type Paged = { list: User[]; total:number; page:number; pageSize:number };
type Form = { username:string;nickname:string;password:string;email:string;departmentId:number|null;positionIds:number[];status:'enabled'|'disabled' };
const empty:Form={username:'',nickname:'',password:'',email:'',departmentId:null,positionIds:[],status:'enabled'};

export function UsersPage(){
  const {can}=useAuth();const client=useQueryClient();const [page,setPage]=useState(1);const [keyword,setKeyword]=useState('');const [search,setSearch]=useState('');
  const [editing,setEditing]=useState<User|null>(null);const [open,setOpen]=useState(false);const [form,setForm]=useState<Form>(empty);
  const [resetUser,setResetUser]=useState<User|null>(null);const [newPassword,setNewPassword]=useState('');
  const [permissionUser,setPermissionUser]=useState<User|null>(null);const [directMenuIds,setDirectMenuIds]=useState<number[]>([]);
  const [scopeUser,setScopeUser]=useState<User|null>(null);const [dataScope,setDataScope]=useState<string|null>(null);const [deptScopeIds,setDeptScopeIds]=useState<number[]>([]);
  const list=useQuery({queryKey:['users',page,search],queryFn:()=>operation<Paged>(userContract.list,{query:{page,pageSize:10,keyword:search}})});
  const departments=useQuery({queryKey:['departments'],queryFn:()=>operation<Department[]>(departmentContract.flat)});
  const positions=useQuery({queryKey:['positions-all'],queryFn:()=>operation<Position[]>(positionContract.all)});
  const menus=useQuery({queryKey:['menus-flat'],queryFn:()=>operation<Menu[]>(menuContract.flat),enabled:permissionUser!==null&&can('system:menu:list')});
  const menuGrants=useQuery({queryKey:['user-menus',permissionUser?.id],queryFn:()=>operation<{directMenuIds:number[];roleMenuIds:number[]}>(userContract.menus,{id:permissionUser!.id}),enabled:permissionUser!==null});
  const scope=useQuery({queryKey:['user-data-permission',scopeUser?.id],queryFn:()=>operation<{userDataScope:string|null;deptScopeIds:number[]}>(userContract.dataPermission,{id:scopeUser!.id}),enabled:scopeUser!==null});
  useEffect(()=>{if(menuGrants.data)setDirectMenuIds(menuGrants.data.directMenuIds);},[menuGrants.data]);
  useEffect(()=>{if(scope.data){setDataScope(scope.data.userDataScope);setDeptScopeIds(scope.data.deptScopeIds);}},[scope.data]);
  const save=useMutation({mutationFn:()=>editing?operation<User>(userContract.update,{id:editing.id,body:{username:form.username,nickname:form.nickname,email:form.email,departmentId:form.departmentId,positionIds:form.positionIds,status:form.status}}):operation<User>(userContract.create,{body:form}),
    onSuccess:()=>{setOpen(false);void client.invalidateQueries({queryKey:['users']});void client.invalidateQueries({queryKey:['users-all']});Toast.success('保存成功');},onError:error=>Toast.error(String(error))});
  const remove=useMutation({mutationFn:(id:number)=>operation<null>(userContract.remove,{id}),onSuccess:()=>{void client.invalidateQueries({queryKey:['users']});Toast.success('已删除');},onError:error=>Toast.error(String(error))});
  const reset=useMutation({mutationFn:()=>operation<null>(userContract.resetPassword,{id:resetUser!.id,body:{password:newPassword}}),onSuccess:()=>{setResetUser(null);setNewPassword('');Toast.success('密码已重置，原会话已下线');},onError:error=>Toast.error(String(error))});
  const assignMenus=useMutation({mutationFn:()=>operation<null>(userContract.assignMenus,{id:permissionUser!.id,body:{menuIds:directMenuIds}}),onSuccess:()=>{setPermissionUser(null);void client.invalidateQueries({queryKey:['user-menus']});Toast.success('直接授权已更新');},onError:error=>Toast.error(String(error))});
  const saveScope=useMutation({mutationFn:()=>operation<null>(userContract.updateDataPermission,{id:scopeUser!.id,body:{dataScope,deptScopeIds:dataScope==='custom'?deptScopeIds:[]}}),onSuccess:()=>{setScopeUser(null);void client.invalidateQueries({queryKey:['user-data-permission']});Toast.success('数据范围已更新');},onError:error=>Toast.error(String(error))});
  const edit=(row:User)=>{setEditing(row);setForm({username:row.username,nickname:row.nickname,password:'',email:row.email??'',departmentId:row.departmentId??null,positionIds:row.positionIds??[],status:row.status});setOpen(true);};
  return <><PageHeader title="账号管理" description="维护管理员账号、部门与岗位" actions={can('system:user:create')?<Button theme="solid" onClick={()=>{setEditing(null);setForm(empty);setOpen(true);}}>新增账号</Button>:null}/>
    <div className="zenith-card"><div style={{display:'flex',gap:8,marginBottom:16}}><Input placeholder="用户名或昵称" value={keyword} onChange={setKeyword} style={{width:220}} onEnterPress={()=>{setSearch(keyword);setPage(1);}}/><Button onClick={()=>{setSearch(keyword);setPage(1);}}>查询</Button></div>
      <Table<User> rowKey="id" dataSource={list.data?.list??[]} loading={list.isLoading} pagination={{currentPage:page,pageSize:10,total:list.data?.total??0,onPageChange:setPage}} columns={[
        {title:'用户名',dataIndex:'username'},{title:'昵称',dataIndex:'nickname'},{title:'部门',dataIndex:'departmentName',render:value=>value??'—'},{title:'状态',dataIndex:'status',render:value=>value==='enabled'?'启用':'停用'},
        {title:'操作',render:(_,row)=><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{can('system:user:update')&&<Button theme="borderless" onClick={()=>edit(row)}>编辑</Button>}{can('system:user:assign')&&<Button theme="borderless" onClick={()=>setPermissionUser(row)}>菜单授权</Button>}{can('system:user:assign')&&<Button theme="borderless" onClick={()=>setScopeUser(row)}>数据范围</Button>}{can('system:user:update')&&<Button theme="borderless" onClick={()=>setResetUser(row)}>重置密码</Button>}{can('system:user:delete')&&<Button theme="borderless" type="danger" onClick={()=>Modal.confirm({title:`删除账号「${row.username}」？`,onOk:()=>remove.mutateAsync(row.id)})}>删除</Button>}</div>},
      ]}/></div>
    <Modal title={editing?'编辑账号':'新增账号'} visible={open} onCancel={()=>setOpen(false)} onOk={()=>save.mutate()} okButtonProps={{loading:save.isPending}}><div style={{display:'grid',gap:12}}>
      <div className="zenith-form-row"><label>用户名</label><Input value={form.username} onChange={username=>setForm({...form,username})}/></div>
      <div className="zenith-form-row"><label>昵称</label><Input value={form.nickname} onChange={nickname=>setForm({...form,nickname})}/></div>
      {!editing&&<div className="zenith-form-row"><label>初始密码（至少 12 位）</label><Input mode="password" value={form.password} onChange={password=>setForm({...form,password})}/></div>}
      <div className="zenith-form-row"><label>邮箱</label><Input value={form.email} onChange={email=>setForm({...form,email})}/></div>
      <div className="zenith-form-row"><label>部门</label><Select value={form.departmentId??0} onChange={value=>setForm({...form,departmentId:Number(value)||null})} optionList={[{label:'未分配',value:0},...(departments.data??[]).map(item=>({label:item.name,value:item.id}))]}/></div>
      <div className="zenith-form-row"><label>岗位</label><Select multiple filter value={form.positionIds} onChange={value=>setForm({...form,positionIds:(value as number[])??[]})} optionList={(positions.data??[]).map(item=>({label:item.name,value:item.id}))}/></div>
      <div className="zenith-form-row"><label>状态</label><Select value={form.status} onChange={value=>setForm({...form,status:value as Form['status']})} optionList={[{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]}/></div>
    </div></Modal>
    <Modal title={`重置密码 · ${resetUser?.username??''}`} visible={resetUser!==null} onCancel={()=>setResetUser(null)} onOk={()=>reset.mutate()} okButtonProps={{loading:reset.isPending}}><div className="zenith-form-row"><label>新密码（至少 12 位）</label><Input mode="password" value={newPassword} onChange={setNewPassword}/></div></Modal>
    <Modal title={`菜单授权 · ${permissionUser?.username??''}`} visible={permissionUser!==null} onCancel={()=>setPermissionUser(null)} onOk={()=>assignMenus.mutate()} okButtonProps={{loading:assignMenus.isPending,disabled:!can('system:menu:list')}}><p>角色继承的权限在角色管理中维护。此处仅设置用户直接授权。</p><Select multiple filter value={directMenuIds} onChange={value=>setDirectMenuIds((value as number[])??[])} style={{width:'100%'}} optionList={(menus.data??[]).map(row=>({label:row.title,value:row.id}))}/><p>角色继承菜单：{menuGrants.data?.roleMenuIds.length??0} 项</p></Modal>
    <Modal title={`数据范围 · ${scopeUser?.username??''}`} visible={scopeUser!==null} onCancel={()=>setScopeUser(null)} onOk={()=>saveScope.mutate()} okButtonProps={{loading:saveScope.isPending}}><div style={{display:'grid',gap:12}}><div className="zenith-form-row"><label>直接数据范围</label><Select value={dataScope??''} onChange={value=>setDataScope(String(value)||null)} optionList={[{label:'继承角色',value:''},...['all','dept','custom','dept_only','self'].map(value=>({label:value,value}))]}/></div>{dataScope==='custom'&&<div className="zenith-form-row"><label>指定部门</label><Select multiple filter value={deptScopeIds} onChange={value=>setDeptScopeIds((value as number[])??[])} optionList={(departments.data??[]).map(row=>({label:row.name,value:row.id}))}/></div>}</div></Modal>
  </>;
}
