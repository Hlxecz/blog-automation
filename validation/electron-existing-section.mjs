import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../scripts/server.mjs';
import { renderRichBlock } from '../scripts/existing-posts.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'hdev-existing-section-'));
app.setPath('userData',path.join(root,'electron'));
app.on('window-all-closed',()=>{});
fs.writeFileSync(path.join(root,'tistory.config.json'),JSON.stringify({blogUrl:'https://example.tistory.com',inbox:'inbox',output:'drafts',styleSamples:'style',styleProfile:'style.md'}));
fs.writeFileSync(path.join(root,'style.md'),'말투');
const post='https://example.tistory.com/17';
const page=`<html><head><meta property="og:title" content="Aside 사용법"></head><body><article id="article"><div class="tt_article_useless_p_margin contents_style"><div class="contents"><h2>3. 무료 플랜과 크레딧</h2><p>첫 문단입니다.</p><p>두 번째 문단에는 <a href="https://exa.ai/">공식 링크</a>가 있습니다.</p><table><tbody><tr><td>요금제</td><td>가격</td><td>사용량</td></tr><tr><td>Free</td><td>무료</td><td>월 500크레딧</td></tr><tr><td>Pro</td><td>월 <b>$20</b></td><td>무료의 3배</td></tr></tbody></table><div class="hdev-callout hdev-warning"><p class="hdev-callout-title">⚠️ 주의 | 크레딧 소비량</p><p class="hdev-callout-body">작은 작업으로 먼저 확인합니다.</p></div><h2>4. 설치 방법</h2><p>설치 설명입니다.</p></div></div></article></body></html>`;
const fetchPublic=async url=>{const value=String(url);if(value.endsWith('/rss'))return new Response(`<rss><channel><title>Example</title><item><title>Aside 사용법</title><link>${post}</link></item></channel></rss>`);if(value.endsWith('/sitemap.xml'))return new Response(`<urlset><url><loc>${post}</loc></url></urlset>`);if(value===post)return new Response(page);throw Error(value);};
const server=createApp({root,checkGenerator:async()=>true,fetchPublic});
let win;
async function run(){
  try{
    await app.whenReady();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`,boot=await(await fetch(`${origin}/api/bootstrap`)).json();
    const request=async(route,method='GET',body)=>{const response=await fetch(origin+route,{method,headers:{'X-App-Token':boot.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;};
    await request('/api/blogs/example/sync','POST');const imported=await request('/api/blogs/example/import','POST',{url:post});
    win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{offscreen:true,sandbox:true,nodeIntegration:false,contextIsolation:true}});
    const js=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const wait=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await pause(50);}throw Error(`Timed out: ${code}`);};
    await win.loadURL(origin);await wait(`!!document.querySelector('.recent-job')`);await js(`document.querySelector('.recent-job').click()`);await wait(`!!document.querySelector('#article-preview h1')`);
    assert.equal(await js(`document.querySelectorAll('#article-preview iframe').length`),0);
    assert.equal(await js(`document.querySelectorAll('#article-preview table tr').length`),3);
    assert.equal(await js(`!!document.querySelector('#article-preview .hdev-warning')`),true);
    await js(`document.querySelector('#edit-view').click()`);
    await wait(`document.querySelectorAll('.existing-source-section').length===2`);
    assert.equal(await js(`document.querySelector('#article-editor').hidden`),false);
    const before=await js(`[...document.querySelectorAll('.existing-source-section')].map(el=>({text:el.textContent,tableRows:el.querySelectorAll('table tr').length,warning:!!el.querySelector('.hdev-warning')}))`);
    assert.match(before[0].text,/3\. 무료 플랜/);assert.match(before[0].text,/월 \$20/);assert.equal(before[0].tableRows,3);assert.equal(before[0].warning,true);
    assert.equal(await js(`getComputedStyle(document.querySelector('.hdev-warning')).backgroundColor`),'rgb(255, 248, 237)');
    assert.match(before[1].text,/4\. 설치 방법/);assert.match(before[1].text,/설치 설명/);
    assert.equal(await js(`document.querySelector('.existing-source-editor').textContent.includes('\\u2063')`),false);
    assert.equal(await js(`document.querySelectorAll('.existing-section-text').length`),0);
    assert.equal(await js(`document.querySelector('.existing-editable').getAttribute('contenteditable')`),'plaintext-only');
    await js(`{const cell=[...document.querySelectorAll('.existing-source-section td')].find(el=>el.textContent.includes('$20'));const price=[...cell.querySelectorAll('.existing-editable')].find(el=>el.textContent==='$20');price.textContent='$25';price.dispatchEvent(new Event('input',{bubbles:true}));const warning=document.querySelector('.hdev-callout-body .existing-editable');warning.textContent='작은 작업으로 먼저 확인하고 기록합니다.';warning.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await js(`document.querySelector('#save-all').click()`);await wait(`document.querySelector('#save-state').textContent==='이 PC에 보관됨'`);
    const saved=(await request(`/api/jobs/${imported.id}`)).draft;
    const rendered=saved.blocks.filter(block=>block.type==='rich').map(renderRichBlock).join('');
    assert.match(rendered,/href="https:\/\/exa.ai\/"/);assert.match(rendered,/<table>/);assert.match(rendered,/월 <b>\$25<\/b>/);assert.match(rendered,/hdev-callout-body/);assert.match(rendered,/작은 작업으로 먼저 확인하고 기록합니다/);
    assert.match(rendered,/월 500크레딧/);assert.match(rendered,/설치 설명입니다/);assert.doesNotMatch(rendered,/\u2063/);
    await win.reload();await wait(`document.querySelectorAll('.existing-source-section').length===2`);
    assert.match(await js(`document.querySelector('.existing-source-section').textContent`),/월 \$25/);
    console.log('PASS: original heading sections render editable paragraphs, table cells and warning box without hidden separators; edits save and reopen with URL, link and other cells intact. No real Tistory requests.');
    win.destroy();server.closeAllConnections();server.close();app.exit(0);
  }catch(error){console.error(error);win?.destroy();server.closeAllConnections();server.close();app.exit(1);}
}
run();
