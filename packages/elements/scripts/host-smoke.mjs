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
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const upstream = proxyRequest(new URL(req.url, process.env.ZENITH_BROWSER_API_URL), { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); res.on('close', () => response.destroy()); });
    res.on('close', () => upstream.destroy());
    upstream.on('error', () => { if (!res.destroyed) { if (!res.headersSent) res.writeHead(502); res.end(); } }); req.pipe(upstream); return;
  }
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (!pathname.startsWith('/elements/')) { res.writeHead(404); res.end(); return; }
  let file = resolve(dist, pathname.slice('/elements/'.length));
  const rel = relative(dist, file);
  if (rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(404); res.end(); return; }
  try { if (!(await stat(file)).isFile()) throw new Error('missing'); }
  catch { if (extname(pathname)) { res.writeHead(404); res.end(); return; } file = resolve(dist, 'index.html'); }
  try { res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' })[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  const context = await browser.newContext(); const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && response.status() !== 401) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${base}/elements/`);
  const captcha = page.getByAltText('登录验证码'); await captcha.waitFor();
  const svg = Buffer.from((await captcha.getAttribute('src')).split(',')[1], 'base64').toString();
  const answer = svg.match(/>([A-F0-9]{6})<\/text>/)?.[1]; assert.ok(answer);
  await page.getByLabel('用户名', { exact: true }).fill(process.env.ZENITH_BROWSER_USERNAME);
  await page.getByLabel('密码', { exact: true }).fill(process.env.ZENITH_BROWSER_PASSWORD);
  await page.getByLabel('验证码', { exact: true }).fill(answer);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByTestId('session-user').filter({ hasText: process.env.ZENITH_BROWSER_USERNAME }).waitFor();
  assert.ok((await context.cookies()).some(cookie => cookie.name === 'zenith_session' && cookie.httpOnly));
  await page.reload(); await page.getByTestId('session-user').waitFor();
  const upload = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/files/upload-one' && response.request().method() === 'POST');
  await page.locator('input[type=file]').setInputFiles({ name: 'elements-host.txt', mimeType: 'text/plain', buffer: Buffer.from('独立组件真实上传') });
  assert.equal((await upload).status(), 200);
  const file = page.getByTestId('uploaded-files').getByRole('link', { name: 'elements-host.txt' }); await file.waitFor();
  const filePath = await file.getAttribute('href');
  const response = await context.request.get(new URL(filePath, base).href); assert.equal(response.status(), 200); assert.equal(await response.text(), '独立组件真实上传');
  await page.evaluate(() => window.zenithElementsExample.unmount());
  await page.locator('#root > main').waitFor({ state: 'hidden' });
  await page.evaluate(() => window.zenithElementsExample.mount()); await page.getByTestId('session-user').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).waitFor();
  assert.deepEqual(failures, []);
  console.log('Built @zenith/elements passed: real captcha/login, Cookie restore, permission guard, upload/download, remount and logout.');
} finally { await browser.close(); await new Promise(done => server.close(done)); }
