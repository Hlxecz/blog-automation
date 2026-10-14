import './runtime.mjs';
import { app, BrowserWindow, Menu, session, dialog } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tistorySessionPartition } from '../desktop/account.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-lifecycle-test-'));
app.setPath('appData', root);
app.setAppPath(fileURLToPath(new URL('../', import.meta.url)));
process.env.HDEV_DATA_DIR = path.join(root, 'workspace');
process.env.TISTORY_CODEX_BIN = path.join(root, 'missing-cli');
// Report startup/navigation failures in logs instead of blocking headless CI
// behind a native error dialog.
dialog.showErrorBox = (title, message) => { console.error(`${title}: ${message}`); app.exit(1); };
const wait = async predicate => {
  for (let i = 0; i < 200; i++) {
    const result = predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('앱 창 준비 시간 초과');
};
async function run() {
let code = 0;
let stage = 'startup';
const watchdog = setTimeout(() => { console.error(`Desktop lifecycle timeout: ${stage}`); app.exit(1); }, 45000);
try {
  console.log('Desktop lifecycle: starting application');
  await import('../desktop/main.mjs');
  const runtimeFile = path.join(root, 'H.Dev Studio Dev/runtime.json');
  await wait(() => fs.existsSync(runtimeFile));
  const runtime = JSON.parse(fs.readFileSync(runtimeFile));
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  stage = 'bootstrap'; console.log(`Desktop lifecycle: ${stage}`);
  assert.ok(win && win.webContents.getURL().startsWith(runtime.origin));
  const before = await (await fetch(runtime.origin + '/api/bootstrap')).json();
  assert.equal(before.platform, process.platform);
  assert.equal(before.canPublish, true);
  assert.equal(before.canUpdate, true);
  assert.equal(before.ai.status, 'missing');
  assert.equal(runtime.dataRoot, process.env.HDEV_DATA_DIR);
  assert.equal(session.fromPartition(tistorySessionPartition).isPersistent(), true);
  stage = 'AI help'; console.log(`Desktop lifecycle: ${stage}`);
  const help = await win.webContents.executeJavaScript(`(() => {
    document.getElementById('help-nav').click();
    return document.querySelector('.ai-help').textContent;
  })()`);
  assert.ok(help.includes(process.platform === 'win32' ? 'npm.cmd install' : 'npm install'));
  if (process.platform === 'darwin') {
    stage = 'Dock reopening'; console.log(`Desktop lifecycle: ${stage}`);
    assert.equal(Menu.getApplicationMenu().items[0].role, 'appmenu');
    // Deliberately slow the reopened page to cover CI's load/shutdown race.
    win.webContents.session.webRequest.onBeforeRequest({ urls: [runtime.origin + '/*'] }, (details, callback) => {
      if (new URL(details.url).pathname === '/') setTimeout(() => callback({}), 300);
      else callback({});
    });
    win.close();
    await wait(() => !BrowserWindow.getAllWindows().length);
    app.emit('activate');
    const reopened = await wait(() => BrowserWindow.getAllWindows().find(w =>
      w.webContents.getURL().startsWith(runtime.origin) && !w.webContents.isLoadingMainFrame()));
    assert.equal(await reopened.webContents.executeJavaScript('document.readyState'), 'complete');
    reopened.webContents.session.webRequest.onBeforeRequest(null);
    assert.notEqual(reopened.id, win.id);
    const after = await (await fetch(runtime.origin + '/api/bootstrap')).json();
    assert.equal(after.token, before.token);
    assert.equal(after.canPublish, true);
  }
  console.log('Desktop lifecycle OK: AI help, storage, adapters, persistent session, Mac Dock reopening');
} catch (error) { console.error(error); code = 1; }
clearTimeout(watchdog);
// Exercise the production shutdown hook too: it closes the local HTTP server.
// Destroy fixture windows first so a native unload dialog cannot hold CI open.
stage = 'shutdown';
app.removeAllListeners('activate');
for (const window of BrowserWindow.getAllWindows()) window.destroy();
if (code) app.exit(code);
else app.quit();

}
run();
