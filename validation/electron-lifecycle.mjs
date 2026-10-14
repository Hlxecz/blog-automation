import { app, BrowserWindow, Menu, session } from 'electron';
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
try {
  await import('../desktop/main.mjs');
  const runtimeFile = path.join(root, 'H.Dev Studio Dev/runtime.json');
  await wait(() => fs.existsSync(runtimeFile));
  const runtime = JSON.parse(fs.readFileSync(runtimeFile));
  const win = BrowserWindow.getAllWindows()[0];
  assert.ok(win && win.webContents.getURL().startsWith(runtime.origin));
  const before = await (await fetch(runtime.origin + '/api/bootstrap')).json();
  assert.equal(before.platform, process.platform);
  assert.equal(before.canPublish, true);
  assert.equal(before.canUpdate, true);
  assert.equal(before.ai.status, 'missing');
  assert.equal(runtime.dataRoot, process.env.HDEV_DATA_DIR);
  assert.equal(session.fromPartition(tistorySessionPartition).isPersistent(), true);
  const help = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('help-nav').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    return document.querySelector('.ai-help').textContent;
  })()`);
  assert.ok(help.includes(process.platform === 'win32' ? 'npm.cmd install' : 'npm install'));
  if (process.platform === 'darwin') {
    assert.equal(Menu.getApplicationMenu().items[0].role, 'appmenu');
    win.close();
    await wait(() => !BrowserWindow.getAllWindows().length);
    app.emit('activate');
    const reopened = await wait(() => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(runtime.origin)));
    assert.notEqual(reopened.id, win.id);
    const after = await (await fetch(runtime.origin + '/api/bootstrap')).json();
    assert.equal(after.token, before.token);
    assert.equal(after.canPublish, true);
  }
  console.log('Desktop lifecycle OK: AI help, storage, adapters, persistent session, Mac Dock reopening');
} catch (error) { console.error(error); code = 1; }
// Chromium may still hold its temporary profile until exit. Never remove a live profile.
app.exit(code);

}
run();
