import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../scripts/server.mjs';
import { initializeData } from './data.mjs';
import { randomUUID } from 'node:crypto';

app.setName('H.Dev Studio');
// Keep development windows and sessions independent from the installed EXE.
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'H.Dev Studio Dev'));
app.setAppUserModelId('com.hdev.studio');
let mainWindow, server, origin, dataRoot;
const remoteWindows = new Set();

function tistoryUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
    (u.hostname === 'tistory.com' || u.hostname.endsWith('.tistory.com') || ['accounts.kakao.com', 'kauth.kakao.com'].includes(u.hostname)); }
  catch { return false; }
}

function protectNavigation(win, local = false) {
  const openReference = url => {
    try {
      const target = new URL(url);
      if (local && target.protocol === 'https:' && !target.username && !target.password) shell.openExternal(target.href).catch(() => {});
    } catch { /* Ignore malformed external links. */ }
  };
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  win.webContents.on('will-navigate', (e, url) => {
    if (local && new URL(url).origin !== origin) { e.preventDefault(); if (tistoryUrl(url)) openTistory(url); else openReference(url); }
    else if (!local && !tistoryUrl(url)) e.preventDefault();
  });
  win.webContents.on('will-redirect', (e, url) => { if (!local && !tistoryUrl(url)) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (tistoryUrl(url)) openTistory(url);
    else openReference(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['계속 편집', '저장하지 않고 닫기'], defaultId: 0, cancelId: 0,
      message: '저장하지 않은 변경사항이 있습니다.', detail: '계속 편집을 선택한 뒤 내용을 보관해 주세요.' });
    if (response === 1) event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_web, permission, callback) => callback(local && permission === 'clipboard-sanitized-write'));
  win.webContents.session.setPermissionCheckHandler((_web, permission) => local && permission === 'clipboard-sanitized-write');
}

