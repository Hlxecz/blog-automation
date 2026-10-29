import './runtime.mjs';
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
  let origin=`http://127.0.0.1:${server.address().port}`;
  console.log(`Fixture server: ${origin}`);
  win = new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true}});
  const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
  const js = code => win.webContents.executeJavaScript(code);
  const wait = async condition => {for(let i=0;i<100;i++){if(await js(condition))return;await new Promise(resolve=>setTimeout(resolve,80));}throw new Error(`Timed out: ${condition}`);};
  const click = id => js(`document.getElementById(${JSON.stringify(id)}).click()`);
  const fill = (id,value) => js(`{const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  const capture = async name => { await new Promise(resolve=>setTimeout(resolve,220));fs.writeFileSync(path.join(screenshots,`${name}.png`),(await win.webContents.capturePage()).toPNG()); };
  await win.loadURL(origin);console.log('Page loaded');await wait(`document.getElementById('generation-state').textContent.includes('Codex 연결됨')`);console.log('UI loaded');
  const layouts = new Map();
  win.webContents.debugger.attach('1.3');
  for(const [platform,name] of [['MacIntel','mac'],['Win32','windows']]) {
    await win.webContents.debugger.sendCommand('Emulation.setUserAgentOverride',{userAgent:`Mozilla/5.0 ${name} Electron/44.3.0`,platform});
    await win.loadURL(origin);await wait(`document.getElementById('generation-state').textContent.includes('Codex 연결됨')`);
    assert.equal(await js(`document.fonts.ready.then(()=>document.fonts.check('13px "blog Studio Sans"'))`),true,'공통 글꼴을 오프라인으로 불러와야 합니다.');
    for(const theme of ['dark','light']) {
      await click(`theme-${theme}`);await capture(`platform-${name}-${theme}`);
      const layout=await js(`['.window-drag-region','.sidebar','.workspace-heading','.workflow-steps','.source-panel','.draft-panel','.theme-switch'].map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),s=getComputedStyle(el);return [r.x,r.y,r.width,r.height,s.fontFamily,s.color,s.background]})`);
      if(name==='mac')layouts.set(theme,layout);else assert.deepEqual(layout,layouts.get(theme),`${theme} 작업실의 Mac·Windows 배치와 색상은 같아야 합니다.`);
    }
  }
  await win.webContents.debugger.sendCommand('Emulation.setUserAgentOverride',{userAgent:`Mozilla/5.0 Mac Electron/44.3.0`,platform:'MacIntel'});
  win.webContents.debugger.detach();await click('theme-dark');
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
  const palette = () => js(`['main','.workspace-heading','.source-panel','.draft-panel','.drop-zone','.new-post'].map(selector=>{const style=getComputedStyle(document.querySelector(selector));return [style.background,style.color,style.borderColor]})`);
  const fixedDark = await palette();
  await click('theme-light');
  assert.equal(await js(`document.documentElement.dataset.theme`),'light');
  assert.equal(await js(`document.getElementById('theme-light').getAttribute('aria-pressed')`),'true');
  assert.equal(await js(`getComputedStyle(document.documentElement).colorScheme`),'light');
  assert.equal(await js(`getComputedStyle(document.querySelector('.source-panel')).backgroundColor`),'rgb(255, 255, 255)');
  await js(`document.getElementById('notes').value='테마 전환 중인 메모'`);
  await click('theme-dark');
  assert.equal(await js(`document.getElementById('notes').value`),'테마 전환 중인 메모');
  await wait(`getComputedStyle(document.querySelector('.drop-zone')).background === ${JSON.stringify(fixedDark[4][0])}`);
  assert.deepEqual(await palette(),fixedDark,'다크 테마의 확정된 색상은 그대로 유지합니다.');
  await js(`document.getElementById('notes').value=''`);
  await click('theme-light');await capture('workspace-light');
  await click('help-nav');await wait(`!!document.getElementById('ai-recheck')`);await capture('ai-help-light');await click('close-modal');
  await click('style-nav');await capture('style-light');await click('style-back');
  await win.loadURL(origin);await wait(`document.getElementById('generation-state').textContent.includes('Codex 연결됨')`);
  assert.equal(await js(`document.documentElement.dataset.theme`),'light','재실행 시 선택한 테마를 복원합니다.');
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  await win.loadURL(origin);await wait(`document.getElementById('generation-state').textContent.includes('Codex 연결됨')`);
  assert.equal(await js(`document.documentElement.dataset.theme`),'light','시작할 때 서버 포트가 달라져도 선택한 테마를 복원합니다.');
  await click('theme-dark');
  await wait(`getComputedStyle(document.querySelector('.drop-zone')).background === ${JSON.stringify(fixedDark[4][0])}`);
  assert.deepEqual(await palette(),fixedDark);
  win.setSize(1261,735);await capture('workspace-compact-dark');
  const themeSize = await js(`(()=>{const r=document.querySelector('.theme-switch').getBoundingClientRect();return {width:r.width,height:r.height,buttonHeight:document.getElementById('theme-light').getBoundingClientRect().height}})()`);
  assert.equal(themeSize.width,await js(`document.getElementById('new-post').getBoundingClientRect().width`),'테마 선택은 위 메뉴와 같은 너비를 사용합니다.');
  assert.ok(themeSize.height<=36 && themeSize.buttonHeight>=24,'테마 선택은 낮게 표시하되 클릭 영역은 유지합니다.');
  for(const width of [1261,1210,1100,900]) {
    win.setSize(width,735);
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.equal(await js(`(()=>{const banner=document.querySelector('.workspace-heading').getBoundingClientRect();const step=document.getElementById('step-three');const range=document.createRange();range.selectNodeContents(step);const text=range.getBoundingClientRect();return step.scrollWidth<=step.clientWidth+1 && text.right<=banner.right-16 && text.bottom<=banner.bottom-16})()`),true,`${width}px에서 검토 글자가 잘리지 않아야 합니다.`);
  }
  win.setSize(1261,735);
  assert.equal(await js(`document.querySelector('.theme-switch').getBoundingClientRect().bottom <= document.querySelector('.sidebar-bottom').getBoundingClientRect().top`),true);
  assert.equal(await js(`document.querySelector('.sidebar-bottom').getBoundingClientRect().bottom <= window.innerHeight`),true,'기본 창 크기에서 테마 버튼과 프로필이 잘리지 않아야 합니다.');
  await click('theme-light');await capture('workspace-compact-light');await click('theme-dark');
  win.setSize(1440,1000);
  const contrast = await js(`(() => {
    const luminance = color => color.match(/[\\d.]+/g).slice(0,3).map(Number).map(n => n/255).map(n => n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
    const style=getComputedStyle(document.getElementById('new-post'));
    const values=[luminance(style.color),luminance(style.backgroundColor)].sort((a,b)=>b-a);
    return (values[0]+.05)/(values[1]+.05);
  })()`);
  assert.ok(contrast >= 4.5,'주요 버튼의 텍스트 대비가 충분해야 합니다.');
  assert.equal(await js(`document.querySelector('.brand').getAttribute('aria-label')`),'blog Studio 홈');
  assert.equal(await js(`getComputedStyle(document.querySelector('.duck-eyes')).animationName`),'duck-blink');
  assert.equal(await js(`getComputedStyle(document.querySelector('.ambient-sparkles')).pointerEvents`),'none');
  assert.equal(await js(`getComputedStyle(document.querySelector('.ambient-sparkles i')).animationName`),'ember-float');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await js(`getComputedStyle(document.querySelector('.duck-eyes')).animationName`),'none');
  assert.equal(await js(`getComputedStyle(document.querySelector('.duck-head')).animationName`),'none');
  assert.equal(await js(`getComputedStyle(document.querySelector('.ambient-sparkles i')).animationName`),'none');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});
  win.webContents.debugger.detach();
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
  assert.equal(await js(`document.querySelector('.brand>span:last-child').getBoundingClientRect().right <= document.getElementById('sidebar-toggle').getBoundingClientRect().left`),true,'작은 창에서 로고와 메뉴 버튼이 겹치면 안 됩니다.');
  win.setSize(390,844);await click('sidebar-toggle');await capture('style-mobile');assert.equal(await js(`document.documentElement.scrollWidth<=window.innerWidth`),true);
  assert.equal(await js(`document.querySelector('.style-heading').getBoundingClientRect().top > document.getElementById('sidebar-toggle').getBoundingClientRect().bottom`),true,'모바일 설정 제목과 메뉴 버튼이 겹치면 안 됩니다.');
  await click('sidebar-toggle');await capture('sidebar-mobile');
  await click('theme-light');await capture('style-mobile-light');
  assert.equal(await js(`document.documentElement.scrollWidth<=window.innerWidth`),true);
  await click('sidebar-toggle');await capture('sidebar-mobile-light');
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
