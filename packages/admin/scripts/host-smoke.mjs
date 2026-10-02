import assert from 'node:assert/strict';
import { createServer, request as proxyRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(resolve(root, '../web/package.json'));
const { chromium } = require('playwright');
const dist = resolve(root, 'dist-example');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const proxy = proxyRequest(new URL(req.url, process.env.ARCBASE_BROWSER_API_URL), { method: req.method, headers: req.headers }, upstream => {
      res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
      res.on('close', () => upstream.destroy());
    });
    res.on('close', () => proxy.destroy());
    proxy.on('error', () => { if (!res.destroyed) { if (!res.headersSent) res.writeHead(502); res.end(); } });
    req.pipe(proxy); return;
  }
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (!pathname.startsWith('/console/')) { res.writeHead(404); res.end(); return; }
  let file = resolve(dist, pathname.slice('/console/'.length));
  const rel = relative(dist, file);
  if (rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(404); res.end(); return; }
  try { if (!(await stat(file)).isFile()) throw new Error('not a file'); }
  catch { if (extname(pathname)) { res.writeHead(404); res.end(); return; } file = resolve(dist, 'index.html'); }
  try { const content = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); res.end(content); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];
let page;
try {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => {
    window.adminHostNativeStorage = window.localStorage;
    window.localStorage.setItem('host-owned-data', 'outside-admin');
  });
  const externalRequests = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) { externalRequests.push(url.href); await route.abort(); }
    else await route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && response.status() !== 401) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${base}/console/login`);
  await page.getByText('宿主控制台', { exact: true }).waitFor();
  await page.getByTestId('host-brand-logo').waitFor();
  await page.getByText('宿主备案示例', { exact: true }).waitFor();
  assert.equal(await page.locator('body').getAttribute('theme-mode'), 'dark', 'host initial theme');
  const captcha = page.getByAltText('登录验证码');
  await captcha.waitFor();
  const svg = Buffer.from((await captcha.getAttribute('src')).split(',')[1], 'base64').toString();
  const answer = svg.match(/>([A-F0-9]{6})<\/text>/)?.[1];
  assert.ok(answer, 'real Go captcha');
  await page.getByPlaceholder('请输入用户名/手机号').fill(process.env.ARCBASE_BROWSER_USERNAME);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(process.env.ARCBASE_BROWSER_PASSWORD);
  await page.getByPlaceholder('请输入验证码').fill(answer);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/\/console\/?$/);
  await page.getByText('系统用户总数', { exact: true }).waitFor();
  assert.ok((await context.cookies()).some(cookie => cookie.name === 'arcbase_session' && cookie.httpOnly));
  await page.goto(`${base}/console/system/positions`);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByPlaceholder('请输入岗位名称').fill('封装宿主岗位');
  await page.getByPlaceholder('请输入岗位编码').fill('embedded_host_position');
  await page.getByRole('button', { name: /^(confirm|确\s*定)$/ }).click();
  await page.getByRole('row').filter({ hasText: '封装宿主岗位' }).waitFor();
  assert.match(await page.title(), /宿主控制台/);
  await page.reload();
  await page.getByRole('row').filter({ hasText: '封装宿主岗位' }).waitFor();
  await page.locator('.admin-tab-item').filter({ hasText: '岗位管理' }).first().click({ button: 'right' });
  await page.getByText('在新标签页中打开', { exact: true }).click();
  assert.equal(await page.evaluate(() => window.arcbaseExample.lastExternal), `${base}/console/system/positions`, 'host external navigation receives the complete admin URL');
  const download = page.waitForEvent('download');
  await page.locator('.export-button__trigger').click();
  await page.getByText('导出 CSV', { exact: true }).click();
  assert.match(await readFile(await (await download).path(), 'utf8'), /封装宿主岗位/);
  await page.evaluate(() => window.arcbaseExample.unmount());
  await page.locator('#root').filter({ has: page.locator(':scope > *') }).waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.localStorage === window.adminHostNativeStorage && window.localStorage.getItem('host-owned-data') === 'outside-admin'), true, 'restore host storage on unmount');
  await page.evaluate(() => window.arcbaseExample.mount());
  await page.getByRole('row').filter({ hasText: '封装宿主岗位' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('row').filter({ hasText: '封装宿主岗位' }).waitFor();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/console/system/file-configs`);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByPlaceholder('请输入配置名称').fill('宿主本地文件');
  await page.getByPlaceholder('例如 storage/local 或 D:/uploads').fill(process.env.ARCBASE_BROWSER_STORAGE);
  await page.getByRole('switch').click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '宿主本地文件' }).waitFor();
  await page.goto(`${base}/console/system/files`);
  await page.getByRole('button', { name: '上传文件', exact: true }).waitFor();
  const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/files/upload' && response.request().method() === 'POST');
  await page.locator('input[type=file]').setInputFiles({ name: 'admin-host.txt', mimeType: 'text/plain', buffer: Buffer.from('宿主真实文件') });
  assert.equal((await uploaded).status(), 200);
  await page.getByText('admin-host.txt', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  const fileRow = page.getByRole('row').filter({ hasText: 'admin-host.txt' });
  await fileRow.getByText('预览', { exact: true }).click();
  await page.getByText('宿主真实文件', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  const fileDownload = page.waitForEvent('download');
  await fileRow.getByText('下载', { exact: true }).click();
  assert.equal(await readFile(await (await fileDownload).path(), 'utf8'), '宿主真实文件');
  await page.goto(`${base}/console/profile`);
  await page.getByRole('button', { name: '更换头像', exact: true }).last().click();
  await page.getByAltText('预设头像').first().waitFor();
  const avatar = await page.getByAltText('预设头像').first().getAttribute('src');
  assert.equal(avatar, `${base}/console/arcbase-assets/avatars/avatar-01.svg`);
  await page.getByAltText('预设头像').first().click();
  await page.goto(`${base}/console/`);
  await page.locator('.admin-header__user').click();
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByRole('button', { name: /^(confirm|确\s*定)$/ }).click();
  await page.waitForURL(/\/console\/login/);
  assert.deepEqual(failures, [], 'no runtime or missing lazy resource failures');
  assert.deepEqual(externalRequests, [], 'preview and admin resources are local');
  console.log('Built @arcbase/admin host passed: branding/theme/locale/navigation, original login, Cookie restore, /console deep links, real CRUD/export, upload/preview/download, assets, remount, narrow screen and logout.');
} catch (error) {
  throw new Error(`${error.message}\nBrowser failures: ${JSON.stringify(failures)}\nPage: ${(await page?.locator('body').innerText())?.slice(0, 1500)}`);
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
