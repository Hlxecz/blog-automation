// Runs the production driver against an isolated, local editor fixture.
// All HTTPS requests in this session are intercepted; no blog is contacted.
import { app, BrowserWindow, session } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createTistoryPublisher } from '../desktop/publish.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-electron-test-'));
app.setPath('userData', path.join(root, 'electron'));
app.on('window-all-closed', () => {});
async function run() {
await app.whenReady();
const isolated = session.fromPartition('publish-test');
const png = fs.readFileSync(new URL('../test/fixtures/redis-test.png', import.meta.url));
const editor = `<!doctype html><meta charset="utf-8"><textarea id="post-title-inp"></textarea>
<div><button id="mceu_0-open">사진 메뉴</button><button id="attach-image" hidden>사진</button><input id="file" type="file" hidden></div>
<div id="body" contenteditable="true"></div><div><span id="tags"></span><span><input id="tagText"></span></div>
<button id="publish-layer-btn">완료</button><div id="panel" hidden><label><input type="radio" id="open20">공개</label>
<label><input type="radio" id="open0" checked>비공개</label><div>https://example.tistory.com/entry/<input id="urlPublish" value="a-title" disabled></div><button id="publish-btn">비공개 저장</button></div>
<script>
const el=id=>document.getElementById(id), body=el('body');let uploads=0;window.submits=0;
window.tinymce={get:()=>({initialized:true,getBody:()=>body,getContent:()=>'[##_Image|image-shortcode|_##]',setContent:html=>{body.innerHTML=html},fire:()=>{},setDirty:()=>{},save:()=>{}})};
el('mceu_0-open').onclick=()=>el('attach-image').hidden=false;
el('attach-image').onclick=()=>el('file').click();
el('file').onchange=()=>{if(el('file').files[0]?.size>0)body.insertAdjacentHTML('beforeend','<figure class="imageblock"><img src="https://example.tistory.com/test-photo/'+(++uploads)+'.png"></figure>');el('file').value=''};
el('tagText').onkeydown=e=>{if(e.key==='Enter'){const tag=document.createElement('a');tag.textContent=e.target.value;tag.setAttribute('aria-label',e.target.value+' 태그 수정');el('tags').append(tag);e.target.value=''}};
el('publish-layer-btn').onclick=()=>el('panel').hidden=false;
el('open20').onclick=()=>{el('open0').checked=false;el('publish-btn').textContent='공개 발행'};
el('publish-btn').onclick=()=>{if(!el('open20').checked)throw Error('not public');window.submits++;window.published='<html><head><meta property="og:title" content="'+el('post-title-inp').value+'"><meta property="og:image" content="'+body.querySelector('img').src+'"></head><body>'+body.innerHTML+'</body></html>'};
</script>`;
await isolated.protocol.handle('https', request => {
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://example.tistory.com');
  if (url.pathname.startsWith('/test-photo/')) return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  return new Response(url.pathname === '/manage' ? '<a href="/manage/newpost/">글쓰기</a>' : editor, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});
let win;
const openWindow = url => { win = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false } }); win.loadURL(url); return win; };
fs.mkdirSync(path.join(root, 'images'));
for (const file of ['one.png', 'two.png', 'cover.png']) fs.writeFileSync(path.join(root, 'images', file), png);
const draft = { title: '검증한 글', tags: ['Redis', '테스트'], cover:'one.png', blocks: [
  { type: 'paragraph', text: '입력한 본문입니다.\n줄바꿈도 확인합니다.' },
  { type: 'image', file: 'two.png', alt: '두 번째 사진', caption: '먼저 놓은 사진' },
  { type: 'code', text: 'console.log("test");' },
  { type: 'image', file: 'one.png', alt: '첫 번째 사진', caption: '' }
] };
const manifest = { images: ['one.png', 'two.png'].map(name => ({ name, sha256: createHash('sha256').update(png).digest('hex') })) };
try {
  let marked = false;
  const publisher = createTistoryPublisher({ openWindow, fetchPublic: async url => {
    if (url.endsWith('/rss')) return new Response('', { status: 404 });
    assert.equal(marked, true);
    assert.equal(await win.webContents.executeJavaScript('window.submits'), 1);
    const first = await win.webContents.executeJavaScript('document.querySelector("#body img").outerHTML');
    assert.match(first,/첫 번째 사진/);
    assert.match(first,/test-photo\/1\.png/);
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#body img").length'),2);
    return new Response(await win.webContents.executeJavaScript('window.published'));
  } });
  const result = await publisher({ blogUrl: 'https://example.tistory.com', draft, manifest, directory: root,
    onProgress: phase => console.log(`fixture: ${phase}`), beforeSubmit: () => { marked = true; } });
  assert.equal(result.url, 'https://example.tistory.com/entry/a-title');
  assert.equal(result.evidence.images, true);
  assert.equal(result.evidence.cover, true);
  win.destroy();
  const dry = createTistoryPublisher({ openWindow, onDryRun: async () => {
    assert.equal(await win.webContents.executeJavaScript('window.submits'), 0);
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#body img").length'),3);
    assert.equal(await win.webContents.executeJavaScript('document.querySelector("#body img").alt'),'검증한 글 표지');
  } });
  await assert.rejects(dry({ blogUrl: 'https://example.tistory.com', draft:{...draft,cover:'cover.png'}, manifest:{...manifest,coverImages:[{name:'cover.png',sha256:createHash('sha256').update(png).digest('hex')}]}, directory: root,
    onProgress: () => {}, beforeSubmit: () => assert.fail('dry run must never submit') }), /검증 모드/);
  console.log('PASS: Electron file chooser, selected cover uploaded and placed first without duplicates, ordered body, tags, public selection, one submission, public verification, and dry run. No real Tistory requests.');
  win.destroy(); app.exit(0);
} catch (error) { console.error(error); win?.destroy(); app.exit(1); }
}
run().catch(error => { console.error(error); app.exit(1); });
