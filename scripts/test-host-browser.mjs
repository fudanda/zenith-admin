import assert from 'node:assert/strict';
import { createServer, request as proxyRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, relative, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(resolve(import.meta.dirname, '../packages/web/package.json'));
const { chromium } = require('playwright');
const dist = resolve(process.env.ZENITH_EXTERNAL_HOST_DIR, 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const upstream = proxyRequest(new URL(req.url, process.env.ZENITH_BROWSER_API_URL), { method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res); res.on('close', () => response.destroy());
    });
    res.on('close', () => upstream.destroy()); upstream.on('error', () => { if (!res.destroyed) { if (!res.headersSent) res.writeHead(502); res.end(); } }); req.pipe(upstream); return;
  }
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith('/console/')) { res.writeHead(404); res.end(); return; }
  let file = resolve(dist, path.slice('/console/'.length));
  const rel = relative(dist, file);
  if (rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(404); res.end(); return; }
  try { if (!(await stat(file)).isFile()) throw new Error('not file'); }
  catch { if (extname(path)) { res.writeHead(404); res.end(); return; } file = resolve(dist, 'index.html'); }
  try { const content = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); res.end(content); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];
async function login(context, username) {
  const page = await context.newPage(); page.on('pageerror', error => failures.push(error.message));
  await page.goto(`${base}/console/login`);
  await page.getByText('独立宿主验收', { exact: true }).waitFor();
  const captcha = page.getByAltText('登录验证码'); await captcha.waitFor();
  const svg = Buffer.from((await captcha.getAttribute('src')).split(',')[1], 'base64').toString();
  const answer = svg.match(/>([A-F0-9]{6})<\/text>/)?.[1]; assert.ok(answer);
  await page.getByPlaceholder('请输入用户名/手机号').fill(username);
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(process.env.ZENITH_BROWSER_PASSWORD);
  await page.getByPlaceholder('请输入验证码').fill(answer);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/\/console\/?$/); return page;
}
try {
  const context = await browser.newContext(); const page = await login(context, process.env.ZENITH_BROWSER_USERNAME);
  await page.getByText('宿主业务', { exact: true }).first().click();
  await page.getByText('岗位业务模块', { exact: true }).first().click();
  await page.waitForURL(/\/extensions\/position-host\/positions$/);
  await page.getByPlaceholder('宿主岗位名称').fill('独立包真实岗位');
  await page.getByPlaceholder('宿主岗位编码').fill('external_host_position');
  await page.getByRole('button', { name: '添加岗位', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '独立包真实岗位' }).waitFor();
  await page.reload(); await page.getByRole('row').filter({ hasText: '独立包真实岗位' }).waitFor();
  await page.getByPlaceholder('宿主岗位筛选').fill('not_a_real_position');
  await page.getByRole('row').filter({ hasText: '独立包真实岗位' }).waitFor({ state: 'hidden' });
  await page.getByPlaceholder('宿主岗位筛选').fill('external_host_position');
  await page.getByRole('row').filter({ hasText: '独立包真实岗位' }).waitFor();
  // Verify the same row from the original Zenith positions page and Go route.
  await page.goto(`${base}/console/system/positions`);
  await page.getByRole('row').filter({ hasText: '独立包真实岗位' }).waitFor();
  const readerContext = await browser.newContext(); const reader = await login(readerContext, 'host-reader');
  await reader.goto(`${base}/console/extensions/position-host/positions`);
  await reader.getByRole('row').filter({ hasText: '独立包真实岗位' }).waitFor();
  assert.equal(await reader.getByTestId('host-create-action').count(), 0, 'shared Elements context enforces reader button permissions');
  assert.equal((await readerContext.cookies()).some(cookie => cookie.name === 'zenith_session' && cookie.httpOnly), true);
  assert.deepEqual(failures, []);
  console.log('Independent installed packages: host menu, deep link, real Go CRUD, original page, refresh, filters, shared session and denied button passed.');
} finally { await browser.close(); await new Promise(done => server.close(done)); }
