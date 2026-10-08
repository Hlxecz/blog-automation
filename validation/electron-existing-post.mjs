// Production existing-post updater against an isolated editor fixture.
// Every HTTPS request is intercepted; this file cannot modify a real blog.
import { app, BrowserWindow, session } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTistoryPostUpdater } from '../desktop/publish.mjs';
import { parsePublicArticle } from '../scripts/existing-posts.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-existing-post-'));
const png = fs.readFileSync(new URL('../test/fixtures/redis-test.png', import.meta.url));
app.setPath('userData', path.join(root, 'electron'));
app.on('window-all-closed', () => {});

const origin = 'https://example.tistory.com';
const targetUrl = `${origin}/17`;
const publishedAt = '2026-09-10T03:04:05.000Z';
const oldSigned = 'https://blog.kakaocdn.net/dna/photo/img.png?credential=old&expires=1&signature=old';
const freshSigned = 'https://blog.kakaocdn.net/dna/photo/img.png?credential=fresh&expires=2&signature=fresh';
const publicPage = ({ title = '원래 제목', body, tags = ['old'], cover = freshSigned } = {}) => `<!doctype html><html><head>
  <meta property="og:title" content="${title}"><meta property="og:image" content="${cover}">
  <meta property="article:published_time" content="${publishedAt}"></head><body>
  <article id="article"><div class="tt_article_useless_p_margin contents_style">${body}</div></article>
  <div class="tags">${tags.map(tag => `<a href="/tag/${encodeURIComponent(tag)}">${tag}</a>`).join('')}</div></body></html>`;
const originalBody = `<figure class="imageblock" data-ke-type="image" data-ke-filename="original.png"><img src="${oldSigned}" data-url="${oldSigned}" alt="원문 사진"><figcaption>원래 설명</figcaption></figure>
  <p style="color:#243b53"><strong>원래 &lt;값&gt; &amp; $&amp;</strong> <a href="https://example.com/docs">연결</a></p>`;
const imported = parsePublicArticle(publicPage({ body: originalBody }), targetUrl, origin);
const draft = structuredClone(imported.draft);
draft.title = '수정한 제목';
draft.tags = ['new', '특수문자'];
for (const block of draft.blocks.filter(block => block.type === 'rich')) {
  block.segments = block.segments.map(value => value === '원래 설명' ? '바꾼 사진 설명' : value === '원래 <값> & $&' ? '수정 <값> & $&' : value);
}
const manifest = { images: [] };
let omitDateMeta = false;
let skinHidesTags = false;

function managementPage() {
  return `<!doctype html><ul id="posts"><li><a href="/17">원문</a><a href="/manage/observed-edit">수정</a></li>
    <li><a href="/18">다른 글</a><a href="/manage/wrong-edit">수정</a></li></ul>`;
}

