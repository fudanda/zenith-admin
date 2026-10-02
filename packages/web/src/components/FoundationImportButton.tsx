import { useRef, useState } from 'react';
import { Button, Dropdown, Modal, Select, Table, Tag, Typography, Toast } from '@douyinfe/semi-ui';
import { ChevronDown, Upload } from 'lucide-react';
import { foundationTransferContract, type SyncImportResult } from '@arcbase/shared/foundation-transfer';
import { request } from '@/utils/request';
import { urlOf } from '@/lib/contract-query';
import { goTransport } from '@/lib/go-transport';
import { downloadBlob } from '@/utils/download';
interface Props {entity:string;title:string;label?:string;beforeSubmit?:()=>boolean;onFinished?:()=>void}
export default function FoundationImportButton({entity,title,label='导入',beforeSubmit,onFinished}:Readonly<Props>) {
 const input=useRef<HTMLInputElement>(null);
 const dryRun=useRef(false);
 const [pending,setPending]=useState(false);
 const [duplicate,setDuplicate]=useState<'error'|'skip'|'update'>('error');
 const [result,setResult]=useState<SyncImportResult|null>(null);
 const [visible,setVisible]=useState(false);
 const pick=(dry:boolean)=>{if (beforeSubmit && !beforeSubmit()) return;dryRun.current=dry;input.current?.click()};
 const upload=async(file:File)=>{
  setVisible(true);setPending(true);setResult(null);
  try {
   const form=new FormData();form.append('file',file);form.append('dryRun',String(dryRun.current));form.append('duplicate',duplicate);
   const response=await request.postForm<SyncImportResult>(urlOf(foundationTransferContract.users),form);
   if(response.code!==0) throw new Error(response.message);
   setResult(foundationTransferContract.users.response.parse(response.data));
   if(!dryRun.current) onFinished?.();
  } catch(error) {Toast.error(error instanceof Error?error.message:'导入失败');setVisible(false)} finally {setPending(false)}
 };
 const template=async()=>{const blob=await goTransport.readBlob(urlOf(foundationTransferContract.template));downloadBlob(blob,`${title}导入模板.xlsx`)};
 if(entity!=='identity.users') return null;
 return <>
  <input ref={input} type="file" accept=".xlsx" style={{display:'none'}} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file) void upload(file)}} />
  <Dropdown trigger="click" position="bottomLeft" clickToHide render={<Dropdown.Menu>
   <Dropdown.Item onClick={()=>pick(false)}>上传文件导入</Dropdown.Item>
   <Dropdown.Item onClick={()=>pick(true)}>预检文件（仅校验不落库）</Dropdown.Item>
   <Dropdown.Item onClick={()=>void template()}>下载导入模板</Dropdown.Item>
   <Dropdown.Item><Select aria-label="重复数据处理" value={duplicate} onChange={value=>setDuplicate(value as typeof duplicate)} optionList={[{value:'error',label:'重复时报错'},{value:'skip',label:'跳过重复用户'},{value:'update',label:'更新已有用户'}]} /></Dropdown.Item>
  </Dropdown.Menu>}><Button icon={<Upload size={14}/>} loading={pending}>{label} <ChevronDown size={12}/></Button></Dropdown>
  <Modal title={`${title}导入`} visible={visible} maskClosable={false} closable={!pending} onCancel={()=>setVisible(false)} width={640} footer={<Button type="primary" disabled={pending} onClick={()=>setVisible(false)}>完成</Button>}>
   {pending ? <Typography.Text>正在同步处理，请等待当前请求完成。</Typography.Text> : result && <>
    {result.dryRun && <Typography.Text type="warning">预检模式：仅校验数据，不写入任何记录。</Typography.Text>}
    <Typography.Paragraph>共 {result.total} 行，成功 {result.success}，失败 {result.failed}，跳过 {result.skipped}</Typography.Paragraph>
    <Table rowKey="row" size="small" dataSource={result.rows} columns={[{title:'行',dataIndex:'row',width:70},{title:'内容',dataIndex:'label'},{title:'结果',dataIndex:'status',width:80,render:(status:string)=><Tag color={status==='failed'?'red':status==='success'?'green':'grey'}>{status==='failed'?'失败':status==='success'?'成功':'跳过'}</Tag>},{title:'说明',dataIndex:'message'}]} pagination={{pageSize:8}} />
   </>}
  </Modal>
 </>;
}
