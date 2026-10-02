import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { generateModule, validateSpec } from './module.mjs';

const spec={id:'inventory',title:'物品管理',entity:'Item',fields:[{name:'name',type:'string'},{name:'code',type:'string',unique:true},{name:'quantity',type:'int'},{name:'active',type:'bool'}]};
test('legacy generated projects retain their installed SDK, packages and registry identity',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'arcbase-legacy-module-'));
 writeFileSync(resolve(root,'zenith.project.json'),JSON.stringify({format:1,backendModule:'example.org/legacy/backend',modules:[]}));
 generateModule(root,spec);
 assert.equal(existsSync(resolve(root,'arcbase.project.json')),false);
 assert.equal(JSON.parse(readFileSync(resolve(root,'zenith.project.json'),'utf8')).modules.length,1);
 assert.match(readFileSync(resolve(root,'backend/modules.gen.go'),'utf8'),/create-zenith/);
 assert.match(readFileSync(resolve(root,'backend/modules/inventory/service.go'),'utf8'),/github.com\/fudanda\/zenith-admin\/backend/);
 assert.match(readFileSync(resolve(root,'frontend/modules/inventory/index.ts'),'utf8'),/ZenithAdminModule/);
 assert.doesNotMatch(readFileSync(resolve(root,'frontend/modules/inventory/Page.tsx'),'utf8'),/@arcbase\//);
 generateModule(root,{...spec,id:'warehouse',entity:'Warehouse'});
 assert.equal(JSON.parse(readFileSync(resolve(root,'zenith.project.json'),'utf8')).modules.length,2);
});
test('invalid module input cannot escape project or shadow core fields',()=>{
 for(const invalid of [{...spec,id:'../users'},{...spec,entity:'Item;DROP'},{...spec,fields:[{name:'id',type:'int'}]},{...spec,fields:[{name:'iD',type:'int'}]},{...spec,fields:[{name:'createdBY',type:'int'}]},{...spec,fields:[{name:'password',type:'string'}]},{...spec,scope:'tenant'},{...spec,fields:[{name:'name',type:'string',maxLength:-1}]}])assert.throws(()=>validateSpec(invalid));
});
test('module emits real persistence, contracts, permission actions, generated hooks and preserves existing files',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'arcbase-module-unit-'));writeFileSync(resolve(root,'arcbase.project.json'),JSON.stringify({format:1,backendModule:'example.org/test/backend',modules:[]}));
 const output=generateModule(root,spec);assert.ok(output.files.includes('backend/modules/inventory/service.go'));
 assert.match(readFileSync(resolve(root,'backend/modules/inventory/service.go'),'utf8'),/Data\.Write/);assert.match(readFileSync(resolve(root,'backend/modules/inventory/migrations.go'),'utf8'),/host_inventory_items/);
 const original=readFileSync(resolve(root,'frontend/modules/inventory/Page.tsx'),'utf8');assert.throws(()=>generateModule(root,spec));assert.equal(readFileSync(resolve(root,'frontend/modules/inventory/Page.tsx'),'utf8'),original);
});
test('module refuses a manually maintained registration file before writing domain files',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'arcbase-module-unit-'));writeFileSync(resolve(root,'arcbase.project.json'),JSON.stringify({format:1,backendModule:'example.org/test/backend',modules:[]}));
 generateModule(root,spec);writeFileSync(resolve(root,'backend/modules.gen.go'),'package main // manually maintained');
 const second={...spec,id:'warehouse',entity:'Warehouse'};assert.throws(()=>generateModule(root,second),/non-generated registry/);assert.equal(JSON.parse(readFileSync(resolve(root,'arcbase.project.json'),'utf8')).modules.length,1);
});
