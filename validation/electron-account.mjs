// Production account reader + real app UI. All Tistory pages are offline fixtures.
import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../scripts/server.mjs';
import { createTistoryAccountReader, accountUrl } from '../desktop/account.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-account-ui-'));
app.setPath('userData', path.join(root, 'electron')); app.on('window-all-closed', () => {});
const config = { blogUrl: 'https://your-blog.tistory.com', inbox: 'inbox', output: 'drafts', styleSamples: 'samples', styleProfile: 'profile.md', tocMode: 'skin' };
fs.writeFileSync(path.join(root, 'tistory.config.json'), JSON.stringify(config));
fs.writeFileSync(path.join(root, 'profile.md'), '보존할 기본 말투');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, remote, server, owned = [{ url: 'https://alpha.tistory.com', title: '첫 번째 블로그' }], loggedIn = false, cancelLogin = false, invalidPage = false;
const opened = [], readCategories = [], publicRequests = [];
const row = blog => `<li class="ac-li-blog"><a class="ac-li-item ac-item-thumb" href="${blog.url}/manage">블로그 대표 이미지</a><div class="ac-li-item ac-item-desc"><strong class="ac-text-ellipsis"><a>${blog.title}</a></strong><a class="ac-text-etc" href="${blog.url}">주소</a></div></li>`;
async function run() {
try {
  await app.whenReady();
  const isolated = session.fromPartition('account-fixture');
  await isolated.protocol.handle('https', request => {
    assert.equal(request.url, accountUrl);
    const content = !loggedIn ? '<h1>티스토리 로그인</h1>' : invalidPage ? '<ul class="ac-ul-blog"><li class="ac-li-blog">바뀐 구조</li></ul>' : `<h1>운영 중인 블로그</h1><ul class="ac-ul-blog">${owned.map(row).join('')}</ul><a href="https://unrelated.tistory.com/manage">타인의 추천 블로그</a>`;
    return new Response(`<html><meta charset="utf-8">${content}</html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  });
  const reader = createTistoryAccountReader({ timeout: 12000, openWindow: url => {
    opened.push(url);
    remote = new BrowserWindow({ show: false, webPreferences: { session: isolated, backgroundThrottling: false, sandbox: true, nodeIntegration: false, contextIsolation: true } });
    remote.loadURL(url);
    if (cancelLogin) setTimeout(() => remote.close(), 100);
    return remote;
  } });
  server = createApp({ root, checkGenerator: async () => true, accountReader: reader,
    categoryReader: async ({ blogUrl }) => { readCategories.push(blogUrl); return [{ blogUrl, id: '0', path: ['카테고리 없음'] }, { blogUrl, id: '11', path: ['Language', 'Java'] }]; },
    fetchPublic: async url => {
      publicRequests.push(url);
      const blog = new URL(url).origin;
      return new Response(url.endsWith('/rss') ? `<rss><channel><title>연결한 블로그</title><item><title>${new URL(url).hostname}의 글</title><link>${blog}/1</link><description>작성한 글 내용</description><category>Java</category><pubDate>Fri, 18 Sep 2026 01:00:00 GMT</pubDate></item></channel></rss>` : `<urlset><url><loc>${blog}/1</loc></url></urlset>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const bootstrap = await (await fetch(origin + '/api/bootstrap')).json();
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(origin + route, { method, headers: { 'X-App-Token': bootstrap.token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await fetch(origin + '/api/tistory/connect', { method: 'POST' })).status, 403);
  // An old public blog must not become the selected account's blog.
  await request('/api/blogs', 'POST', { url: 'https://old-blog.tistory.com' });
  const savedJob = (await request('/api/jobs', 'POST', { title: '보존할 글' })).data;
  await request(`/api/jobs/${savedJob.id}`, 'PUT', { notes: '보존할 메모', title: '보존할 글', order: [] });
  const before = fs.readFileSync(path.join(root, 'inbox', savedJob.id, 'notes.md'), 'utf8');
  win = new BrowserWindow({ show: false, width: 1280, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, nodeIntegration: false, contextIsolation: true } });
  const errors = []; win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code);
  const wait = async condition => { for (let i = 0; i < 200; i++) { if (await js(condition)) return; await pause(50); } throw Error('Timed out: ' + condition + '\n' + await js(`JSON.stringify({toast:document.getElementById('toast').textContent,status:document.getElementById('tistory-connect-status')?.textContent,category:document.getElementById('category-status').textContent})`)); };
  const click = id => js(`document.getElementById(${JSON.stringify(id)}).click()`);
  await win.loadURL(origin); await wait(`!!document.getElementById('tistory-connect')`);
  assert.equal(await js(`document.getElementById('manage-blog').textContent`), '티스토리 로그인');
  assert.equal(await js(`!!document.getElementById('publish-blog-address')`), false);
  await click('tistory-connect');
  await wait(`document.getElementById('tistory-connect').disabled`);
  assert.equal(await js(`document.getElementById('manage-blog').textContent`), '로그인 확인 중…');
  assert.equal((await request('/api/categories', 'POST')).status, 409);
  assert.equal((await request('/api/blog-settings', 'PUT', { blogUrl: 'https://old-blog.tistory.com' })).status, 409);
  assert.equal(server.hasActiveGeneration(), true);
  loggedIn = true;
  while (!remote || remote.webContents.isLoadingMainFrame()) await pause(50);
  await remote.reload();
  await wait(`document.querySelector('#public-posts h2')?.textContent==='alpha.tistory.com의 글' && !document.getElementById('category-refresh').disabled && document.getElementById('draft-category').options.length===2`);
  assert.equal(remote.isDestroyed(), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'tistory.config.json'))).blogUrl, 'https://alpha.tistory.com');
  assert.equal(await js(`document.getElementById('blog-select').value`), 'alpha');
  assert.equal(await js(`document.getElementById('manage-blog').textContent`), '첫 번째 블로그 ▾');
  assert.equal(await js(`document.getElementById('connected-blog-name').textContent`), '첫 번째 블로그');
  const beforeMenu = opened.length;
  await click('manage-blog');
  assert.match(await js(`document.getElementById('tistory-connect-status').textContent`), /첫 번째 블로그 · 연결됨/);
  assert.equal(await js(`document.getElementById('tistory-connect').textContent`), '로그인 다시 확인');
  assert.equal(opened.length, beforeMenu, 'Connected blog button opens settings without starting login again');
  await click('close-modal');
  assert.equal(await js(`document.getElementById('open-blog-management').href`), 'https://alpha.tistory.com/manage/posts');
  assert.deepEqual((await request('/api/blogs')).data.map(blog => blog.id), ['alpha']);
  assert.deepEqual(readCategories, ['https://alpha.tistory.com']);
  assert.equal((await request('/api/blog-settings', 'PUT', { blogUrl: 'https://old-blog.tistory.com', fromAccount: true })).status, 409);
  assert.equal((await request('/api/blogs/old-blog/sync', 'POST')).status, 409);
  await win.reload(); await wait(`document.getElementById('blog-link').href==='https://alpha.tistory.com/'`);
  assert.equal(await js(`document.getElementById('manage-blog').textContent`), '첫 번째 블로그 ▾');
  assert.equal(await js(`document.getElementById('modal').open`), false);
  // A different account with multiple blogs requires a choice, then updates all targets.
  owned = [{ url: 'https://beta.tistory.com', title: '두 번째 블로그' }, { url: 'https://gamma.tistory.com', title: '세 번째 블로그' }];
  await js(`window.dispatchEvent(new Event('hdev:tistory-login'))`);
  await wait(`!!document.getElementById('account-blog-select')`);
  assert.equal(await js(`document.getElementById('manage-blog').textContent`), '내 블로그 선택 ▾');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'tistory.config.json'))).blogUrl, 'https://alpha.tistory.com');
  assert.equal((await request('/api/categories', 'POST')).status, 409);
  assert.deepEqual(await js(`[...document.getElementById('account-blog-select').options].map(option=>option.value)`), owned.map(blog => blog.url));
  await js(`document.getElementById('account-blog-select').value='https://gamma.tistory.com'`);
  await click('use-account-blog');
  await wait(`document.querySelector('#public-posts h2')?.textContent==='gamma.tistory.com의 글' && !document.getElementById('category-refresh').disabled`);
  assert.equal(readCategories.at(-1), 'https://gamma.tistory.com');
  assert.equal(await js(`document.getElementById('manage-blog').textContent`), '세 번째 블로그 ▾');
  await js(`{const select=document.getElementById('blog-select');select.value='beta';select.dispatchEvent(new Event('change'));}`);
  await wait(`document.querySelector('#public-posts h2')?.textContent==='beta.tistory.com의 글' && !document.getElementById('category-refresh').disabled`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'tistory.config.json'))).blogUrl, 'https://beta.tistory.com');
  assert.equal(await js(`document.getElementById('manage-blog').textContent`), '두 번째 블로그 ▾');
  assert.equal(await js(`document.getElementById('connected-blog-name').textContent`), '두 번째 블로그');
  const evidence = path.resolve('.runtime/account-qa'); fs.mkdirSync(evidence, { recursive: true });
  win.webContents.invalidate(); await pause(200); fs.writeFileSync(path.join(evidence, 'connected.png'), (await win.webContents.capturePage()).toPNG());
  await click('blog-settings-nav'); win.setSize(390, 900); await pause(200);
  assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth`));
  fs.writeFileSync(path.join(evidence, 'mobile.png'), (await win.webContents.capturePage()).toPNG());
  await click('close-modal');
  // Closing login, an empty account and a changed DOM all fail without overwriting configuration.
  const savedConfig = fs.readFileSync(path.join(root, 'tistory.config.json'), 'utf8');
  cancelLogin = true; loggedIn = false;
  await js(`window.dispatchEvent(new Event('hdev:tistory-login'))`);
  await wait(`document.getElementById('tistory-connect-status')?.textContent.includes('로그인 창을 닫았습니다')`);
  assert.equal(server.hasActiveGeneration(), false);
  assert.equal(await js(`document.getElementById('manage-blog').textContent`), '티스토리 로그인');
  cancelLogin = false; loggedIn = true; owned = [];
  let result = await request('/api/tistory/connect', 'POST'); assert.equal(result.status, 400); assert.match(result.data.error, /운영 중인 블로그가 없습니다/);
  invalidPage = true;
  result = await request('/api/tistory/connect', 'POST'); assert.equal(result.status, 400); assert.match(result.data.error, /형식이 바뀌었습니다/);
  assert.equal(fs.readFileSync(path.join(root, 'tistory.config.json'), 'utf8'), savedConfig);
  assert.equal(fs.readFileSync(path.join(root, 'profile.md'), 'utf8'), '보존할 기본 말투');
  assert.equal(fs.readFileSync(path.join(root, 'inbox', savedJob.id, 'notes.md'), 'utf8'), before);
  assert.ok(opened.every(url => url === accountUrl));
  assert.ok(publicRequests.every(url => !url.includes('old-blog') && !url.includes('your-blog')));
  assert.deepEqual(errors, []);
  console.log('PASS: account login, automatic single-blog connection, multiple-blog choice, account switch, public posts and category refresh, ownership checks, cancellation, empty/changed account, CSRF, data preservation and mobile layout.');
  win.destroy(); await new Promise(resolve => server.close(resolve)); app.exit(0);
} catch (error) {
  console.error(error); if (win && !win.isDestroyed()) win.destroy(); if (remote && !remote.isDestroyed()) remote.destroy(); server?.close(); app.exit(1);
}
}
run().catch(error => { console.error(error); app.exit(1); });
