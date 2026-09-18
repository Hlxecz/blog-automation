// Real app UI with disposable data and an offline category reader. No blog writes.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../scripts/server.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'hdev-category-ui-'));
app.setPath('userData',path.join(root,'electron'));app.on('window-all-closed',()=>{});
fs.writeFileSync(path.join(root,'tistory.config.json'),JSON.stringify({blogUrl:'https://example.tistory.com',inbox:'inbox',output:'drafts',styleSamples:'samples',styleProfile:'profile.md'}));
fs.writeFileSync(path.join(root,'profile.md'),'확인한 내용을 설명합니다.');
const blogUrl='https://example.tistory.com';
let items=[{blogUrl,id:'0',path:['카테고리 없음']},{blogUrl,id:'10',path:['Language']},{blogUrl,id:'11',path:['Language','Java']},{blogUrl,id:'20',path:['Study']},{blogUrl,id:'21',path:['Study','Java']}],failRead=false;
const baseDraft={title:'카테고리를 고른 개발 기록',tags:['Java'],blocks:[{type:'heading',text:'스택의 구조'},{type:'paragraph',text:'원하는 카테고리를 선택하고 초안과 함께 보관합니다.'}]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const server=createApp({root,checkGenerator:async()=>true,fetchPublic:async()=>{throw new Error('Offline fixture');},categoryReader:async()=>{await pause(300);if(failRead)throw new Error('로그인 창이 닫혔습니다.');return items;},generator:async()=>{await pause(250);return {draft:structuredClone(baseDraft),analysis:'',review:'',sensitiveImages:[]};}});
const screenshots=path.resolve('.runtime/category-qa');fs.mkdirSync(screenshots,{recursive:true});
let win;
async function run() {
try {
  await app.whenReady();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,bootstrap=await(await fetch(origin+'/api/bootstrap')).json();
  const request=async(url,method='GET',json)=>{
    const response=await fetch(origin+url,{method,headers:{'X-App-Token':bootstrap.token,'Content-Type':'application/json'},body:json===undefined?undefined:JSON.stringify(json)});
    const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;
  };
  const createJob=async title=>{
    const job=await request('/api/jobs','POST',{title});
    assert.ok((await fetch(`${origin}/api/jobs/${job.id}/images?name=fixture.png`,{method:'POST',headers:{'X-App-Token':bootstrap.token},body:fs.readFileSync(new URL('../test/fixtures/redis-test.png',import.meta.url))})).ok);
    await request(`/api/jobs/${job.id}/draft`,'PUT',{draft:{...baseDraft,title},review:''});return job;
  };
  const job=await createJob(baseDraft.title);
  win=new BrowserWindow({show:false,width:1440,height:1040,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true}});
  const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async condition=>{for(let i=0;i<180;i++){if(await js(condition))return;await pause(60);}throw new Error(`Timed out: ${condition}`);};
  const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click()`);
  const select=value=>js(`{const el=document.getElementById('draft-category');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));}`);
  const saved=async()=>{await click('save-all');await wait(`document.getElementById('save-state').textContent==='이 PC에 보관됨'`);return(await request(`/api/jobs/${job.id}`)).draft;};
  const capture=async name=>{win.webContents.invalidate();await pause(300);fs.writeFileSync(path.join(screenshots,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  await win.loadURL(origin);await wait(`!!document.querySelector('.recent-job')`);await js(`document.querySelector('.recent-job').click()`);
  await wait(`!!document.querySelector('#article-preview h1')&&!document.getElementById('draft-category').disabled`);
  assert.equal(await js(`document.getElementById('draft-category').value`),'0');
  await click('category-refresh');await wait(`document.getElementById('draft-category').disabled`);
  assert.equal(await js(`document.getElementById('generate').disabled`),true);
  await wait(`!document.getElementById('category-refresh').disabled`);
  assert.deepEqual(await js(`[...document.getElementById('draft-category').options].map(option=>option.textContent)`),['카테고리 없음','Java (Language)','Java (Study)']);
  await select('21');assert.deepEqual((await saved()).category,items[4]);
  await win.reload();await wait(`document.getElementById('draft-category').value==='21'`);
  await click('generate');await wait(`document.getElementById('draft-category').disabled`);await wait(`!document.getElementById('generate').disabled`);
  assert.deepEqual((await request(`/api/jobs/${job.id}`)).draft.category,items[4]);
  failRead=true;await click('category-refresh');await wait(`document.getElementById('category-status').textContent.includes('로그인 창이 닫혔습니다')`);
  assert.equal(await js(`document.getElementById('draft-category').value`),'21');
  failRead=false;items=items.map(item=>item.id==='21'?{...item,path:['Study','변경한 이름']}:item);
  await click('category-refresh');await wait(`!document.getElementById('category-refresh').disabled`);
  assert.equal(await js(`document.getElementById('draft-category').value`),'saved');
  assert.equal(await js(`document.getElementById('draft-category').selectedOptions[0].disabled`),true);
  await select('21');assert.deepEqual((await saved()).category,items[4]);
  await js(`document.getElementById('category-section').scrollIntoView({block:'center'});document.getElementById('toast').hidden=true`);await capture('desktop');
  win.setSize(390,900);await pause(150);await js(`if(document.getElementById('sidebar-toggle').getAttribute('aria-expanded')==='true')document.getElementById('sidebar-toggle').click();document.getElementById('category-section').scrollIntoView({block:'center'})`);await capture('mobile');
  assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth`));
  assert.ok(await js(`document.getElementById('github-card').getBoundingClientRect().bottom<document.getElementById('category-section').getBoundingClientRect().top`));
  await select('0');assert.deepEqual((await saved()).category,items[0]);
  await win.reload();await wait(`!!document.querySelector('#article-preview h1')&&!document.getElementById('draft-category').disabled`);assert.equal(await js(`document.getElementById('draft-category').value`),'0');
  const other=await createJob('다른 글');
  await select('11');await saved();
  await js(`localStorage.setItem('hdev.current',${JSON.stringify(other.id)});location.reload()`);await wait(`!!document.querySelector('#article-preview h1')&&!document.getElementById('draft-category').disabled`);
  assert.equal(await js(`document.getElementById('draft-category').value`),'0');
  assert.deepEqual((await request(`/api/jobs/${job.id}`)).draft.category,items[2]);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['read and loading lock','duplicate child names','save and reopen','preserve on regeneration','failed read retains selection','renamed category reselect','explicit no-category and legacy default','independent jobs','mobile layout'],screenshots}));
  win.destroy();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});app.exit(0);
} catch(error) {console.error(error);if(win&&!win.isDestroyed())win.destroy();server.close();app.exit(1);}
}
run().catch(error=>{console.error(error);app.exit(1);});
