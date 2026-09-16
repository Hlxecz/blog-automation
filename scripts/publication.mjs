import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { buildPreview } from './blog.mjs';
import { manifestImage } from '../web/draft-model.js';
import { articleStyles, normalizeGitHubCard } from '../web/article-renderer.js';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (file, data) => { fs.writeFileSync(`${file}.tmp`, JSON.stringify(data,null,2)); fs.renameSync(`${file}.tmp`,file); };
const reject = message => { throw Object.assign(new Error(message),{status:409}); };
export const publicationBusy = phase => ['preparing','waiting_login','uploading','filling','submitting','verifying'].includes(phase);
export const draftDigest = directory => hash(fs.readFileSync(path.join(directory,'draft.json')));

export function createPublications({ adapter, blogUrl, tocMode = 'article' }) {
  const running = new Set();
  function state(job) {
    const file = path.join(job,'publication.json');
    if (!fs.existsSync(file)) return {phase:'idle'};
    const value = read(file);
    if (!running.has(job) && publicationBusy(value.phase)) return { ...value,
      phase:value.submittedAt ? 'uncertain' : 'failed',
      message:value.submittedAt ? '앱이 종료되어 발행 결과를 확인하지 못했습니다. 중복 발행을 막기 위해 글 관리에서 먼저 확인해 주세요.' : '발행 전에 앱이 종료됐습니다. 다시 시도할 수 있습니다.' };
    return value;
  }
  function start({job,directory,expectedDigest,onFinish}) {
    const previous = state(job);
    if (previous.phase === 'published' || running.has(job)) return previous;
    if (previous.phase === 'uncertain') reject('발행 결과가 불확실합니다. 중복 발행을 막기 위해 티스토리 글 관리에서 먼저 확인해 주세요.');
    if (!adapter) reject('바로 발행은 최신 Windows EXE 앱에서 사용할 수 있습니다.');
    if (running.size) reject('다른 글을 발행하고 있습니다. 완료 후 시도해 주세요.');
    const bytes=fs.readFileSync(path.join(directory,'draft.json')), digest=hash(bytes);
    if (expectedDigest !== digest) reject('초안이 변경됐습니다. 다시 열어 내용을 확인한 뒤 발행해 주세요.');
    const draft=JSON.parse(bytes), manifest=read(path.join(directory,'manifest.json'));
    const {usedImages}=buildPreview(draft,manifest);
    if (draft.tags.length > 10 || draft.tags.some(t=>!t.trim() || t.length>50)) reject('태그는 빈 값 없이 10개 이하, 태그당 50자 이하로 정리해 주세요.');
    if (new Set(draft.tags.map(t=>t.trim())).size !== draft.tags.length) reject('중복된 태그를 정리한 뒤 다시 눌러 주세요.');
    for (const name of usedImages) {
      if (hash(fs.readFileSync(path.join(directory,'images',name))) !== manifestImage(manifest,name).sha256) reject('보관한 사진이 변경됐습니다. 초안을 다시 확인해 주세요.');
    }
    const attemptId=randomUUID(), snapshot=path.join(directory,'publication',attemptId);
    fs.mkdirSync(path.join(snapshot,'images'),{recursive:true});
    fs.writeFileSync(path.join(snapshot,'draft.json'),bytes);
    save(path.join(snapshot,'manifest.json'),manifest);
    for (const name of usedImages) fs.copyFileSync(path.join(directory,'images',name),path.join(snapshot,'images',name));
    const file=path.join(job,'publication.json');
    let record={phase:'preparing',message:'검토한 초안을 티스토리로 보내고 있어요.',attemptId,blogUrl,title:draft.title,
      draftDigest:digest,inputDigest:manifest.inputDigest,snapshot,requestedAt:new Date().toISOString()};
    const progress=(phase,message)=>{
      if (!publicationBusy(phase)) throw new Error('잘못된 발행 단계입니다.');
      record={...record,phase,message}; save(file,record);
    };
    save(file,record); running.add(job);
    Promise.resolve().then(()=>adapter({blogUrl,draft,manifest,directory:snapshot,onProgress:progress,includeToc:tocMode !== 'skin',
      beforeSubmit:()=>{ record={...record,submittedAt:new Date().toISOString()}; progress('submitting','티스토리에 공개 발행을 요청하고 있어요.'); }
    })).then(result=>{
      const url=new URL(result.url);
      if (url.origin !== new URL(blogUrl).origin || !/^\/(\d+|entry\/[^/]+)\/?$/.test(url.pathname) ||
          result.title!==draft.title || !result.verifiedAt || !result.evidence?.public || !result.evidence?.body || !result.evidence?.images || (draft.cover && result.evidence?.cover !== true))
        throw new Error('발행된 글의 제목·본문·사진을 확인하지 못했습니다.');
      record={...record,phase:'published',message:'티스토리에 발행했어요.',url:url.href,verifiedAt:result.verifiedAt,evidence:result.evidence};
      save(file,record); save(path.join(snapshot,'published-receipt.json'),record);
    }).catch(error=>{
      record={...record,phase:record.submittedAt?'uncertain':'failed',message:record.submittedAt?
        '발행 요청 후 결과를 확인하지 못했습니다. 글 관리에서 확인해 주세요. 같은 글을 자동으로 다시 올리지 않습니다.':error.message};
      save(file,record);
    }).finally(()=>{running.delete(job);onFinish?.();});
    return record;
  }
  return {state,start,isRunning:job=>running.has(job)};
}

