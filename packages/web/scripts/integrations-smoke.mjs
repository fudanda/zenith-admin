import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.ARCBASE_BROWSER_API_URL;
const browser = await chromium.launch({ headless: true });
const errors = [], apiPaths = [];
let page;
async function signIn(context, username, password) {
  const tab = await context.newPage();
  tab.on('pageerror', error => errors.push(error.message));
  tab.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) apiPaths.push(path);
  });
  await tab.goto(`${base}/dash/login`);
  await tab.getByPlaceholder('请输入用户名/手机号').fill(username);
  await tab.getByPlaceholder('请输入密码', { exact: true }).fill(password);
  await tab.getByRole('button', { name: '登录', exact: true }).click();
  await tab.waitForURL(/\/dash\/?$/);
  return tab;
}
try {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  page = await signIn(context, process.env.ARCBASE_BROWSER_USERNAME, process.env.ARCBASE_BROWSER_PASSWORD);
  await page.goto(`${base}/dash/profile`);
  await page.getByRole('tab', { name: 'API Token', exact: true }).click();
  await page.getByRole('button', { name: '新建 Token', exact: true }).click();
  await page.getByPlaceholder('如：本地开发、CI/CD 环境').fill('浏览器受限密钥');
  await page.locator('.semi-modal .semi-select').click();
  await page.getByText('system:position:list', { exact: true }).click();
  await page.keyboard.press('Escape');
  const createdResponse = page.waitForResponse(res => new URL(res.url()).pathname === '/api/v1/api-tokens' && res.request().method() === 'POST');
  await page.getByRole('button', { name: /^(创建|confirm)$/ }).click();
  const created = await createdResponse;
  assert.ok(created.ok(), 'key creation succeeded');
  const { data: key } = await created.json();
  assert.match(key.token, /^arc_[0-9a-f]{64}$/);
  await page.locator('.token-display code').waitFor();
  assert.equal(await page.locator('.token-display code').innerText(), key.token);
  await page.getByRole('button', { name: '复制', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), key.token);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '浏览器受限密钥' }).waitFor();
  await page.reload();
  await page.getByRole('tab', { name: 'API Token', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '浏览器受限密钥' }).waitFor();
  assert.equal(await page.getByText(key.token, { exact: true }).count(), 0, 'secret was shown only once');
  const headers = { Authorization: `Bearer ${key.token}` };
  assert.equal((await fetch(`${base}/api/v1/positions`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/api/v1/users`, { headers })).status, 403);
  const revokedResponse = page.waitForResponse(res => new URL(res.url()).pathname === `/api/v1/api-tokens/${key.id}` && res.request().method() === 'DELETE');
  await page.getByRole('row').filter({ hasText: '浏览器受限密钥' }).getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: /^(confirm|确\s*定)$/ }).click();
  assert.ok((await revokedResponse).ok());
  assert.equal((await fetch(`${base}/api/v1/positions`, { headers })).status, 401);

  await page.goto(`${base}/dash/system/file-configs`);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByPlaceholder('请输入配置名称').fill('浏览器 MinIO');
  await page.getByText('本地磁盘', { exact: true }).last().click();
  await page.getByText('S3 兼容存储', { exact: true }).click();
  await page.getByPlaceholder('请输入 S3 Region').fill('us-east-1');
  await page.getByPlaceholder('请输入 S3 Bucket').fill(process.env.ARCBASE_BROWSER_S3_BUCKET);
  await page.getByPlaceholder('可选，兼容 S3 自定义存储').fill(process.env.ARCBASE_TEST_S3_ENDPOINT);
  await page.getByPlaceholder('请输入 Access Key ID').fill(process.env.ARCBASE_TEST_S3_ACCESS_KEY);
  await page.getByPlaceholder('请输入 Secret Access Key').fill(process.env.ARCBASE_TEST_S3_SECRET_KEY);
  await page.getByText('强制路径样式', { exact: false }).click();
  await page.getByRole('switch').click();
  const tested = page.waitForResponse(res => new URL(res.url()).pathname === '/api/v1/file-storage-configs/test');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  assert.ok((await tested).ok());
  const saved = page.waitForResponse(res => new URL(res.url()).pathname === '/api/v1/file-storage-configs' && res.request().method() === 'POST');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const storageResponse = await saved;
  assert.ok(storageResponse.ok());
  assert.ok(!(await storageResponse.text()).includes(process.env.ARCBASE_TEST_S3_SECRET_KEY), 'storage secret not returned');
  await page.getByRole('row').filter({ hasText: '浏览器 MinIO' }).waitFor();
  await page.goto(`${base}/dash/system/files`);
  await page.getByRole('button', { name: '上传文件', exact: true }).waitFor();
  const uploaded = page.waitForResponse(res => new URL(res.url()).pathname === '/api/v1/files/upload' && res.request().method() === 'POST');
  await page.locator('input[type=file]').setInputFiles({ name: 's3-browser.txt', mimeType: 'text/plain', buffer: Buffer.from('真实 S3 浏览器内容') });
  assert.ok((await uploaded).ok());
  await page.getByText('s3-browser.txt', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('row').filter({ hasText: 's3-browser.txt' }).getByText('下载', { exact: true }).click();
  assert.equal(await readFile(await (await downloaded).path(), 'utf8'), '真实 S3 浏览器内容');

  // Separate user, browser context, Cookie and query cache. No manual refresh.
  await page.goto(`${base}/dash/system/positions`);
  await page.getByRole('button', { name: '新增', exact: true }).waitFor();
  const refreshResponse = page.waitForResponse(res => new URL(res.url()).pathname === '/api/v1/positions' && res.request().method() === 'GET');
  const peer = await signIn(await browser.newContext(), 'realtime-peer', process.env.ARCBASE_BROWSER_PEER_PASSWORD);
  await peer.goto(`${base}/dash/system/positions`);
  await peer.getByRole('button', { name: '新增', exact: true }).click();
  await peer.getByPlaceholder('请输入岗位名称').fill('实时订阅岗位');
  await peer.getByPlaceholder('请输入岗位编码').fill('realtime_browser_position');
  await peer.getByRole('button', { name: 'confirm', exact: true }).click();
  await peer.getByRole('row').filter({ hasText: '实时订阅岗位' }).waitFor();
  await refreshResponse;
  await page.getByRole('row').filter({ hasText: '实时订阅岗位' }).waitFor({ timeout: 10000 });
  assert.ok(apiPaths.every(path => path.startsWith('/api/v1/')));
  assert.ok(apiPaths.includes('/api/v1/events'), 'original admin subscribes');
  assert.deepEqual(errors, []);
  console.log('PASS: original API Token create/copy/list/revoke/scope; original S3 form/test/upload/download; separate-user realtime refresh; no legacy API or page errors');
} catch (error) {
  console.error('Failed at', page?.url(), error);
  // Never print page text: it may contain the one-time key or storage secret.
  throw error;
} finally { await browser.close(); }
