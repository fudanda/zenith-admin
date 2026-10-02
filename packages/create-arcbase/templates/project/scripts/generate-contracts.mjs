import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as z from 'zod';
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
extendZodWithOpenApi(z);
const manifest=JSON.parse(readFileSync('arcbase.project.json','utf8'));
for(const module of manifest.modules){
 const {contract}=await import(pathToFileURL(resolve(`frontend/modules/${module.id}/contracts.ts`)).href);
 const registry=new OpenAPIRegistry();registry.registerComponent('securitySchemes','cookieAuth',{type:'apiKey',in:'cookie',name:'arcbase_session'});
 const schema=value=>{if(!value)return undefined;const result=z.toJSONSchema(value,{io:'output',unrepresentable:'any'});if(value instanceof z.ZodObject&&result.required)result.required=result.required.filter(key=>!value.shape[key].safeParse(undefined).success);return result;};
 const definitions=[];
 for(const [name,op] of Object.entries(contract).filter(([,op])=>op&&typeof op==='object'&&'method'in op)){
  const query=schema(op.query);const id=module.entity+name[0].toUpperCase()+name.slice(1);const status=name==='create'?201:200;
  const body=schema(op.body);if(name==='update'&&body)body.minProperties=1;
  definitions.push({id,method:op.method.toUpperCase(),path:op.fullPath,permission:op.access.permission,body,query,params:schema(op.params),queryTypes:Object.fromEntries(Object.entries(query?.properties??{}).map(([key,value])=>[key,value.type??'string'])),auditModule:module.id,auditDescription:op.audit?.description??'',auditRecordBody:false,successStatus:status});
  registry.registerPath({method:op.method,path:op.fullPath,operationId:id,summary:op.summary,security:[{cookieAuth:[]}],request:{query:op.query,params:op.params,...(!['get','head'].includes(op.method)?{headers:z.object({'X-CSRF-Token':z.string().min(1).describe('Cookie session writes require the token returned by auth/me or login')})}:{}),...(op.body?{body:{content:{'application/json':{schema:op.body}}}}:{})},responses:{[status]:{description:'Success',content:{'application/json':{schema:z.object({code:z.number(),message:z.string(),data:op.response})}}},400:{description:'Request validation failed'},401:{description:'Authentication required'},403:{description:'Permission or CSRF rejected'},404:{description:'Record unavailable in current scope'},409:{description:'Unique constraint conflict'},503:{description:'Database operation unavailable'}}});
 }
 const api=new OpenApiGeneratorV3(registry.definitions).generateDocument({openapi:'3.0.3',info:{title:module.title,version:'1.0.0'}});
 for(const [name,value]of [['contract.gen.json',definitions],['openapi.gen.json',api]]){const path=`backend/modules/${module.id}/${name}`;const output=JSON.stringify(value,null,2)+'\n';if(process.argv.includes('--check')){if(readFileSync(path,'utf8').replaceAll('\r\n','\n')!==output)throw new Error('Contract drift: '+module.id);}else writeFileSync(path,output);}
}
