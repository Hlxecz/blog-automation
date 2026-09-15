import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { blogAddress, parseFeed, parseSitemap, createLibrary } from '../scripts/tistory.mjs';
import { initializeData } from '../desktop/data.mjs';
import { createApp } from '../scripts/server.mjs';

const origin = 'https://sample-blog.tistory.com';
const rss = `<rss><channel><title>Sample Blog</title><item><title>Stack &amp;amp; Deque</title><link>${origin}/17</link><category>Java</category><pubDate>Mon, 26 Jan 2026 19:03:55 +0900</pubDate><description>&lt;p&gt;공개 글&lt;/p&gt;</description></item><item><link>https://elsewhere.example/2</link></item></channel></rss>`;
const sitemap = `<urlset><url><loc>${origin}/17</loc></url><url><loc>${origin}/2</loc></url><url><loc>${origin}/m/2</loc></url><url><loc>${origin}/category/Java</loc></url><url><loc>http://127.0.0.1/3</loc></url></urlset>`;
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-desktop-test-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('hdev-desktop-test-')); fs.rmSync(root, { recursive:true, force:true }); });
  return root;
}
test('public sources decode titles and admit only same-blog article URLs', () => {
  assert.equal(parseFeed(rss, origin).posts[0].title, 'Stack & Deque');
  assert.equal(parseFeed(rss, origin).posts[0].summary, '공개 글');
  assert.equal(parseFeed(rss, origin).posts.length, 1);
  assert.deepEqual(parseSitemap(sitemap, origin), [`${origin}/17`, `${origin}/2`]);
  for (const url of ['http://localhost', 'https://127.0.0.1', 'https://sample-blog.tistory.com.evil.test', 'https://user:password@sample-blog.tistory.com', 'https://sample-blog.tistory.com:9443', `${origin}/17`]) assert.throws(() => blogAddress(url));
});
test('sitemap expands RSS history, concurrent sync deduplicates, failed refresh keeps cache', async t => {
  const root = temp(t); let offline = false, calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.equal(options.redirect, 'manual'); if (offline) throw new Error('offline');
    return new Response(url.endsWith('/rss') ? rss : url.endsWith('/sitemap.xml') ? sitemap : '<meta property="og:title" content="오래된 글"><meta property="og:description" content="예전 개발 기록">');
  };
  const library = createLibrary(root, origin, fetcher);
  const [a,b] = await Promise.all([library.sync('sample-blog'), library.sync('sample-blog')]);
  assert.equal(calls, 3); assert.deepEqual(a,b); assert.equal(a.posts.length, 2); assert.equal(a.posts[1].title, '오래된 글');
  library.add('https://another.tistory.com'); assert.equal(library.list().length,2);
  offline = true; await assert.rejects(library.sync('sample-blog')); assert.deepEqual(library.read('sample-blog'),a);
});
test('packaged assets stay separate from writable data and initialization preserves edits', async t => {
  const root = temp(t), bundle = path.resolve('.');
  initializeData(root, bundle);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'tistory.config.json'))).blogUrl, 'https://your-blog.tistory.com');
  assert.equal(fs.readFileSync(path.join(root,'style/profile.md'),'utf8'), fs.readFileSync(path.join(bundle,'config/style.example.md'),'utf8'));
  const configFile = path.join(root,'tistory.config.json');
  const localConfig = {...JSON.parse(fs.readFileSync(configFile)), blogUrl: 'https://existing-user.tistory.com'};
  fs.writeFileSync(configFile, JSON.stringify(localConfig));
  fs.writeFileSync(path.join(root,'style/profile.md'), '수정한 말투');
  initializeData(root,bundle); assert.equal(fs.readFileSync(path.join(root,'style/profile.md'),'utf8'),'수정한 말투');
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile)), localConfig);
  const files = JSON.parse(fs.readFileSync(path.join(bundle,'package.json'))).build.files;
  assert.ok(files.includes('config/**/*'));
  for (const privateFile of ['tistory.config.json','style/profile.md','style/samples/source-notes.md','ai.settings.json']) assert.equal(files.includes(privateFile), false);
  assert.equal(fs.existsSync(path.join(root,'web')),false);
  const server = createApp({root,webRoot:path.join(bundle,'web'),checkGenerator:async()=>true});
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(base)).text(),/티스토리 기존 글 목록/);
  const boot=await (await fetch(base+'/api/bootstrap')).json(); assert.equal(boot.style,'수정한 말투');
  const add=await fetch(base+'/api/blogs',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':boot.token},body:JSON.stringify({url:'https://another.tistory.com'})});
  assert.equal(add.status,201); assert.equal((await add.json()).length,2);
  assert.equal((await fetch(base+'/api/blogs',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
});
