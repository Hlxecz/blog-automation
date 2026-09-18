// First-run setup uses temporary data and no Tistory network or publication.
import {app,BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createApp} from '../scripts/server.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hdev-blog-setup-'));
app.setPath('userData',path.join(root,'electron'));app.on('window-all-closed',()=>{});
const config={blogUrl:'https://your-blog.tistory.com',inbox:'inbox',output:'drafts',styleSamples:'samples',styleProfile:'profile.md',tocMode:'skin'};
fs.writeFileSync(path.join(root,'tistory.config.json'),JSON.stringify(config));fs.writeFileSync(path.join(root,'profile.md'),'기존 말투');
let reads=0,win;
const server=createApp({root,checkGenerator:async()=>true,fetchPublic:async()=>{throw Error('Offline fixture');},categoryReader:async({blogUrl})=>{reads++;return [{blogUrl,id:'0',path:['카테고리 없음']},{blogUrl,id:'11',path:['Language','Java']}];}});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
  try{
    await app.whenReady();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    win=new BrowserWindow({show:false,width:1280,height:950,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true}});
    const js=code=>win.webContents.executeJavaScript(code);
    const wait=async condition=>{for(let i=0;i<150;i++){if(await js(condition))return;await pause(50);}throw Error('Timed out: '+condition);};
    const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click()`);
    await win.loadURL(origin);await wait(`!!document.getElementById('publish-blog-address')`);
    assert.equal(await js(`document.getElementById('modal').open`),true);
    assert.equal(await js(`document.getElementById('publish-blog-address').value`),'');
    assert.equal(await js(`document.getElementById('blog-link').hasAttribute('href')`),false);
    await click('close-modal');await click('category-refresh');await wait(`document.getElementById('modal').open`);assert.equal(reads,0);
    const set=value=>js(`{const input=document.getElementById('publish-blog-address');input.value=${JSON.stringify(value)};input.form.requestSubmit();}`);
    await set('https://your-blog.tistory.com');await wait(`document.getElementById('blog-settings-status').textContent.includes('본인')`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'tistory.config.json'))).blogUrl,config.blogUrl);
    await set('https://example.tistory.com/');await wait(`!document.getElementById('modal').open`);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'tistory.config.json'))),{...config,blogUrl:'https://example.tistory.com'});
    assert.equal(await js(`document.getElementById('blog-link').href`),'https://example.tistory.com/');
    await click('category-refresh');await wait(`document.getElementById('draft-category').options.length===2`);assert.equal(reads,1);
    await win.reload();await wait(`document.getElementById('blog-link').href==='https://example.tistory.com/'`);
    assert.equal(await js(`document.getElementById('modal').open`),false);
    await click('blog-settings-nav');assert.equal(await js(`document.getElementById('publish-blog-address').value`),'https://example.tistory.com');
    const evidence=path.resolve('.runtime/blog-setup-qa');fs.mkdirSync(evidence,{recursive:true});
    win.webContents.invalidate();await pause(200);fs.writeFileSync(path.join(evidence,'desktop.png'),(await win.webContents.capturePage()).toPNG());
    win.setSize(390,900);await pause(200);assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth`));fs.writeFileSync(path.join(evidence,'mobile.png'),(await win.webContents.capturePage()).toPNG());
    assert.equal(fs.readFileSync(path.join(root,'profile.md'),'utf8'),'기존 말투');
    console.log('PASS: first-run setup, no example links/reads, invalid address rejected, save without restart, category read, reopen and settings preserved.');
    win.destroy();await new Promise(resolve=>server.close(resolve));app.exit(0);
  }catch(error){console.error(error);win?.destroy();server.close();app.exit(1);}
}
run().catch(error=>{console.error(error);app.exit(1);});
