// Isolated, disposable data for manually checking the deletion dialog.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../scripts/server.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-delete-ui-'));
fs.writeFileSync(path.join(root, 'tistory.config.json'), JSON.stringify({ blogUrl:'https://example.tistory.com', inbox:'inbox', output:'drafts', styleProfile:'style.md', styleSamples:'style' }));
fs.writeFileSync(path.join(root,'style.md'),'검증용 문체');
const server = createApp({root,checkGenerator:async()=>true,fetchPublic:async()=>{throw new Error('Offline test');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const {token} = await (await fetch(`${origin}/api/bootstrap`)).json();
async function request(route, body) {
  const raw = Buffer.isBuffer(body);
  const response = await fetch(origin+route,{method:route.endsWith('/draft')?'PUT':'POST',headers:{'X-App-Token':token,'Content-Type':raw?'image/png':'application/json'},body:raw?body:JSON.stringify(body)});
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const ids = [];
for (const title of ['남겨둘 개발 기록', '삭제 확인용 초안']) {
  const job = await request('/api/jobs',{title}); ids.push(job.id);
  const uploaded = await request(`/api/jobs/${job.id}/images?name=test.png`,fs.readFileSync(new URL('../test/fixtures/redis-test.png',import.meta.url)));
  const draft = {title,tags:['검증'],blocks:[{type:'paragraph',text:'화면 검증용 자료입니다.'},{type:'image',file:uploaded.images[0].name,alt:'가상 캡처',caption:''}]};
  await request(`/api/jobs/${job.id}/draft`,{draft,review:''});
  await request(`/api/jobs/${job.id}/draft`,{draft,review:'이력 포함'});
}
console.log(JSON.stringify({origin,root,ids}));