function openTistory(url) {
  if (!tistoryUrl(url)) return;
  // Separate in-memory browser session. No app preload or Node access is exposed to Tistory.
  const win = new BrowserWindow({ width: 1220, height: 900, minWidth: 800, minHeight: 620, title: '티스토리 · H.Dev Studio',
    icon: path.join(app.getAppPath(), 'desktop/assets/icon.png'),
    webPreferences: { partition: 'tistory-session', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  remoteWindows.add(win); win.on('closed', () => remoteWindows.delete(win));
  win.webContents.on('page-title-updated', event => { event.preventDefault(); win.setTitle(`${win.webContents.getTitle()} · 티스토리`); });
  protectNavigation(win);
  win.setMenu(Menu.buildFromTemplate([
    { label: '티스토리', submenu: [
      { label: '뒤로', accelerator: 'Alt+Left', click: () => { if (win.webContents.navigationHistory.canGoBack()) win.webContents.navigationHistory.goBack(); } },
      { label: '새로고침', role: 'reload' }, { type: 'separator' },
      { label: '브라우저에서 이어서 열기', click: () => { const target = win.webContents.getURL(); if (tistoryUrl(target) && new URL(target).hostname.endsWith('tistory.com')) shell.openExternal(target); } },
      { role: 'close', label: '창 닫기' }
    ] }, { label: '편집', submenu: [{ role: 'undo', label: '실행 취소' }, { role: 'redo', label: '다시 실행' }, { type: 'separator' }, { role: 'cut', label: '잘라내기' }, { role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '전체 선택' }] }
  ]));
  win.loadURL(url).catch(() => dialog.showMessageBox(win, { type: 'error', message: '티스토리를 열지 못했습니다.', detail: '인터넷 연결을 확인하거나 메뉴에서 브라우저로 열어 주세요.' }));
  return win;
}

async function openDataFolder() {
  try {
    // Apps launched from an MSIX host can have a virtualized AppData path.
    // Explorer needs the physical path, which GetFinalPathNameByHandle resolves.
    const actualPath = fs.realpathSync.native(dataRoot);
    const failure = await shell.openPath(actualPath);
    if (failure) throw new Error(failure);
  } catch (error) {
    dialog.showMessageBox(mainWindow, { type: 'error', message: '자료 폴더를 열지 못했습니다.', detail: `${error.message}\n\n저장 위치: ${dataRoot}` });
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    const bundle = app.getAppPath();
    dataRoot = initializeData(process.env.HDEV_DATA_DIR ? path.resolve(process.env.HDEV_DATA_DIR) : path.join(app.getPath('userData'), 'workspace'), bundle);
    // Load the separately packaged editor connector for each attempt so a connector
    // fix can be installed while this process keeps the user's login session.
    const publishAdapter = async request => {
      const { createTistoryPublisher } = await import(`./publish.mjs?attempt=${randomUUID()}`);
      return createTistoryPublisher({ openWindow: openTistory,
      onDryRun: !app.isPackaged && process.env.HDEV_PUBLISH_DRY_RUN === '1' ? async result => {
        fs.writeFileSync(path.join(dataRoot, 'publish-dry-run.json'), JSON.stringify({ title: result.draft.title,
          url: result.url, imageCount: Object.keys(result.uploaded).length, verifiedAt: new Date().toISOString(), submitted: false }, null, 2));
      } : null })(request);
    };
    server = createApp({ root: dataRoot, webRoot: path.join(bundle, 'web'), publishAdapter });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    mainWindow = new BrowserWindow({ width: 1440, height: 980, minWidth: 880, minHeight: 680, show: false,
      backgroundColor: '#ffffff', title: app.isPackaged ? 'H.Dev Studio' : 'H.Dev Studio · 개발 모드', icon: path.join(bundle, 'desktop/assets/icon.png'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    protectNavigation(mainWindow, true);
    mainWindow.on('close', event => {
      if (server.hasActiveGeneration()) {
        event.preventDefault(); dialog.showMessageBox(mainWindow, { type: 'info', message: '글 작성, 말투 분석 또는 발행이 진행 중입니다.', detail: '작업이 끝나면 앱을 닫을 수 있어요. 티스토리 로그인 화면이 열렸다면 먼저 로그인을 완료해 주세요.' });
      }
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '작업실', submenu: [
        { label: '자료 폴더 열기', click: openDataFolder },
        { label: '티스토리 로그인 / 글 관리', click: () => openTistory(`${JSON.parse(fs.readFileSync(path.join(dataRoot, 'tistory.config.json'), 'utf8')).blogUrl}/manage`) },
        { type: 'separator' }, { role: 'close', label: '창 닫기' }
      ] },
      { label: '편집', submenu: [{ role: 'undo', label: '실행 취소' }, { role: 'redo', label: '다시 실행' }, { type: 'separator' }, { role: 'cut', label: '잘라내기' }, { role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '전체 선택' }] },
      { label: '보기', submenu: [{ role: 'reload', label: '새로고침' }, { role: 'resetZoom', label: '기본 크기' }, { role: 'zoomIn', label: '확대' }, { role: 'zoomOut', label: '축소' }] },
      { label: '도움말', submenu: [{ label: 'AI 선택 / 연결 방법', click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.executeJavaScript("window.dispatchEvent(new Event('hdev:ai-help'))").catch(() => {});
      } }] }
    ]));
    mainWindow.once('ready-to-show', () => mainWindow.show());
    if (!app.isPackaged) mainWindow.webContents.on('page-title-updated', event => { event.preventDefault(); mainWindow.setTitle('H.Dev Studio · 개발 모드'); });
    await mainWindow.loadURL(origin);
    fs.writeFileSync(path.join(app.getPath('userData'), 'runtime.json'), JSON.stringify({ pid: process.pid, origin, dataRoot, version: app.getVersion() }));
  }).catch(error => { dialog.showErrorBox('H.Dev Studio 시작 실패', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { server?.closeAllConnections(); server?.close(); });
}
