// Test only disposable photos and offline reference/AI responses.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../scripts/server.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(),'hdev-references-ui-'));
app.setPath('userData',path.join(root,'electron'));
app.on('window-all-closed',()=>{});
fs.writeFileSync(path.join(root,'tistory.config.json'),JSON.stringify({blogUrl:'https://example.tistory.com',inbox:'inbox',output:'drafts',styleSamples:'samples',styleProfile:'profile.md'}));
fs.writeFileSync(path.join(root,'profile.md'),'짧은 문장으로 정확하게 써요.');
let received;
const server = createApp({root,checkGenerator:async()=>true,fetchPublic:async()=>{throw new Error('Offline fixture');},
  fetchReference:async url=>{
    if (url.includes('blocked')) throw new Error('403');
    return {url,text:`<article><h1>연결 오류 해결 문서</h1><p>${'환경 설정을 확인한 뒤 다시 연결하는 과정을 설명합니다. '.repeat(8)}</p></article>`};
  }, generator:async input=> {
    received=input.references;
    await new Promise(resolve=>setTimeout(resolve,350));
    const manifest=JSON.parse(fs.readFileSync(path.join(input.directory,'manifest.json')));
    return {draft:{title:'Redis 연결 오류를 해결한 과정',tags:[],blocks:[{type:'paragraph',text:'참고자료와 캡처를 함께 확인한 검증용 초안입니다.'},{type:'image',file:manifest.images[0].name,alt:'검증용 캡처',caption:''}]},analysis:'검증용 분석',review:'자료를 확인해 주세요.',sensitiveImages:[]};
  }
});
let win;
const screenshots=path.resolve('.runtime/reference-qa');fs.mkdirSync(screenshots,{recursive:true});
async function run() {
  try {
    await app.whenReady();
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    win=new BrowserWindow({show:false,width:1440,height:1060,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true}});
    const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
    const js=code=>win.webContents.executeJavaScript(code);
    const wait=async condition=>{for(let i=0;i<600;i++){if(await js(condition))return;await new Promise(resolve=>setTimeout(resolve,80));}throw new Error(`Timed out: ${condition}`);};
    const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click()`);
    const fill=(id,value)=>js(`{const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));}`);
    const capture=async name=>{await new Promise(resolve=>setTimeout(resolve,220));fs.writeFileSync(path.join(screenshots,`${name}.png`),(await win.webContents.capturePage()).toPNG());};
    await win.loadURL(origin);await wait(`document.getElementById('generation-state').textContent.includes('Codex 연결됨')`);
    await capture('empty');
    const add=async url=>{await fill('reference-url',url);await click('reference-add');};
    await add('https://docs.example.com/redis');
    await wait(`document.querySelectorAll('.reference-item').length===1 && document.getElementById('save-state').textContent==='이 PC에 보관됨'`);
    const id=await js(`localStorage.getItem('hdev.current')`);
    await add('https://docs.example.com/redis#again');
    assert.match(await js(`document.getElementById('reference-status').textContent`),/이미 추가/);
    await add('https://workspace.notion.site/dev-notes');
    await js(`document.querySelectorAll('.reference-paste summary')[1].click()`);
    await fill('reference-content-1','  노션에서 가져온 작업 메모입니다. 원인을 확인하고 설정을 수정했습니다.  ');
    await add('https://docs.example.com/blocked');
    await click('save-all');await wait(`document.getElementById('save-state').textContent==='이 PC에 보관됨'`);
    // Attach a fixture image through the real upload API.
    const bootstrap=await (await fetch(origin+'/api/bootstrap')).json();
    await fetch(`${origin}/api/jobs/${id}/images?name=redis.png`,{method:'POST',headers:{'X-App-Token':bootstrap.token},body:fs.readFileSync(new URL('../test/fixtures/redis-test.png',import.meta.url))});
    await win.reload();await wait(`document.querySelectorAll('.reference-item').length===3 && !document.getElementById('generate').disabled`);
    assert.match(await js(`document.getElementById('reference-content-1').value`),/노션에서 가져온/);
    assert.ok(await js(`document.querySelector('.references-section').getBoundingClientRect().top>=document.getElementById('photo-list').getBoundingClientRect().bottom`));
    await capture('references');
    await click('reference-read');await wait(`document.getElementById('reference-read').textContent==='읽는 중…'`);
    await wait(`document.querySelector('.reference-result.unavailable') && !document.getElementById('reference-read').disabled`);
    assert.ok(await js(`document.getElementById('article-preview').hidden`));
    await js(`document.querySelector('.reference-excerpt summary').click()`);
    assert.match(await js(`document.querySelector('.reference-excerpt pre').textContent`),/환경 설정/);
    await capture('checked-before-generation');
    await click('generate');await wait(`document.getElementById('reference-url').disabled`);
    assert.ok(await js(`document.getElementById('reference-content-1').disabled`));
    await wait(`document.querySelector('.reference-result.unavailable') && !document.getElementById('generate').disabled`);
    assert.deepEqual(received.map(item=>item.status),['read','provided','unavailable']);
    assert.match(await js(`document.getElementById('reference-list').textContent`),/공개 본문 확인/);
    assert.match(await js(`document.getElementById('reference-list').textContent`),/직접 붙여 넣은 내용 사용/);
    assert.match(await js(`document.getElementById('review-notes').value`),/참고자료 확인 기록/);
    await capture('read-results');
    await js(`document.querySelectorAll('.reference-paste')[1].open=false`);
    await js(`document.querySelectorAll('.reference-remove')[2].click()`);
    await add('https://docs.example.com/three');await add('https://docs.example.com/four');await add('https://docs.example.com/five');
    assert.ok(await js(`document.getElementById('reference-add').disabled`));
    assert.equal(await js(`document.getElementById('reference-count').textContent`),'5 / 5');
    await click('save-all');await wait(`document.getElementById('save-state').textContent==='이 PC에 보관됨'`);
    win.setSize(390,900);await click('sidebar-toggle');await js(`document.querySelector('.references-section').scrollIntoView()`);
    await capture('mobile');assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth`));
    if(process.argv[2]) {
      win.setSize(1440,1060);await click('new-post');await wait(`document.querySelectorAll('.reference-item').length===0`);
      await add(process.argv[2]);await click('reference-read');
      await wait(`!document.getElementById('reference-read').disabled && document.getElementById('reference-list').textContent.includes('공개 노션 본문 확인')`);
      const liveId=await js(`localStorage.getItem('hdev.current')`);
      const checked=await (await fetch(`${origin}/api/jobs/${liveId}`)).json();
      assert.equal(checked.referenceReports[0].status,'read');assert.ok(checked.referenceReports[0].characters>10000);
      await js(`document.querySelector('.reference-excerpt summary').click();document.querySelector('.references-section').scrollIntoView()`);
      await capture('live-notion-read');
      await fetch(`${origin}/api/jobs/${liveId}/images?name=fixture.png`,{method:'POST',headers:{'X-App-Token':bootstrap.token},body:fs.readFileSync(new URL('../test/fixtures/redis-test.png',import.meta.url))});
      await win.reload();await wait(`!document.getElementById('generate').disabled`);await click('generate');
      await wait(`!document.getElementById('generate').disabled && !document.getElementById('article-preview').hidden`);
      assert.equal(received[0].status,'read');assert.ok(received[0].text.length>10000);assert.equal(received[0].truncated,false);
      console.log(JSON.stringify({liveNotion:{title:received[0].title,characters:received[0].text.length,blocks:received[0].blockCount,passedToGenerator:true,containsFinalSection:received[0].text.includes('27. 처음 설치한 사람이')}}));
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks:['empty and saved links','duplicates and five-link limit','pasted Notion content','reloaded references','read results and generation lock','remove references','mobile layout'],screenshots}));
    win.destroy();await new Promise(resolve=>server.close(resolve));app.exit(0);
  } catch(error) {console.error(error);if(win&&!win.isDestroyed())win.destroy();server.close();app.exit(1);}
}
run();
