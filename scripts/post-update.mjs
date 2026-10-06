import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizePostUrl, normalizeImportedDraft } from './existing-posts.mjs';
import { readPublicArticle } from './tistory.mjs';
import { draftDigest } from './publication.mjs';
import { buildPreview } from './blog.mjs';
import { manifestImage, normalizeCategory } from '../web/draft-model.js';
import { load } from 'cheerio';
import { stableRemoteUrl, remoteImageIdentity } from './existing-posts.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>{fs.writeFileSync(`${file}.tmp`,JSON.stringify(value,null,2));fs.renameSync(`${file}.tmp`,file);};
const reject=message=>{throw Object.assign(new Error(message),{status:409});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const updateBusy=phase=>['checking_remote','waiting_login','uploading','filling','submitting','verifying'].includes(phase);
const compact=value=>String(value||'').replace(/\s+/g,'');
const sameTime=(left,right)=>{if(!left&&!right)return true;const a=new Date(left).getTime(),b=new Date(right).getTime();return Number.isFinite(a)&&Number.isFinite(b)?a===b:left===right;};
const sameCategory=(actual,expected,id)=>id==='0'?(actual.length===0||(actual.length===1&&actual[0]==='카테고리 없음')):JSON.stringify(actual)===JSON.stringify(expected);
function verifyUpdatedArticle(article,draft,result,target) {
  if(article.source.title.trim()!==draft.title.trim())return false;
  if(JSON.stringify([...article.source.tags].sort())!==JSON.stringify([...draft.tags].sort()))return false;
  if(draft.category?!sameCategory(article.source.categoryPath,draft.category.path,draft.category.id):JSON.stringify(article.source.categoryPath)!==JSON.stringify(target.source.categoryPath))return false;
  if(article.source.publishedAt? !sameTime(article.source.publishedAt,target.source.publishedAt) : target.source.publishedAt&&result.evidence?.publishedAt!==true)return false;
  const $=load(article.source.html,null,false), publicText=compact($.root().text()), pieces=draft.blocks.flatMap(block=>block.type==='list'?block.items:block.type==='table'?[...block.headers,...block.rows.flat()]:block.type==='rich'?block.segments:[block.text]).filter(value=>typeof value==='string'&&value.trim());
  if(pieces.some(piece=>!publicText.includes(compact(piece))))return false;
  const publicImages=new Set($('img').toArray().map(img=>stableRemoteUrl($(img).attr('data-url')||$(img).attr('src'),article.identity.blogUrl)).filter(Boolean));
  for(const block of draft.blocks.filter(block=>block.type==='rich'))for(const image of block.images||[])if(!publicImages.has(image.stableUrl))return false;
  for(const url of Object.values(result.uploaded||{}))if(![...publicImages].some(value=>new URL(value).pathname===new URL(url).pathname))return false;
  if(draft.cover&&result.uploaded?.[draft.cover]&&!decodeURIComponent(String(article.source.coverUrl)).includes(new URL(result.uploaded[draft.cover]).pathname))return false;
  if(!draft.cover&&remoteImageIdentity(article.source.coverUrl,article.identity.blogUrl)!==remoteImageIdentity(target.source.coverUrl,target.identity.blogUrl))return false;
  if(draft.githubCard){const card=draft.githubCard;if(![card.categoryLabel,card.topic,card.sourceLabel,card.linkText,card.description].every(value=>!value||publicText.includes(compact(value))))return false;if(!$('a').toArray().some(link=>$(link).attr('href')===card.url))return false;}
  return true;
}

export function createPostUpdates({adapter,blogUrl,fetchPublic=fetch,tocMode='article'}) {
  const running=new Set();
  function state(job) {
    const file=path.join(job,'post-update.json');
    if(!fs.existsSync(file)) return {phase:'idle'};
    const value=read(file);
    if(!running.has(job)&&updateBusy(value.phase)) return {...value,phase:value.submittedAt?'uncertain':'failed',message:value.submittedAt?'수정 저장 후 결과를 확인하지 못했습니다. 원문을 확인하기 전에는 다시 반영할 수 없습니다.':'수정 저장 전에 앱이 종료됐습니다. 로컬 수정본은 그대로 보관했습니다.'};
    return value;
  }
  function start({job,directory,expectedDigest,onFinish}) {
    const targetFile=path.join(job,'existing-post.json');
    if(!fs.existsSync(targetFile)) reject('기존 글 수정 작업이 아닙니다.');
    const previous=state(job);
    if(running.has(job)) return previous;
    if(previous.phase==='uncertain') reject('이전 수정 결과가 불확실합니다. 원문을 확인한 뒤 다시 불러와 주세요.');
    if(!adapter) reject('기존 글 수정 반영은 최신 Windows 앱에서 사용할 수 있습니다.');
    const target=read(targetFile), origin=new URL(blogUrl).origin;
    if(target.identity?.blogUrl!==origin || normalizePostUrl(target.identity?.url,origin)!==target.identity.url) reject('현재 연결한 블로그와 기존 글 대상이 다릅니다.');
    const bytes=fs.readFileSync(path.join(directory,'draft.json')), digest=hash(bytes);
    if(expectedDigest!==digest) reject('초안이 변경됐습니다. 다시 열어 내용을 확인한 뒤 반영해 주세요.');
    if(previous.phase==='updated'&&previous.draftDigest===digest) return previous;
    const draft=normalizeImportedDraft(JSON.parse(bytes),target.source);
    const manifest=read(path.join(directory,'manifest.json'));
    if(draft.category!=null)normalizeCategory(draft.category,origin);
    if(!Array.isArray(draft.tags)||draft.tags.length>10||draft.tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>50)||new Set(draft.tags.map(tag=>tag.trim())).size!==draft.tags.length)reject('태그는 중복 없이 10개 이하, 태그당 50자 이하로 정리해 주세요.');
    const {usedImages}=buildPreview(draft,manifest);
    for(const name of usedImages)if(hash(fs.readFileSync(path.join(directory,'images',name)))!==manifestImage(manifest,name)?.sha256)reject('보관한 사진이 변경됐습니다. 초안을 다시 확인해 주세요.');
    const attemptId=randomUUID(), snapshot=path.join(directory,'updates',attemptId);
    fs.mkdirSync(path.join(snapshot,'images'),{recursive:true});
    fs.writeFileSync(path.join(snapshot,'draft.json'),bytes);
    write(path.join(snapshot,'manifest.json'),manifest);write(path.join(snapshot,'existing-post.json'),target);
    for(const name of usedImages)fs.copyFileSync(path.join(directory,'images',name),path.join(snapshot,'images',name));
    const file=path.join(job,'post-update.json');
    let record={phase:'checking_remote',message:'원문이 다른 곳에서 바뀌지 않았는지 확인하고 있어요.',attemptId,blogUrl:origin,targetUrl:target.identity.url,title:draft.title,draftDigest:digest,snapshot,requestedAt:new Date().toISOString()};
    const progress=(phase,message)=>{if(!updateBusy(phase))throw new Error('잘못된 수정 단계입니다.');record={...record,phase,message};write(file,record);};
    write(file,record);running.add(job);
    Promise.resolve().then(async()=>{
      const current=await readPublicArticle(target.identity.url,origin,fetchPublic);
      if(current.source.digest!==target.remoteDigest) {
        record={...record,phase:'stale',message:'티스토리 원문이 불러온 뒤 변경됐습니다. 로컬 수정본은 보관했습니다. 원문을 확인한 뒤 다시 불러와 주세요.',remoteCheckedAt:new Date().toISOString()};write(file,record);return null;
      }
      if(!current.source.publishedAt)current.source.publishedAt=target.source.publishedAt;
      const checkRemote=async()=>{const latest=await readPublicArticle(target.identity.url,origin,fetchPublic);if(latest.source.digest!==target.remoteDigest)reject('티스토리 원문이 수정 준비 중 변경됐습니다. 로컬 수정본은 그대로 보관했습니다.');if(!latest.source.publishedAt)latest.source.publishedAt=target.source.publishedAt;return latest.source;};
      return adapter({blogUrl:origin,draft,manifest,directory:snapshot,target:target.identity,currentSource:current.source,expectedPublishedAt:target.source.publishedAt,checkRemote,onProgress:progress,includeToc:tocMode!=='skin',beforeSubmit:()=>{record={...record,submittedAt:new Date().toISOString()};progress('submitting','원래 글에 수정 내용을 저장하고 있어요.');}});
    }).then(async result=>{
      if(!result)return;
      if(normalizePostUrl(result.url,origin)!==target.identity.url||result.postId&&target.identity.postId&&result.postId!==target.identity.postId||result.title!==draft.title||!result.verifiedAt||!result.evidence?.public||!result.evidence?.body||!result.evidence?.samePost||!result.evidence?.images) throw new Error('원래 글 주소에서 수정 결과를 확인하지 못했습니다.');
      const verified=await readPublicArticle(target.identity.url,origin,fetchPublic);
      if(!verifyUpdatedArticle(verified,draft,result,target))throw new Error('원래 글 주소에서 수정된 제목·본문·사진·태그·발행 정보를 확인하지 못했습니다.');
      record={...record,phase:'updated',message:'기존 글에 수정 내용을 반영했어요.',url:target.identity.url,verifiedAt:result.verifiedAt,evidence:result.evidence};
      write(file,record);write(path.join(snapshot,'updated-receipt.json'),record);
      write(targetFile,{...target,remoteDigest:verified.source.digest,lastAppliedDigest:digest,lastAppliedAt:record.verifiedAt,lastVerifiedSource:verified.source});
    }).catch(error=>{
      record={...record,phase:record.submittedAt?'uncertain':'failed',message:record.submittedAt?'수정 저장 후 결과를 확인하지 못했습니다. 원문을 확인하기 전에는 다시 반영할 수 없습니다.':error.message};write(file,record);
    }).finally(()=>{running.delete(job);onFinish?.();});
    return record;
  }
  return {state,start,isRunning:job=>running.has(job)};
}