function editorPage(panelPost = '17') {
  return `<!doctype html><meta charset="utf-8"><textarea id="post-title-inp">원래 제목</textarea>
  <div><button id="mceu_0-open">사진</button><button id="attach-image" hidden>사진</button><input id="file" type="file" hidden></div>
  <div id="body" contenteditable="true"><figure class="imageblock" data-ke-type="image" data-ke-filename="fresh-editor.png" data-ke-mobilestyle="widthOrigin"><img src="${freshSigned}" data-url="${freshSigned}" alt="원문 사진"><figcaption>원래 설명</figcaption></figure><p style="color:#243b53"><strong>원래 &lt;값&gt; &amp; $&amp;</strong> <a href="https://example.com/docs">연결</a></p></div>
  <div id="tags"></div><input id="tagText"><button id="publish-layer-btn">완료</button>
  <div id="panel" hidden><label><input type="radio" id="open20" checked>공개</label><label><input type="radio" id="open0">비공개</label>
  <div>https://example.tistory.com/<input id="urlPublish" value="${panelPost}" disabled></div><button id="publish-btn">공개 발행</button></div>
  <script>
  const el=id=>document.getElementById(id),body=el('body'),input=el('tagText');window.submits=0;window.events=[];
  function tag(name){const a=document.createElement('a');a.href='/tag/'+encodeURIComponent(name);a.textContent=name;a.setAttribute('aria-label',name+' 태그 수정');a.onclick=e=>{e.preventDefault();input.value=name;input.dataset.editing=name;input.focus()};el('tags').append(a)}tag('old');
  input.onkeydown=e=>{if(e.key!=='Enter')return;e.preventDefault();const name=input.value.trim(),editing=input.dataset.editing;if(editing){[...el('tags').querySelectorAll('a')].find(a=>a.textContent===editing)?.remove();delete input.dataset.editing}if(name)tag(name);input.value=''};
  window.tinymce={get:()=>({initialized:true,getBody:()=>body,setContent:html=>body.innerHTML=html,dispatch:()=>{},fire:()=>{},setDirty:()=>{},save:()=>{}})};
  el('publish-layer-btn').onclick=()=>el('panel').hidden=false;
  el('publish-btn').onclick=()=>{window.events.push('click');window.submits++;const tags=[...el('tags').querySelectorAll('a')].map(a=>a.textContent);const cover=body.querySelector('img')?.src||'';window.published='<!doctype html><html><head><meta property="og-title-placeholder" content=""><meta property="og:title" content="'+el('post-title-inp').value.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"><meta property="og:image" content="'+cover+'">${omitDateMeta ? '' : `<meta property="article:published_time" content="${publishedAt}">`}</head><body><article id="article"><div class="tt_article_useless_p_margin contents_style">'+body.innerHTML+'</div></article><div class="tags">'+tags.map(t=>'<a href="/tag/'+encodeURIComponent(t)+'">'+t+'</a>').join('')+'</div></body></html>'};
  </script>`;
}

