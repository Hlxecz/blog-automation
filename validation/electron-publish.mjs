// Runs the production driver against an isolated, local editor fixture.
// All HTTPS requests in this session are intercepted; no blog is contacted.
import { app, BrowserWindow, session } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createTistoryPublisher, createTistoryCategoryReader } from '../desktop/publish.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-electron-test-'));
app.setPath('userData', path.join(root, 'electron'));
app.on('window-all-closed', () => {});
async function run() {
await app.whenReady();
const isolated = session.fromPartition('publish-test');
const png = fs.readFileSync(new URL('../test/fixtures/redis-test.png', import.meta.url));
const editor = `<!doctype html><meta charset="utf-8"><textarea id="post-title-inp"></textarea>
<button id="category-btn" role="combobox" aria-controls="category-list" aria-expanded="false"><i class="mce-txt">카테고리</i><i>더보기</i></button><div id="category-menu"></div>
<div><button id="mceu_0-open">사진 메뉴</button><button id="attach-image" hidden>사진</button><input id="file" type="file" hidden></div>
<div id="body" contenteditable="true"></div><div><span id="tags"></span><span><input id="tagText"></span></div>
<button id="publish-layer-btn">완료</button><div id="panel" hidden><label><input type="radio" id="open20">공개</label>
<label><input type="radio" id="open0" checked>비공개</label><div>https://example.tistory.com/entry/<input id="urlPublish" value="a-title" disabled></div><button id="publish-btn">비공개 저장</button></div>
<script>
const el=id=>document.getElementById(id), body=el('body');let uploads=0;window.submits=0;
let categoryItems=[{id:'0',path:['카테고리 없음']},{id:'10',path:['Language']},{id:'11',path:['Language','Java']},{id:'20',path:['Study']},{id:'21',path:['Study','Java']}];window.selectedCategory='0';
/* fixture-category-variant */
el('category-btn').onclick=()=>{
  if(el('category-btn').getAttribute('aria-expanded')==='true'){el('category-menu').replaceChildren();el('category-btn').setAttribute('aria-expanded','false');return;}
  const list=document.createElement('div');list.id='category-list';list.setAttribute('role','listbox');
  for(const item of categoryItems){const option=document.createElement('div');const label=(item.path.length===2?'- ':'')+item.path.at(-1);option.id='category-item-'+item.id;option.setAttribute('role','option');option.setAttribute('category-id',item.id);option.setAttribute('aria-label',label);option.setAttribute('aria-selected',String(item.id==='0'));option.textContent=label;option.onclick=()=>{window.selectedCategory=item.id;el('category-btn').querySelector('.mce-txt').textContent=item.id==='0'?'카테고리':item.path.at(-1);el('category-menu').replaceChildren();el('category-btn').setAttribute('aria-expanded','false');};list.append(option);}
  el('category-menu').append(list);el('category-btn').setAttribute('aria-expanded','true');
};
/* fixture-recovered-draft */
window.tinymce={get:()=>({initialized:true,getBody:()=>body,getContent:()=>'[##_Image|image-shortcode|_##]',setContent:html=>{body.innerHTML=html},fire:()=>{},setDirty:()=>{},save:()=>{}})};
el('mceu_0-open').onclick=()=>el('attach-image').hidden=false;
el('attach-image').onclick=()=>el('file').click();
el('file').onchange=()=>{if(el('file').files[0]?.size>0)body.insertAdjacentHTML('beforeend','<figure class="imageblock"><img src="https://example.tistory.com/test-photo/'+(++uploads)+'.png"></figure>');el('file').value=''};
el('tagText').onkeydown=e=>{if(e.key==='Enter'){const tag=document.createElement('a');tag.textContent=e.target.value;tag.setAttribute('aria-label',e.target.value+' 태그 수정');el('tags').append(tag);e.target.value=''}};
el('publish-layer-btn').onclick=()=>el('panel').hidden=false;
el('open20').onclick=()=>{el('open0').checked=false;el('publish-btn').textContent='공개 발행'};
el('publish-btn').onclick=()=>{if(!el('open20').checked)throw Error('not public');window.submits++;const category=categoryItems.find(item=>item.id===window.selectedCategory);window.published='<html><head><meta property="og:title" content="'+el('post-title-inp').value+'"><meta property="og:image" content="'+body.querySelector('img').src+'"></head><body>'+(category.id==='0'?'':'<a class="category" href="/category/'+category.path.map(encodeURIComponent).join('/')+'">'+category.path.join('/')+'</a>')+body.innerHTML+'</body></html>'};
</script>`;
let missingCategory=false,recoveredDraft=false;
await isolated.protocol.handle('https', request => {
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://example.tistory.com');
  if (url.pathname.startsWith('/test-photo/')) return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  const fixture=editor.replace('/* fixture-category-variant */',missingCategory?"categoryItems=categoryItems.filter(item=>item.id!=='21');":'').replace('/* fixture-recovered-draft */',recoveredDraft?"el('post-title-inp').value='복구된 초안';body.textContent='유지할 본문';":'');
  return new Response(url.pathname === '/manage' ? '<a href="/manage/newpost/">글쓰기</a>' : fixture, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});
let win;
const openWindow = url => { win = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false } }); win.loadURL(url); return win; };
fs.mkdirSync(path.join(root, 'images'));
for (const file of ['one.png', 'two.png', 'cover.png']) fs.writeFileSync(path.join(root, 'images', file), png);
const draft = { title: '검증한 글', tags: ['Redis', '테스트'], cover:'one.png',
  category:{blogUrl:'https://example.tistory.com',id:'21',path:['Study','Java']},
  githubCard:{icon:'📚',categoryLabel:'주제',topic:'연결 오류 해결',sourceLabel:'GitHub',url:'https://github.com/example/project',linkText:'관련 코드',description:'설정과 확인 과정을 정리합니다.'}, blocks: [
  { type: 'heading', text: '문서 디자인 확인' },
  { type: 'paragraph', text: '입력한 본문입니다.\n줄바꿈도 확인합니다.' },
  { type: 'paragraph', text: '💡 팁 | 확인 기준\n사진과 설명을 함께 확인합니다.' },
  { type: 'paragraph', text: '⚠️ 주의 | 검토 항목\n입력한 내용을 유지합니다.' },
  { type: 'image', file: 'two.png', alt: '두 번째 사진', caption: '먼저 놓은 사진' },
  { type: 'code', text: 'console.log("test");' },
  { type: 'image', file: 'one.png', alt: '첫 번째 사진', caption: '' }
] };
const manifest = { images: ['one.png', 'two.png'].map(name => ({ name, sha256: createHash('sha256').update(png).digest('hex') })) };
try {
  const reader=createTistoryCategoryReader({openWindow});
  const categories=await reader({blogUrl:'https://example.tistory.com'});
  assert.equal(categories.length,5);assert.deepEqual(categories[4],draft.category);
  recoveredDraft=true;
  assert.equal((await reader({blogUrl:'https://example.tistory.com'})).length,5);
  assert.equal(win.isDestroyed(),false);assert.equal(await win.webContents.executeJavaScript('document.getElementById("post-title-inp").value'),'복구된 초안');
  win.destroy();recoveredDraft=false;
  let marked = false;
  const publisher = createTistoryPublisher({ openWindow, fetchPublic: async url => {
    if (url.endsWith('/rss')) return new Response('', { status: 404 });
    assert.equal(marked, true);
    assert.equal(await win.webContents.executeJavaScript('window.submits'), 1);
    const first = await win.webContents.executeJavaScript('document.querySelector("#body img").outerHTML');
    assert.match(first,/첫 번째 사진/);
    assert.match(first,/test-photo\/1\.png/);
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#body img").length'),2);
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#body .hdev-toc a").length'),1);
    assert.equal(await win.webContents.executeJavaScript('document.querySelector("#body .hdev-toc").nextElementSibling.getAttribute("data-hdev-github-card")'),'true');
    assert.equal(await win.webContents.executeJavaScript('document.querySelector("#body .hdev-github-link").href'),draft.githubCard.url);
    assert.equal(await win.webContents.executeJavaScript('document.querySelector("#body .hdev-github-card").style.backgroundColor'),'rgb(246, 248, 250)');
    assert.equal(await win.webContents.executeJavaScript('document.querySelector("#body .hdev-tip").style.borderLeftWidth'),'4px');
    assert.equal(await win.webContents.executeJavaScript('document.querySelector("#body .hdev-warning").style.backgroundColor'),'rgb(255, 248, 237)');
    return new Response(await win.webContents.executeJavaScript('window.published'));
  } });
  const result = await publisher({ blogUrl: 'https://example.tistory.com', draft, manifest, directory: root,
    onProgress: phase => console.log(`fixture: ${phase}`), beforeSubmit: () => { marked = true; } });
  assert.equal(result.url, 'https://example.tistory.com/entry/a-title');
  assert.equal(result.evidence.images, true);
  assert.equal(result.evidence.cover, true);
  assert.equal(result.evidence.category, true);
  assert.equal(await win.webContents.executeJavaScript('window.selectedCategory'),'21');
  win.destroy();
  const dry = createTistoryPublisher({ openWindow, onDryRun: async () => {
    assert.equal(await win.webContents.executeJavaScript('window.submits'), 0);
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#body img").length'),3);
    assert.equal(await win.webContents.executeJavaScript('document.querySelector("#body img").alt'),'검증한 글 표지');
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#body .hdev-toc").length'),0);
    assert.equal(await win.webContents.executeJavaScript('document.querySelector("#body").firstElementChild.getAttribute("data-hdev-github-card")'),'true');
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#body h2").length'),1);
    assert.equal(await win.webContents.executeJavaScript('window.selectedCategory'),'0');
  } });
  await assert.rejects(dry({ blogUrl: 'https://example.tistory.com', draft:{...draft,category:undefined,cover:'cover.png'}, manifest:{...manifest,coverImages:[{name:'cover.png',sha256:createHash('sha256').update(png).digest('hex')}]}, directory: root,
    includeToc:false,onProgress: () => {}, beforeSubmit: () => assert.fail('dry run must never submit') }), /검증 모드/);
  win.destroy();
  const noCategory=createTistoryPublisher({openWindow,onDryRun:async()=>{assert.equal(await win.webContents.executeJavaScript('window.selectedCategory'),'0');}});
  await assert.rejects(noCategory({blogUrl:'https://example.tistory.com',draft:{...draft,category:categories[0]},manifest,directory:root,onProgress:()=>{},beforeSubmit:()=>assert.fail('must not submit')}),/검증 모드/);
  win.destroy();missingCategory=true;
  await assert.rejects(publisher({blogUrl:'https://example.tistory.com',draft,manifest,directory:root,onProgress:()=>{},beforeSubmit:()=>assert.fail('missing category must not submit')}),/카테고리가 삭제/);
  assert.equal(await win.webContents.executeJavaScript('window.submits'),0);assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#body img").length'),0);
  console.log('PASS: category read and recovered-draft preservation; duplicate child names selected by ID; missing category stops before upload; category-none and legacy default; uploads, cover, body, tags, one submission, public category verification, dry run. No real Tistory requests.');
  win.destroy(); app.exit(0);
} catch (error) { console.error(error); win?.destroy(); app.exit(1); }
}
run().catch(error => { console.error(error); app.exit(1); });
