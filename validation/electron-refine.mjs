// Real editor UI with a fake text-only CLI result; never contacts Tistory.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../scripts/server.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-refine-ui-'));
app.setPath('userData', path.join(root, 'electron')); app.on('window-all-closed', () => {});
fs.writeFileSync(path.join(root, 'tistory.config.json'), JSON.stringify({ blogUrl: 'https://example.tistory.com', inbox: 'inbox', output: 'drafts', styleSamples: 'style', styleProfile: 'profile.md' }));
const profile = fs.readFileSync('config/style.example.md', 'utf8'); fs.writeFileSync(path.join(root, 'profile.md'), profile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const calls = [], errors = []; let win, server, failNext = false;
async function run() {
try {
  await app.whenReady();
  server = createApp({ root, checkGenerator: async () => true, refiner: async input => {
    calls.push(input); await pause(400); if (failNext) throw new Error('연결 확인용 오류');
    return { blocks: input.indices.map(index => ({ index, type: input.draft.blocks[index].type, text: input.draft.blocks[index].text + ' 자연스럽게 다듬었습니다.' })) };
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, nodeIntegration: false, contextIsolation: true } });
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  const js = code => win.webContents.executeJavaScript(code);
  const wait = async condition => { for (let i = 0; i < 200; i++) { if (await js(condition)) return; await pause(50); } throw Error('Timed out: ' + condition + '\n' + await js(`document.getElementById('toast').textContent`)); };
  const click = id => js(`document.getElementById(${JSON.stringify(id)}).click()`);
  const edit = (index, text) => js(`{const el=document.querySelectorAll('#block-editor textarea')[${index}];el.value=${JSON.stringify(text)};el.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await win.loadURL(origin); await wait(`!document.getElementById('manual-start').disabled`);
  console.log('refine: manual start');
  await click('manual-start'); await wait(`!!document.querySelector('#block-editor textarea')`);
  assert.equal(await js(`document.getElementById('photo-count').textContent`), '사진 0장');
  await edit(0, '복사해서 붙여넣은 첫 문장입니다.');
  await js(`document.querySelector('.block-refine').click();document.querySelector('.block-refine').click()`);
  await wait(`document.getElementById('refine-status').textContent.includes('다듬을 준비')`);
  assert.equal(await js(`document.querySelector('#block-editor textarea').disabled`), true);
  await wait(`document.querySelector('#block-editor textarea').value.includes('자연스럽게') && !document.querySelector('#block-editor textarea').disabled`);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].indices, [0]); assert.equal(calls[0].style, profile);
  assert.equal(calls[0].draft.blocks[0].text, '복사해서 붙여넣은 첫 문장입니다.');
  console.log('refine: single block complete');
  await win.reload(); await wait(`!!document.getElementById('edit-view') && document.getElementById('empty-draft').hidden`);
  await click('edit-view'); await wait(`!document.getElementById('refine-undo').hidden`); await click('refine-undo');
  await wait(`document.querySelector('#block-editor textarea').value==='복사해서 붙여넣은 첫 문장입니다.' && !document.querySelector('#block-editor textarea').disabled`);
  await click('add-block'); await edit(1, '직접 작성한 두 번째 문장입니다.');
  await js(`document.getElementById('block-type').value='code'`); await click('add-block'); await edit(2, 'const answer = 42;');
  await js(`{const input=document.getElementById('refine-instruction');input.value='초보자가 이해하게 설명해줘';}`);
  await click('refine-select-all'); assert.equal(await js(`document.getElementById('refine-count').textContent`), '2개 선택');
  await click('refine-selected'); await wait(`document.querySelectorAll('#block-editor textarea')[1].value.includes('자연스럽게') && !document.querySelector('#block-editor textarea').disabled`);
  assert.deepEqual(calls[1].indices, [0, 1]); assert.equal(calls[1].instruction, '초보자가 이해하게 설명해줘');
  assert.equal(await js(`document.querySelectorAll('#block-editor textarea')[2].value`), 'const answer = 42;');
  console.log('refine: all blocks complete');
  // Select one, reorder it, and make sure the selected content moves with the block.
  await js(`document.querySelectorAll('.block-refine-select')[1].click();document.querySelectorAll('.block-up')[1].click()`);
  await click('refine-selected'); await wait(`!document.querySelector('#block-editor textarea').disabled && document.getElementById('refine-status').textContent.includes('보관했어요')`);
  assert.deepEqual(calls[2].indices, [0]); assert.ok(calls[2].draft.blocks[0].text.startsWith('직접 작성한 두 번째'));
  console.log('refine: reordered selection complete');
  const before = await js(`document.querySelector('#block-editor textarea').value`);
  failNext = true; await js(`document.querySelector('.block-refine').click()`);
  await wait(`document.getElementById('refine-status').textContent==='연결 확인용 오류'`);
  assert.equal(await js(`document.querySelector('#block-editor textarea').value`), before);
  assert.equal(await js(`document.querySelector('#block-editor textarea').disabled`), false);
  failNext = false; await js(`document.querySelector('.block-refine').click()`);
  await wait(`document.querySelector('#block-editor textarea').value!==${JSON.stringify(before)} && !document.querySelector('#block-editor textarea').disabled`);
  await edit(0, '다듬은 뒤 직접 수정한 문장'); assert.equal(await js(`document.getElementById('refine-undo').disabled`), true);
  await click('save-all'); await wait(`document.getElementById('save-state').textContent==='이 PC에 보관됨'`);
  assert.equal(await js(`document.getElementById('refine-undo').hidden`), true);
  await click('refine-select-all'); await js(`document.querySelector('.refine-toolbar').scrollIntoView({block:'start'})`); await pause(200);
  const evidence = path.resolve('.runtime/refine-qa'); fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'desktop.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(390, 900); await pause(200);
  await js(`{if(!document.documentElement.classList.contains('sidebar-collapsed'))document.getElementById('sidebar-toggle').click();document.querySelector('.refine-toolbar').scrollIntoView({block:'start'});}`);
  await pause(200); assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth`));
  fs.writeFileSync(path.join(evidence, 'mobile.png'), (await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, []); assert.equal(fs.readFileSync(path.join(root, 'profile.md'), 'utf8'), profile);
  console.log('PASS: text-only manual draft, pasted/typed text, single block, select all, code preservation, selection after reorder, duplicate prevention, saved undo after reload, failure/retry, custom edit protection and mobile layout.');
  win.destroy(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); app.exit(0);
} catch (error) {
  console.error(error); if (win && !win.isDestroyed()) win.destroy(); server?.closeAllConnections(); server?.close(); app.exit(1);
}
}
run().catch(error => { console.error(error); app.exit(1); });