export function publicationHtml(draft,manifest,uploaded, { includeToc = true } = {}) {
  const {body,usedImages}=buildPreview(draft,manifest,{includeToc});
  const $=load(body,null,false);
  for (const name of usedImages) {
    const markup=uploaded[name]; if (!markup) throw new Error('업로드하지 않은 사진이 있습니다.');
    const imageDom=load(markup,null,false), remote=imageDom('img').first().attr('src');
    if (!remote?.startsWith('https://')) throw new Error('티스토리 사진 업로드가 완료되지 않았습니다.');
    const target=$('figure').filter((_,el)=>$(el).find('img').attr('src')===`images/${encodeURIComponent(name)}`);
    for (const el of target.toArray()) {
      const imageCopy=load(markup,null,false);
      imageCopy('img').attr('alt',$(el).find('img').attr('alt'));
      imageCopy('img').attr('style',articleStyles.image);
      imageCopy('figure').attr('style',articleStyles.figure);
      const caption=$(el).find('figcaption').text(); imageCopy('figcaption').remove();
      if (caption) {const fig=imageCopy('figure').first(); if(fig.length) fig.append(imageCopy('<figcaption></figcaption>').attr('style',articleStyles.caption).text(caption));}
      $(el).replaceWith(imageCopy.html());
    }
  }
  return $.html();
}

const normalize=s=>String(s||'').replace(/\s+/g,'');
export function verifyPublishedHtml(html,draft,uploaded) {
  const $=load(html); $('script,style,noscript,.hdev-toc,[data-hdev-toc],#toc').remove();
  const title=$('meta[property="og:title"]').attr('content') || $('h1').first().text();
  if (title.trim()!==draft.title.trim()) return false;
  if (draft.cover) {
    const markup = uploaded[draft.cover];
    if (!markup) return false;
    const source = load(markup,null,false)('img').first().attr('src');
    let representative = $('meta[property="og:image"]').attr('content') || '';
    // Tistory may wrap the photo URL in a resized-thumbnail URL's fname query.
    for (let i=0;i<2;i++) { try { representative=decodeURIComponent(representative); } catch { break; } }
    if (!source || !representative.includes(new URL(source).pathname)) return false;
  }
  const text=normalize($('body').text());
  const pieces=draft.blocks.flatMap(b=>b.type==='image'?[]:b.type==='list'?b.items:b.type==='table'?[...b.headers,...b.rows.flat()]:[b.text]);
  if (pieces.some(p=>!text.includes(normalize(p)))) return false;
  if (draft.githubCard) {
    const card=normalizeGitHubCard(draft.githubCard);
    if ([card.categoryLabel,card.topic,card.sourceLabel,card.linkText,card.description].some(part=>!text.includes(normalize(part)))) return false;
    const link=$('a').toArray().some(el=>{
      try {return new URL($(el).attr('href')).href===card.url && normalize($(el).text())===normalize(card.linkText);}
      catch {return false;}
    });
    if (!link) return false;
  }
  const sources=$('img').toArray().map(el=>$(el).attr('src')||'').join('\n');
  let decoded=sources; try {decoded=decodeURIComponent(sources);} catch {}
  for (const markup of Object.values(uploaded)) {
    const src=load(markup,null,false)('img').first().attr('src');
    if (!decoded.includes(new URL(src).pathname)) return false;
  }
  return true;
}
