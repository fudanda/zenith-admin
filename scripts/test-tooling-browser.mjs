import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../packages/web/package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});const base=process.env.ARCBASE_BROWSER_BASE_URL;
const errors=[];const badRequests=[];
async function login(context){const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/')&&!path.startsWith('/api/v1/'))badRequests.push(path);});
 await page.goto(base+'/dash/login');await page.getByText('独立生成项目',{exact:true}).waitFor();const captcha=page.getByAltText('登录验证码');await captcha.waitFor();const svg=Buffer.from((await captcha.getAttribute('src')).split(',')[1],'base64').toString();const answer=svg.match(/>([A-F0-9]{6})<\/text>/)?.[1];assert.ok(answer);
 await page.getByPlaceholder('请输入用户名/手机号').fill(process.env.ARCBASE_BROWSER_USERNAME);await page.getByPlaceholder('请输入密码',{exact:true}).fill(process.env.ARCBASE_BROWSER_PASSWORD);await page.getByPlaceholder('请输入验证码').fill(answer);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(/\/dash\/?$/);await page.goto(base+'/dash/extensions/inventory/records');await page.getByRole('heading',{name:'物品管理'}).waitFor();return page;}
try {
 const context=await browser.newContext();const page=await login(context);console.log('PASS: generated admin login and deep link');
 const peerContext=await browser.newContext();const peer=await login(peerContext);console.log('PASS: second independent session');
 await page.getByRole('button',{name:'新增',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();
 await dialog.locator('input[id="name"]').fill('生成模块真实物品');await dialog.locator('input[id="code"]').fill('generated_browser_item');await dialog.locator('input[id="quantity"]').fill('12');await dialog.getByRole('button',{name:'保存',exact:true}).click();try{await dialog.waitFor({state:'hidden',timeout:8000});}catch(error){console.error('Generated form:',await dialog.innerText());throw error;}
 let row=page.getByRole('row').filter({hasText:'生成模块真实物品'});await row.waitFor();console.log('PASS: browser create');
 // The second browser has no mutation cache. It must re-query after an SSE event.
 await peer.getByRole('row').filter({hasText:'生成模块真实物品'}).waitFor({timeout:15000});console.log('PASS: SSE peer refresh');
 await row.getByRole('button',{name:'编辑'}).click();await dialog.locator('input[id="name"]').fill('生成模块编辑成功');await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.reload();row=page.getByRole('row').filter({hasText:'生成模块编辑成功'});await row.waitFor();
 await page.getByPlaceholder('搜索记录').fill('no_matching_record');await row.waitFor({state:'hidden'});await page.getByPlaceholder('搜索记录').fill('generated_browser_item');await row.waitFor();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.getByRole('heading',{name:'物品管理'}).isVisible(),true);await page.setViewportSize({width:1280,height:900});
 await row.getByRole('button',{name:'删除'}).click();await page.getByRole('dialog').locator('button').filter({hasText:/^确\s*定$/}).click();await row.waitFor({state:'hidden'});await page.reload();assert.equal(await page.getByRole('row').filter({hasText:'生成模块编辑成功'}).count(),0);
 assert.ok((await context.cookies()).some(cookie=>cookie.name==='arcbase_session'&&cookie.httpOnly));assert.deepEqual(errors,[]);assert.deepEqual(badRequests,[]);
 console.log('PASS: generated host login, original shell, CRUD, filters, reload, SSE peer refresh, narrow viewport and Cookie session.');
} finally {await browser.close();}
