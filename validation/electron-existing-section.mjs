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
const page=`<html><head><meta property="og:title" content="Exa 사용법"></head><body><article id="article"><div class="tt_article_useless_p_margin contents_style"><div class="contents"><h2>PART 1. Exa가 뭔지</h2><p>첫 문단입니다.</p><p>두 번째 문단에는 <a href="https://exa.ai/">공식 링크</a>가 있습니다.</p><h2>PART 2. 설치 방법</h2><p>설치 설명입니다.</p></div></div></article></body></html>`;
const fetchPublic=async url=>{const value=String(url);if(value.endsWith('/rss'))return new Response(`<rss><channel><title>Example</title><item><title>Exa 사용법</title><link>${post}</link></item></channel></rss>`);if(value.endsWith('/sitemap.xml'))return new Response(`<urlset><url><loc>${post}</loc></url></urlset>`);if(value===post)return new Response(page);throw Error(value);};
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
    await win.loadURL(origin);await wait(`!!document.querySelector('.recent-job')`);await js(`document.querySelector('.recent-job').click()`);await wait(`!!document.querySelector('#article-preview h1')`);await js(`document.querySelector('#edit-view').click()`);
    await wait(`document.querySelectorAll('.existing-section-text').length===2`);
    assert.equal(await js(`document.querySelector('#article-editor').hidden`),false);
    const before=await js(`[...document.querySelectorAll('.existing-section-text')].map(el=>({title:el.previousSibling.textContent,text:el.value}))`);
    assert.match(before[0].title,/PART 1/);assert.match(before[0].text,/첫 문단입니다/);assert.match(before[0].text,/두 번째 문단/);
    assert.match(before[1].title,/PART 2/);assert.match(before[1].text,/설치 설명/);
    await js(`{const el=document.querySelector('.existing-section-text');el.value=el.value.replace('첫 문단입니다.','첫 문단을 수정했습니다.\\n\\n추가 문단입니다.');el.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await js(`document.querySelector('#save-all').click()`);await wait(`document.querySelector('#save-state').textContent==='이 PC에 보관됨'`);
    const saved=(await request(`/api/jobs/${imported.id}`)).draft;
    assert.ok(saved.blocks.some(block=>block.segments?.includes('첫 문단을 수정했습니다.\n\n추가 문단입니다.')));
    assert.match(saved.blocks.filter(block=>block.type==='rich').map(renderRichBlock).join(''),/href="https:\/\/exa.ai\/"/);
    console.log('PASS: one editable box per original heading section; saved text and link retained. No real Tistory requests.');
    win.destroy();server.closeAllConnections();server.close();app.exit(0);
  }catch(error){console.error(error);win?.destroy();server.closeAllConnections();server.close();app.exit(1);}
}
run();
