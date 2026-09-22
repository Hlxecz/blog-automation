// The real app with temporary data and a fake AI. No real blog reads or publishing.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../scripts/server.mjs';
import { writingExamples } from '../scripts/writing-prompts.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-writing-ui-'));
app.setPath('userData', path.join(root, 'electron')); app.on('window-all-closed', () => {});
const blogUrl = 'https://example.tistory.com', defaultPrompt = '기존 기본 블로그용 지침입니다. 자연스러운 존댓말로 개발 경험을 설명합니다.';
const categories = [{blogUrl,id:'0',path:['카테고리 없음']},{blogUrl,id:'10',path:['AI']},{blogUrl,id:'11',path:['AI','뉴스']},{blogUrl,id:'12',path:['AI','인사이트']}];
fs.writeFileSync(path.join(root, 'tistory.config.json'), JSON.stringify({blogUrl,inbox:'inbox',output:'drafts',styleSamples:'samples',styleProfile:'profile.md'}));
fs.writeFileSync(path.join(root, 'profile.md'), defaultPrompt);
const calls = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = createApp({root,checkGenerator:async()=>true,fetchPublic:async()=>{throw new Error('Offline fixture');},categoryReader:async()=>categories,
  generator:async input=>{calls.push(input);await pause(150);return {draft:{title:'오늘의 AI 소식',tags:[],blocks:[{type:'heading',text:'달라진 기능'},{type:'paragraph',text:'확인한 발표 내용을 설명합니다.'}]},analysis:'테스트 분석',review:'',sensitiveImages:[]};}});
