// Exercise the real UI with disposable data and offline article/AI fixtures.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../scripts/server.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-style-ui-'));
app.setPath('userData', path.join(root, 'electron'));
app.on('window-all-closed', () => {});
fs.writeFileSync(path.join(root, 'tistory.config.json'), JSON.stringify({ blogUrl:'https://example.tistory.com',inbox:'inbox',output:'drafts',styleSamples:'samples',styleProfile:'profile.md' }));
fs.writeFileSync(path.join(root, 'profile.md'), '# 나의 글쓰기 지침\n\n- 짧은 문장과 편한 존댓말을 사용해요.\n- 작업의 계기, 시도한 과정, 확인한 결과 순서로 적어요.');
const body = '시도한 과정을 차근차근 설명해요. 에러 메시지를 읽고 설정을 다시 확인했어요. '.repeat(18);
let failNext = false;
let claudeConnected = false;
const server = createApp({root,checkGenerator:async provider=>({provider,connected:provider==='codex'||claudeConnected,status:provider==='codex'||claudeConnected?'connected':'login_required'}),fetchPublic:async()=>{throw new Error('Offline fixture');},
  fetchStyle:async url=>({url,text:`<meta property="og:title" content="오류를 해결한 개발 기록"><div class="contents_style"><p>${body}</p></div>`}),
  styleAnalyzer:async()=> { if(failNext)throw new Error('분석 연결을 확인해 주세요.');return {profile:'# 분석한 글쓰기 지침\n\n- 편한 존댓말로 짧게 설명해요.\n- 확인한 사실과 가정을 구분해요.\n- 참고 글의 경험을 복사하지 않아요.'};}
});
let win;
const screenshots = path.resolve('.runtime/style-qa'); fs.mkdirSync(screenshots,{recursive:true});
async function run() {
try {
  console.log('Starting UI fixture');
  await app.whenReady();
  console.log('Electron ready');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  console.log(`Fixture server: ${origin}`);
  win = new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true}});
  const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
  const js = code => win.webContents.executeJavaScript(code);
  const wait = async condition => {for(let i=0;i<100;i++){if(await js(condition))return;await new Promise(resolve=>setTimeout(resolve,80));}throw new Error(`Timed out: ${condition}`);};
  const click = id => js(`document.getElementById(${JSON.stringify(id)}).click()`);
  const fill = (id,value) => js(`{const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  const capture = async name => { await new Promise(resolve=>setTimeout(resolve,220));fs.writeFileSync(path.join(screenshots,`${name}.png`),(await win.webContents.capturePage()).toPNG()); };
  await win.loadURL(origin);console.log('Page loaded');await wait(`document.getElementById('generation-state').textContent.includes('Codex 연결됨')`);console.log('UI loaded');
  await js(`window.dispatchEvent(new Event('hdev:ai-help'))`);
  await wait(`document.getElementById('ai-connection-status')?.textContent.includes('Codex 연결됨')`);
  await capture('ai-help-codex');
  await js(`document.querySelector('[name="ai-provider"][value="claude"]').click()`);
  await wait(`document.getElementById('ai-connection-status').textContent.includes('로그인이 필요')`);
  assert.match(await js(`document.getElementById('ai-guide').textContent`),/claude auth login/);
  assert.match(await js(`document.getElementById('style-ai-provider').textContent`),/Claude Code/);
  await capture('ai-help-claude');
  claudeConnected = true;await click('ai-recheck');await wait(`document.getElementById('ai-connection-status').textContent.includes('Claude Code 연결됨')`);
  await win.loadURL(origin);await wait(`document.getElementById('generation-state').textContent.includes('Claude Code 연결됨')`);
  await click('help-nav');await wait(`!document.getElementById('ai-recheck').disabled`);
  await js(`document.querySelector('[name="ai-provider"][value="codex"]').click()`);await wait(`document.getElementById('ai-connection-status').textContent.includes('Codex 연결됨')`);await click('close-modal');
  await click('archive-nav');await wait(`!!document.querySelector('.archive-empty')`);await capture('archive-empty');
  await click('archive-new-post');assert.equal(await js(`document.getElementById('modal').open`),false);
  assert.equal(await js(`document.activeElement.id`),'topic');
  await capture('workspace-expanded');
  await click('sidebar-toggle');await wait(`document.getElementById('sidebar-toggle').getAttribute('aria-expanded')==='false'`);
  await capture('workspace-collapsed');
  await win.loadURL(origin);await wait(`document.getElementById('generation-state').textContent.includes('Codex 연결됨')`);
  assert.equal(await js(`document.documentElement.classList.contains('sidebar-collapsed')`),true);
  await click('sidebar-toggle');await click('style-nav');await wait(`!document.getElementById('style-page').hidden`);
  await capture('style-settings');
  const manual='# 직접 수정한 지침\n\n편안한 존댓말을 사용해요. 문장은 짧게 쓰고, 결과는 확인한 범위에서만 적어요.';
  await fill('style-profile',manual);
  await click('style-back');await click('style-nav');
  assert.equal(await js(`document.getElementById('style-profile').value`),manual);
  await click('save-style');await wait(`document.getElementById('style-save-state').textContent==='저장된 말투'`);
  assert.equal(fs.readFileSync(path.join(root,'profile.md'),'utf8'),manual);
  for(let i=1;i<=3;i++)await fill(`style-url-${i}`,`https://blog${i}.tistory.com`);
  await click('analyze-style');await wait(`!document.getElementById('style-result').hidden`);
  assert.equal(await js(`document.getElementById('style-profile').value`),manual);
  assert.equal(await js(`document.querySelectorAll('#style-source-list li').length`),3);
  await capture('style-analysis');
  await click('apply-style-result');assert.match(await js(`document.getElementById('style-profile').value`),/분석한 글쓰기/);
  await click('undo-style-result');assert.equal(await js(`document.getElementById('style-profile').value`),manual);
  await click('apply-style-result');await click('save-style');await wait(`document.getElementById('style-save-state').textContent==='저장된 말투'`);
  assert.match(fs.readFileSync(path.join(root,'profile.md'),'utf8'),/분석한 글쓰기/);
  await win.loadURL(origin);await wait(`document.getElementById('generation-state').textContent.includes('Codex 연결됨')`);await click('style-nav');await wait(`!document.getElementById('style-page').hidden`);
  assert.equal(await js(`document.getElementById('style-url-3').value`),'https://blog3.tistory.com');
  failNext=true;await click('analyze-style');await wait(`document.getElementById('style-analysis-status').classList.contains('error')`);
  assert.match(await js(`document.getElementById('style-profile').value`),/분析|分析|분석한 글쓰기/);
  win.setSize(900,900);await capture('style-900');assert.equal(await js(`document.documentElement.scrollWidth<=window.innerWidth`),true);
  win.setSize(390,844);await click('sidebar-toggle');await capture('style-mobile');assert.equal(await js(`document.documentElement.scrollWidth<=window.innerWidth`),true);
  await click('sidebar-toggle');await capture('sidebar-mobile');
  assert.equal(await js(`document.getElementById('sidebar-scrim').hidden`),false);
  await click('sidebar-scrim');assert.equal(await js(`document.getElementById('sidebar').inert`),true);
  await click('help-nav');await wait(`!!document.getElementById('ai-recheck') && !document.getElementById('ai-recheck').disabled`);
  await capture('ai-help-mobile');assert.equal(await js(`document.getElementById('modal').scrollWidth<=document.getElementById('modal').clientWidth`),true);
  await click('close-modal');await click('archive-nav');await wait(`!!document.querySelector('.archive-empty')`);await capture('archive-mobile');
  await click('archive-new-post');await fill('topic','보관함 UI 검증');await fill('notes','메모는 새 글로 이동해도 보관됩니다.');await click('save-all');
  await wait(`document.getElementById('save-state').textContent==='이 PC에 보관됨'`);await click('archive-nav');await wait(`document.querySelectorAll('.archive-row').length===1`);await capture('archive-populated-mobile');
  assert.match(await js(`document.querySelector('.archive-row').textContent`),/보관함 UI 검증/);
  await click('archive-new-post');assert.equal(await js(`document.getElementById('topic').value`),'');
  assert.deepEqual(errors,[]);
  console.log('PASS: AI help from menu event/sidebar, provider selection/recheck/reload, archive empty/populated/new-post, desktop/mobile layout; sidebar, manual style, three-blog analysis, evidence, apply/undo and failure preservation.');
  console.log(`Screenshots: ${screenshots}`);
  win.destroy();await new Promise(resolve=>server.close(resolve));
  // Electron keeps its profile files open until process exit; leave this temp root
  // for the OS instead of trying to delete a live Chromium profile on Windows.
  app.exit(0);
} catch(error) {console.error(error);win?.destroy();server.closeAllConnections();server.close();app.exit(1);}
}
run().catch(error => {console.error(error);app.exit(1);});
