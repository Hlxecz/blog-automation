// Exercise draft editing with disposable local data; never call AI or publish a post.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../scripts/server.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'hdev-editor-ui-'));
app.setPath('userData',path.join(root,'electron'));
app.on('window-all-closed',()=>{});
fs.writeFileSync(path.join(root,'tistory.config.json'),JSON.stringify({blogUrl:'https://example.tistory.com',inbox:'inbox',output:'drafts',styleSamples:'samples',styleProfile:'profile.md'}));
fs.writeFileSync(path.join(root,'profile.md'),'확인한 사실을 바탕으로 작성합니다.');
let releaseGeneration;
const gate=new Promise(resolve=>{releaseGeneration=resolve;});
const server=createApp({root,checkGenerator:async()=>true,fetchPublic:async()=>{throw new Error('Offline fixture');},generator:async()=>{await gate;throw new Error('검증용 생성 실패');}});
const screenshots=path.resolve('.runtime/editor-qa');fs.mkdirSync(screenshots,{recursive:true});
let win;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run() {
  try {
    await app.whenReady();
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    const bootstrap=await (await fetch(origin+'/api/bootstrap')).json();
    const request=async(url,method='GET',json)=>{
      const response=await fetch(origin+url,{method,headers:{'X-App-Token':bootstrap.token,'Content-Type':'application/json'},body:json===undefined?undefined:JSON.stringify(json)});
      const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;
    };
    const job=await request('/api/jobs','POST',{title:'편집 기능 검증'});
    let uploaded;
    for (const name of ['before.png','after.png']) {
      const response=await fetch(`${origin}/api/jobs/${job.id}/images?name=${name}`,{method:'POST',headers:{'X-App-Token':bootstrap.token},body:fs.readFileSync(new URL('../test/fixtures/redis-test.png',import.meta.url))});
      assert.ok(response.ok);uploaded=await response.json();
    }
    const original={title:'연결 오류를 고친 과정',tags:['개발','검증'],blocks:[
      {type:'paragraph',text:'오류가 생긴 상황을 먼저 기록했습니다.'},
      {type:'heading',text:'설정을 다시 확인한 과정'},
      {type:'image',file:uploaded.images[0].name,alt:'오류를 확인한 캡처',caption:'수정 전 연결 상태'},
      {type:'code',text:'console.log("연결 완료");'}
    ]};
    await request(`/api/jobs/${job.id}/draft`,'PUT',{draft:original,review:'편집 검증용 자료'});
    win=new BrowserWindow({show:false,width:1440,height:1060,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true}});
    const errors=[];
    win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
    const js=code=>win.webContents.executeJavaScript(code);
    const wait=async condition=>{for(let i=0;i<180;i++){if(await js(condition))return;await pause(60);}throw new Error(`Timed out: ${condition}`);};
    const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const field=(selector,value)=>js(`{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));}`);
    const types=()=>js(`[...document.querySelectorAll('.edit-block')].map(el=>el.dataset.type)`);
    const capture=async name=>{await pause(150);fs.writeFileSync(path.join(screenshots,`${name}.png`),(await win.webContents.capturePage()).toPNG());};
    const save=async()=>{await click('#save-all');await wait(`document.getElementById('save-state').textContent==='이 PC에 보관됨'`);return (await request(`/api/jobs/${job.id}`)).draft;};
    await win.loadURL(origin);await wait(`!!document.querySelector('.recent-job')`);await click('.recent-job');
    await wait(`!!document.querySelector('#article-preview h1')`);await click('#edit-view');
    assert.deepEqual(await types(),original.blocks.map(b=>b.type));
    assert.equal(await js(`document.querySelectorAll('.block-insert').length`),5);

    // Start an actual mouse drag on the handle, then deliver its captured drag data.
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.setInterceptDrags',{enabled:true});
    let dragData;
    win.webContents.debugger.on('message',(_event,method,params)=>{if(method==='Input.dragIntercepted')dragData=params.data;});
    const drag=async(from,gap)=>{
      dragData=null;
      await js(`document.getElementById('block-editor').scrollIntoView({block:'start'})`);
      const point=await js(`(()=>{const r=document.querySelectorAll('.block-drag-handle')[${from}].getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+15,y:point.y+10,button:'left',buttons:1});
      for(let i=0;i<60&&!dragData;i++)await pause(40);
      assert.ok(dragData,'Native mouse drag did not start');
      assert.ok(dragData.items.some(item=>item.mimeType==='text/hdev-block'));
      const target=await js(`(()=>{const el=document.querySelector('.block-insert[data-position="${gap}"]');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      for(const type of ['dragEnter','dragOver'])await win.webContents.debugger.sendCommand('Input.dispatchDragEvent',{type,...target,data:dragData});
      assert.equal(await js(`document.querySelector('.drop-target')?.dataset.position`),String(gap));
      await capture('drag-position');
      await win.webContents.debugger.sendCommand('Input.dispatchDragEvent',{type:'drop',...target,data:dragData});
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',buttons:0,clickCount:1});
      await pause(80);
    };
    await drag(1,0);
    assert.deepEqual(await types(),['heading','paragraph','image','code']);
    await drag(0,4);
    assert.deepEqual(await types(),['paragraph','image','code','heading']);
    assert.deepEqual((await save()).blocks,[original.blocks[0],original.blocks[2],original.blocks[3],original.blocks[1]]);
    await drag(1,2); // Its own following gap is a no-op.
    assert.equal(await js(`document.getElementById('save-state').textContent`),'이 PC에 보관됨');

    // Insert at the start, middle, and end; retain edited text while moving it.
    const insert=async(position,type)=>{
      await click(`.block-insert[data-position="${position}"] .block-insert-toggle`);
      await click(`.block-insert[data-position="${position}"] [data-block-type="${type}"]`);
    };
    await insert(0,'paragraph');
    await field('.edit-block[data-type="paragraph"] textarea','중간 편집 내용도 순서 변경 후 유지됩니다.');
    await insert(2,'list');
    await insert(3,'table');
    await insert(4,'image');
    await click('.photo-picker button:nth-child(2)');
    assert.equal(await js(`document.getElementById('modal').open`),false);
    await insert(8,'code');
    assert.deepEqual(await types(),['paragraph','paragraph','list','table','image','image','code','heading','code']);
    await js(`document.getElementById('block-type').value='heading'`);await click('#add-block');
    assert.equal((await types()).at(-1),'heading');
    await js(`[...document.querySelectorAll('.edit-block')].at(-1).querySelector('.block-remove').click()`);
    await click('.block-insert[data-position="3"] .block-insert-toggle');
    await js(`document.querySelector('.block-insert[data-position="3"] button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.equal(await js(`document.querySelector('.block-insert[data-position="3"] .block-insert-options').hidden`),true);
    await click('.block-insert[data-position="3"] .block-insert-toggle');
    await js(`document.querySelector('.block-insert[data-position="3"]').scrollIntoView({block:'center'})`);
    await capture('insert-menu');
    await click('#draft-title');
    await js(`document.querySelector('.block-drag-handle').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
    const saved=await save();
    assert.equal(saved.blocks[1].text,'중간 편집 내용도 순서 변경 후 유지됩니다.');
    assert.deepEqual(saved.blocks[3],{type:'table',headers:['항목','내용'],rows:[['새 항목','내용을 입력하세요.']]});
    assert.equal(saved.blocks[4].file,uploaded.images[1].name);
    assert.deepEqual(saved.blocks[5],original.blocks[2]);
    await click('#preview-view');
    assert.equal(await js(`document.querySelectorAll('#article-preview table').length`),1);
    assert.equal(await js(`document.querySelectorAll('#article-preview figure').length`),2);
    await win.reload();await wait(`!!document.querySelector('#article-preview h1')`);await click('#edit-view');
    assert.deepEqual((await request(`/api/jobs/${job.id}`)).draft,saved);
    assert.equal(await js(`document.querySelectorAll('.edit-block')[1].querySelector('textarea').value`),saved.blocks[1].text);

    // Explicit covers still lead the preview while raw block order is retained.
    await click('#choose-cover');await click('.cover-picker button:nth-child(1)');
    await wait(`document.getElementById('cover-badge').textContent==='직접 선택'`);
    await click('#preview-view');
    assert.equal(await js(`document.querySelector('#article-preview .hdev-toc').nextElementSibling.tagName`),'FIGURE');
    assert.equal(await js(`document.querySelectorAll('#article-preview figure').length`),2);
    assert.deepEqual((await request(`/api/jobs/${job.id}`)).draft.blocks,saved.blocks);
    await click('#edit-view');

    // Work in progress locks both insertion and dragging and retains the draft on failure.
    await click('#generate');await wait(`document.querySelector('.block-drag-handle').disabled`);
    assert.equal(await js(`document.querySelector('.block-drag-handle').draggable`),false);
    assert.equal(await js(`document.querySelector('.block-insert-toggle').disabled`),true);
    const beforeLock=await types();
    await js(`document.querySelector('.block-drag-handle').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
    assert.deepEqual(await types(),beforeLock);
    releaseGeneration();await wait(`!document.getElementById('generate').disabled`);
    assert.deepEqual((await request(`/api/jobs/${job.id}`)).draft.blocks,saved.blocks);
    win.setSize(390,900);await pause(150);
    await js(`if(document.getElementById('sidebar-toggle').getAttribute('aria-expanded')==='true')document.getElementById('sidebar-toggle').click();document.getElementById('block-editor').scrollIntoView({block:'start'});`);
    await click('.block-insert[data-position="1"] .block-insert-toggle');
    await js(`document.querySelector('.block-insert[data-position="1"]').scrollIntoView({block:'center'});document.getElementById('toast').hidden=true;`);
    await capture('mobile-editor');
    assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth`));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks:['native mouse drag up and down','drop position and no-op','all insertion types and positions','text and image metadata preservation','save and reopen','preview and explicit cover','keyboard move and menu dismissal','generation lock and recovery','mobile layout'],screenshots}));
    win.destroy();await new Promise(resolve=>server.close(resolve));app.exit(0);
  } catch(error) {console.error(error);releaseGeneration();if(win&&!win.isDestroyed())win.destroy();server.close();app.exit(1);}
}
run();