const screenshots = path.resolve('.runtime/writing-prompts-qa'); fs.mkdirSync(screenshots,{recursive:true});
let win;
async function run() {
  try {
    await app.whenReady(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin = `http://127.0.0.1:${server.address().port}`, bootstrap = await(await fetch(origin+'/api/bootstrap')).json();
    const request = async (url, method='GET', json) => {
      const response = await fetch(origin+url,{method,headers:{'X-App-Token':bootstrap.token,'Content-Type':'application/json'},body:json===undefined?undefined:JSON.stringify(json)});
      const data = await response.json(); assert.ok(response.ok,JSON.stringify(data)); return data;
    };
    win = new BrowserWindow({show:false,width:1440,height:1040,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true}});
    const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
    const js=code=>win.webContents.executeJavaScript(code);
    const wait=async condition=>{for(let i=0;i<220;i++){if(await js(condition))return;await pause(60);}throw new Error(`Timed out: ${condition}`);};
    const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click()`);
    const select=(id,value)=>js(`{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));}`);
    const type=value=>js(`{const el=document.getElementById('category-prompt');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));}`);
    const capture=async name=>{win.webContents.invalidate();await pause(300);fs.writeFileSync(path.join(screenshots,name+'.png'),(await win.webContents.capturePage()).toPNG());};
    await win.loadURL(origin);await wait(`!document.getElementById('category-section').hidden&&!document.getElementById('draft-category').disabled`);
    await click('category-refresh');await wait(`document.getElementById('draft-category').options.length===3`);
    assert.deepEqual(await js(`[...document.getElementById('draft-category').options].map(option=>option.textContent)`),['카테고리 없음','뉴스','인사이트']);
    await select('draft-category','11');await wait(`document.getElementById('save-state').textContent==='이 PC에 보관됨'`);
    const jobs=await request('/api/jobs');assert.equal(jobs.length,1);const id=jobs[0].id;
    assert.equal((await request(`/api/jobs/${id}`)).draft,null);assert.deepEqual((await request(`/api/jobs/${id}`)).category,categories[2]);
    await click('writing-prompt-settings');await wait(`!document.getElementById('style-page').hidden`);
    assert.equal(await js(`document.getElementById('style-profile').value`),defaultPrompt);
    assert.equal(await js(`document.getElementById('prompt-category').value`),JSON.stringify(categories[2]));
    assert.deepEqual(await js(`[...document.getElementById('prompt-category').options].map(option=>option.textContent)`),['카테고리 없음','뉴스','인사이트']);
    for (const example of writingExamples) {
      await select('prompt-example',example.id);await click('apply-prompt-example');
      assert.equal(await js(`document.getElementById('category-prompt').value`),example.prompt);
    }
    const newsPrompt='뉴스는 핵심 발표와 개발자에게 주는 영향 순서로 씁니다. 문장 끝은 합니다로 통일합니다.';
    const insightPrompt='인사이트는 질문, 근거, 다른 해석, 적용 기준 순서로 설명합니다.';
    await type(newsPrompt);await select('prompt-category',JSON.stringify(categories[3]));await type(insightPrompt);
    await select('prompt-category',JSON.stringify(categories[2]));assert.equal(await js(`document.getElementById('category-prompt').value`),newsPrompt);
    await click('save-category-prompt');await wait(`document.getElementById('save-category-prompt').disabled&&!document.getElementById('category-prompt').disabled`);
    await select('prompt-category',JSON.stringify(categories[3]));assert.equal(await js(`document.getElementById('category-prompt').value`),insightPrompt);
    await click('save-category-prompt');await wait(`document.getElementById('category-prompt-state').textContent==='저장된 지침'`);
    assert.equal((await request('/api/writing-prompts')).profiles.length,2);
    assert.equal(fs.readFileSync(path.join(root,'profile.md'),'utf8'),defaultPrompt);
    await select('prompt-category',JSON.stringify(categories[2]));
    await type(newsPrompt+' 짧게 씁니다.');
    const external=await request('/api/writing-prompts');await request('/api/writing-prompts','PUT',{category:categories[2],prompt:'다른 창의 지침',revision:external.revision});
    await click('save-category-prompt');await wait(`!document.getElementById('reload-category-prompt').hidden`);
    assert.equal(await js(`document.getElementById('category-prompt').value`),newsPrompt+' 짧게 씁니다.');
    await click('reload-category-prompt');await wait(`document.getElementById('category-prompt').value==='다른 창의 지침'`);
    await click('undo-category-prompt');await click('save-category-prompt');await wait(`document.getElementById('category-prompt-state').textContent==='저장된 지침'`);
    await js(`document.getElementById('toast').hidden=true`);await capture('desktop');
    win.setSize(390,1040);await pause(150);await js(`if(document.getElementById('sidebar-toggle').getAttribute('aria-expanded')==='true')document.getElementById('sidebar-toggle').click();window.scrollTo(0,0)`);await capture('mobile');
    assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth`));
    const uploaded=await fetch(`${origin}/api/jobs/${id}/images?name=fixture.png`,{method:'POST',headers:{'X-App-Token':bootstrap.token},body:fs.readFileSync(new URL('../test/fixtures/redis-test.png',import.meta.url))});assert.ok(uploaded.ok);
    win.setSize(1440,1040);await win.reload();await wait(`!document.getElementById('generate').disabled`);
    assert.equal(await js(`document.getElementById('draft-category').value`),'11');
    await click('generate');await wait(`!!document.querySelector('#article-preview h1')&&!document.getElementById('generate').disabled`);
    assert.equal(calls.length,1);assert.equal(calls[0].style,defaultPrompt);assert.equal(calls[0].writing.prompt,newsPrompt+' 짧게 씁니다.');
    assert.deepEqual((await request(`/api/jobs/${id}`)).draft.category,categories[2]);
    await click('writing-prompt-settings');await wait(`!document.getElementById('style-page').hidden`);
    await click('clear-category-prompt');await click('save-category-prompt');await wait(`document.getElementById('category-prompt-state').textContent==='저장된 지침'`);
    assert.equal((await request('/api/writing-prompts')).profiles.length,1);
    await click('style-back');await click('generate');await wait(`document.getElementById('generate').disabled`);await wait(`!document.getElementById('generate').disabled`);
    assert.equal(calls.length,2);assert.equal(calls[1].writing.prompt,'');assert.equal(calls[1].style,defaultPrompt);
    assert.equal(fs.readFileSync(path.join(root,'profile.md'),'utf8'),defaultPrompt);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks:['pre-draft category persistence','five editable examples','default prompt preserved','unsaved category switching','separate saves','conflict recovery','first-generation prompt routing','default fallback','mobile layout'],screenshots}));
    win.destroy();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});app.exit(0);
  } catch(error) {console.error(error);if(win&&!win.isDestroyed())win.destroy();server.close();app.exit(1);}
}
run().catch(error=>{console.error(error);app.exit(1);});