async function run() {
  await app.whenReady();
  const isolated = session.fromPartition('existing-post-test');
  let panelPost = '17';
  await isolated.protocol.handle('https', request => {
    const url = new URL(request.url);
    if (url.hostname === 'blog.kakaocdn.net') return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    assert.equal(url.origin, origin);
    if (url.pathname === '/manage/posts') return new Response(managementPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (url.pathname === '/manage/observed-edit') return new Response(editorPage(panelPost), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return new Response(publicPage({ body: originalBody }), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });
  let win;
  const openWindow = url => {
    win = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.loadURL(url); return win;
  };
  const fetchPublic = async url => {
    if (url === `${origin}/rss`) return new Response(`<?xml version="1.0"?><rss><channel><title>fixture</title><item><title>수정한 제목</title><link>${targetUrl}</link><pubDate>${new Date(publishedAt).toUTCString()}</pubDate></item></channel></rss>`, { headers: { 'Content-Type': 'application/xml' } });
    assert.equal(url, targetUrl);
    const html = await win.webContents.executeJavaScript('window.published || null');
    const visible = html || publicPage({ body: originalBody });
    return new Response(skinHidesTags ? visible.replace(/<div class="tags">[\s\S]*?<\/div>/, '') : visible, { headers: { 'Content-Type': 'text/html' } });
  };
  const request = { blogUrl: origin, draft, manifest, directory: root, target: imported.identity, currentSource: imported.source,
    onProgress: () => {}, includeToc: true };
  try {
    let marked = false, checked = false;
    const updater = createTistoryPostUpdater({ openWindow, fetchPublic });
    const result = await updater({ ...request,
      checkRemote: async () => { checked = true; assert.equal(await win.webContents.executeJavaScript('window.submits'), 0); await win.webContents.executeJavaScript("window.events.push('check')"); },
      beforeSubmit: () => { assert.equal(checked, true); marked = true; win.webContents.executeJavaScript("window.events.push('before')"); }
    });
    assert.equal(marked, true); assert.equal(result.url, targetUrl); assert.equal(result.postId, '17');
    assert.equal(result.evidence.samePost, true); assert.equal(result.evidence.public, true); assert.equal(result.evidence.publishedAt, true); assert.equal(result.evidence.cover, true);
    assert.equal(await win.webContents.executeJavaScript('window.submits'), 1);
    assert.deepEqual(await win.webContents.executeJavaScript('window.events'), ['check', 'before', 'click']);
    assert.deepEqual(await win.webContents.executeJavaScript('[...document.querySelectorAll("#tags a")].map(a=>a.textContent)'), draft.tags);
    const saved = await win.webContents.executeJavaScript('document.getElementById("body").innerHTML');
    assert.match(saved, /fresh-editor\.png/); assert.doesNotMatch(saved, /credential=old/);
    assert.match(saved, /바꾼 사진 설명/); assert.match(saved, /수정 &lt;값&gt; &amp; \$&amp;/);
    assert.equal((await win.webContents.executeJavaScript('document.getElementById("open20").checked')), true);
    win.destroy();

    skinHidesTags = true;
    const hidden = parsePublicArticle(publicPage({ body: originalBody }).replace(/<div class="tags">[\s\S]*?<\/div>/, ''), targetUrl, origin);
    assert.equal(hidden.source.tagsObserved, false);
    const legacySource = structuredClone(hidden.source);
    delete legacySource.tagsObserved;
    const hiddenDraft = structuredClone(hidden.draft);
    hiddenDraft.title = '스킨에서 태그가 보이지 않는 글';
    const hiddenResult = await updater({ ...request, draft: hiddenDraft, target: hidden.identity, currentSource: legacySource,
      checkRemote: async () => hidden.source, beforeSubmit: () => {} });
    assert.equal(hiddenResult.evidence.samePost, true);
    assert.deepEqual(await win.webContents.executeJavaScript('[...document.querySelectorAll("#tags a")].map(a=>a.textContent)'), ['old']);
    assert.equal(await win.webContents.executeJavaScript('window.submits'), 1);
    win.destroy();

    const changedTagsDraft = structuredClone(hiddenDraft);
    changedTagsDraft.tags = ['new'];
    const changedTags = await updater({ ...request, draft: changedTagsDraft, target: hidden.identity, currentSource: legacySource,
      checkRemote: async () => hidden.source, beforeSubmit: () => {} });
    assert.equal(changedTags.evidence.samePost, true);
    assert.deepEqual(await win.webContents.executeJavaScript('[...document.querySelectorAll("#tags a")].map(a=>a.textContent)'), ['new']);
    win.destroy();
    skinHidesTags = false;

    panelPost = '18'; let wrongSubmitted = false;
    await assert.rejects(updater({ ...request, checkRemote: async () => assert.fail('wrong target must stop before remote recheck'), beforeSubmit: () => { wrongSubmitted = true; } }), /글 주소.*원문과 다릅/);
    assert.equal(wrongSubmitted, false); assert.equal(await win.webContents.executeJavaScript('window.submits'), 0);
    win.destroy();

    panelPost = '17'; let staleMarked = false;
    await assert.rejects(updater({ ...request, checkRemote: async () => { throw new Error('원문이 변경됨'); }, beforeSubmit: () => { staleMarked = true; } }), /원문이 변경됨/);
    assert.equal(staleMarked, false); assert.equal(await win.webContents.executeJavaScript('window.submits'), 0);
    win.destroy();

    omitDateMeta = true;
    const rssVerified = await updater({ ...request, expectedPublishedAt: publishedAt, checkRemote: async () => imported.source, beforeSubmit: () => {} });
    assert.equal(rssVerified.evidence.publishedAt, true);
    assert.equal(await win.webContents.executeJavaScript('window.submits'), 1);
    console.log('PASS: exact observed edit link, same-post update once, rich special characters, fresh Tistory image metadata/caption, tags, public state, cover and published time (page meta and exact RSS fallback); wrong target and final stale check stop before save. No real Tistory requests.');
    win.destroy(); app.exit(0);
  } catch (error) {
    console.error(error); win?.destroy(); app.exit(1);
  }
}
run().catch(error => { console.error(error); app.exit(1); });
