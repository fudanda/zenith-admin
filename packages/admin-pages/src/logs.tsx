import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input, Button, Table } from '@douyinfe/semi-ui';
import { request } from '@zenith/admin-client';
import { PageHeader } from '@zenith/admin-ui';

type Paged<T> = { list: T[]; total: number; page: number; pageSize: number };
type LoginRow = { id:number; username:string; ip:string; status:string; message:string; createdAt:string };
type AuditRow = { id:number; actorId:number; operation:string; resource:string; resourceId:number|null; requestId:string; createdAt:string };

export function LoginLogsPage() {
  const [page,setPage]=useState(1);const [keyword,setKeyword]=useState('');const [search,setSearch]=useState('');
  const rows=useQuery({queryKey:['login-logs',page,search],queryFn:()=>request<Paged<LoginRow>>(`/login-logs?page=${page}&pageSize=10&username=${encodeURIComponent(search)}`)});
  return <><PageHeader title="登录日志" description="查看真实的登录成功和失败记录"/><div className="zenith-card"><div style={{display:'flex',gap:8,marginBottom:16}}><Input placeholder="用户名" value={keyword} onChange={setKeyword} style={{width:220}} onEnterPress={()=>{setSearch(keyword);setPage(1);}}/><Button onClick={()=>{setSearch(keyword);setPage(1);}}>查询</Button></div>
    <Table<LoginRow> rowKey="id" dataSource={rows.data?.list??[]} loading={rows.isLoading} pagination={{currentPage:page,pageSize:10,total:rows.data?.total??0,onPageChange:setPage}} columns={[
      {title:'用户名',dataIndex:'username'},{title:'IP',dataIndex:'ip'},{title:'结果',dataIndex:'status',render:value=>value==='success'?'成功':'失败'},
      {title:'说明',dataIndex:'message'},{title:'时间',dataIndex:'createdAt',render:value=>new Date(String(value)).toLocaleString()},
    ]}/></div></>;
}

export function OperationLogsPage() {
  const [page,setPage]=useState(1);const rows=useQuery({queryKey:['operation-logs',page],queryFn:()=>request<Paged<AuditRow>>(`/operation-logs?page=${page}&pageSize=10`)});
  return <><PageHeader title="操作审计" description="查看基础领域的实际写入审计"/><div className="zenith-card"><Table<AuditRow> rowKey="id" dataSource={rows.data?.list??[]} loading={rows.isLoading} pagination={{currentPage:page,pageSize:10,total:rows.data?.total??0,onPageChange:setPage}} columns={[
    {title:'操作人 ID',dataIndex:'actorId'},{title:'操作',dataIndex:'operation'},{title:'资源',dataIndex:'resource'},{title:'资源 ID',dataIndex:'resourceId'},
    {title:'时间',dataIndex:'createdAt',render:value=>new Date(String(value)).toLocaleString()},
  ]}/></div></>;
}
