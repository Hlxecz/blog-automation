import { createHash } from 'node:crypto';
import { load } from 'cheerio';

const ARTICLE_PATH = /^\/(?:\d+|entry\/[^/]+)\/?$/;
const ALLOWED_TAGS = new Set(['a','p','div','span','strong','b','em','i','u','s','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','table','thead','tbody','tfoot','tr','th','td','colgroup','col','hr','br','figure','figcaption','img']);
const DROP_TAGS = new Set(['script','style','noscript','iframe','object','embed','form','input','button','textarea','select','option','svg','math','link','meta']);
const GLOBAL_ATTRS = new Set(['class','title','role','aria-label','aria-hidden','colspan','rowspan','scope','width','height','loading','decoding']);
const SIGNED_QUERY = /^(?:credential|expires|signature|policy|key-pair-id|x-amz-(?:algorithm|credential|date|expires|signedheaders|signature|security-token))$/i;
const CDN_HOSTS = new Set(['blog.kakaocdn.net','t1.daumcdn.net','img1.daumcdn.net']);
const sha = value => createHash('sha256').update(value).digest('hex');
const cleanText = value => String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };

export function normalizePostUrl(input, blogUrl) {
  let url, blog;
  try { url = new URL(input); blog = new URL(blogUrl); } catch { invalid('기존 글 주소를 확인해 주세요.'); }
  if (url.origin !== blog.origin || !ARTICLE_PATH.test(url.pathname) || url.username || url.password || url.port || url.hash) invalid('연결한 블로그의 공개 글만 가져올 수 있습니다.');
  url.search = ''; url.pathname = url.pathname.replace(/\/$/, '');
  return url.href;
}

export function stableRemoteUrl(input, blogUrl) {
  let url;
  try { url = new URL(input, blogUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || (url.origin !== new URL(blogUrl).origin && !CDN_HOSTS.has(url.hostname))) return null;
  for (const key of [...url.searchParams.keys()]) if (SIGNED_QUERY.test(key)) url.searchParams.delete(key);
  const nested=url.searchParams.get('fname');
  if(nested){const stable=stableRemoteUrl(nested,blogUrl);if(stable)url.searchParams.set('fname',stable);}
  url.hash = '';
  return url.href;
}

export function remoteImageIdentity(input, blogUrl) {
  const stable=stableRemoteUrl(input,blogUrl);if(!stable)return null;
  const url=new URL(stable),nested=url.searchParams.get('fname');
  return nested?stableRemoteUrl(nested,blogUrl)||stable:stable;
}

function safeStyle(value) {
  const allowed = /^(?:color|background(?:-color)?|font(?:-(?:family|weight|style|size))?|text-(?:align|decoration)|line-height|letter-spacing|word-break|white-space|vertical-align|overflow(?:-(?:x|y|wrap))?|margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?|border-(?:radius|collapse|spacing)|box-sizing|width|max-width|min-width|height|max-height|min-height|display|float|clear|justify-content|align-items|gap|flex(?:-shrink)?|table-layout|list-style(?:-type)?|scroll-margin-top)$/i;
  return String(value || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const split = part.indexOf(':'); if (split < 1) return null;
    const property = part.slice(0, split).trim(), val = part.slice(split + 1).trim();
    if (!allowed.test(property) || /url\s*\(|expression\s*\(|@import|javascript:|position\s*:|z-index/i.test(`${property}:${val}`)) return null;
    return `${property}:${val}`;
  }).filter(Boolean).join(';');
}

function safeLink(value, base) {
  try {
    const url = new URL(value, base);
    return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function sanitizeImportedHtml(html, blogUrl) {
  const $ = load(String(html || ''), null, false);
  $('*').toArray().forEach(element => {
    const tag = element.name.toLowerCase();
    if (DROP_TAGS.has(tag)) { $(element).replaceWith(`<span data-hdev-blocked="${tag}">[보안상 표시하지 않는 ${tag} 콘텐츠]</span>`); return; }
    if (!ALLOWED_TAGS.has(tag)) { $(element).replaceWith($(element).contents()); return; }
    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'contenteditable' || name.startsWith('data-mce-')) { $(element).removeAttr(attr.name); continue; }
      if (name === 'style') { const style = safeStyle(attr.value); style ? $(element).attr('style', style) : $(element).removeAttr(attr.name); continue; }
      if (tag === 'a' && name === 'href') { const href = safeLink(attr.value, blogUrl); href ? $(element).attr('href', href).attr('rel','noopener noreferrer') : $(element).removeAttr(attr.name); continue; }
      if (tag === 'img' && ['src','data-url','data-origin-width','data-origin-height','alt'].includes(name)) {
        if (['src','data-url'].includes(name)) { const src = safeLink(attr.value, blogUrl); src && stableRemoteUrl(src, blogUrl) ? $(element).attr(name, src) : $(element).removeAttr(attr.name); }
        continue;
      }
      if (tag === 'img' && name === 'srcset') {
        const sources = attr.value.split(',').map(item => item.trim().split(/\s+/,2)).map(([src,size]) => { const safe=safeLink(src,blogUrl); return safe && stableRemoteUrl(safe,blogUrl) ? `${safe}${size?` ${size}`:''}` : null; }).filter(Boolean);
        sources.length ? $(element).attr('srcset',sources.join(', ')) : $(element).removeAttr(name); continue;
      }
      if (['data-url','data-phocus'].includes(name)) { const src=safeLink(attr.value,blogUrl); src&&stableRemoteUrl(src,blogUrl)?$(element).attr(name,src):$(element).removeAttr(name); continue; }
      if (/^data-(?:alt|filename|origin-(?:width|height))$/.test(name)) continue;
      if (GLOBAL_ATTRS.has(name) || name.startsWith('aria-') || name.startsWith('data-ke-')) continue;
      $(element).removeAttr(attr.name);
    }
    if(tag==='img'&&!$(element).attr('src')&&!$(element).attr('data-url'))$(element).replaceWith('<span data-hdev-blocked="image">[허용되지 않은 주소의 원문 사진]</span>');
  });
  $('a[target]').attr('target','_blank').attr('rel','noopener noreferrer');
  return $.html();
}

function stableHtml(html, blogUrl) {
  const $ = load(html, null, false);
  $('*').each((_, el) => {
    for (const attr of ['src','data-url','data-phocus']) { const value=$(el).attr(attr); if (value) $(el).attr(attr,stableRemoteUrl(value,blogUrl) || ''); }
    const srcset=$(el).attr('srcset');
    if (srcset) $(el).attr('srcset',srcset.split(',').map(item=>{const [src,size]=item.trim().split(/\s+/,2);return `${stableRemoteUrl(src,blogUrl)||''}${size?` ${size}`:''}`;}).join(','));
  });
  $('*').each((_,el)=>{ const attrs=[...el.attributes].sort((a,b)=>a.name.localeCompare(b.name)); for(const attr of [...el.attributes]) $(el).removeAttr(attr.name); for(const attr of attrs) $(el).attr(attr.name,attr.value); });
  return $.html().replace(/>\s+</g,'><').trim();
}

function richTemplate(html, key) {
  const $ = load(html, null, false), segments=[], segmentLabels=[];
  const visit = node => {
    if (node.type === 'text' && /\S/.test(node.data || '')) {
      const leading=(node.data.match(/^\s*/)||[''])[0], trailing=(node.data.match(/\s*$/)||[''])[0];
      const text=node.data.slice(leading.length,node.data.length-trailing.length);
      const index=segments.length, token=`\uE000HDEV_${key}_${index}\uE001`;
      const tag=node.parent?.name?.toLowerCase();
      const labels={a:'링크 문구',strong:'강조 문구',b:'강조 문구',em:'강조 문구',i:'강조 문구',th:'표 제목',td:'표 내용',li:'목록 항목',figcaption:'사진 설명',code:'코드',pre:'코드',h2:'소제목',h3:'소제목',h4:'소제목',p:'문단'};
      segments.push(text);segmentLabels.push(labels[tag]||'원문 문장');node.data=`${leading}${token}${trailing}`;
    }
    for (const child of node.children || []) visit(child);
  };
  $.root().contents().each((_,node)=>visit(node));
  return { template:$.html(), segments, segmentLabels };
}

export function renderRichBlock(block) {
  if (!block || block.type !== 'rich' || typeof block.template !== 'string' || typeof block.templateKey !== 'string' || !Array.isArray(block.segments)) throw new Error('원문 형식 블록이 올바르지 않습니다.');
  let html=block.template;
  for (const [index,value] of block.segments.entries()) {
    if (typeof value !== 'string' || value.length > 20000) throw new Error('원문 문장이 너무 깁니다.');
    const token=`\uE000HDEV_${block.templateKey}_${index}\uE001`;
    if (!html.includes(token)) throw new Error('원문 형식 블록의 문장 위치가 올바르지 않습니다.');
    const escaped=String(value).replace(/[&<>]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' })[c]);
    html=html.replace(token,()=>escaped);
  }
  if (/\uE000HDEV_/.test(html)) throw new Error('원문 형식 블록의 문장이 누락되었습니다.');
  return html;
}

function plainElement($, el) {
  return !$(el).find('*').length && !(el.attributes||[]).length;
}

function createBlock($, element, index, templates, blogUrl) {
  if(element.type==='text') {const text=cleanText(element.data);return text?{type:'paragraph',text}:null;}
  const tag=element.name?.toLowerCase(), node=$(element), text=cleanText(node.text());
  if (!text && tag!=='img' && !node.find('img').length && tag !== 'hr') return null;
  if (tag==='h2' && plainElement($,element)) return {type:'heading',text};
  if (['p','div'].includes(tag) && plainElement($,element)) return {type:'paragraph',text};
  if (tag === 'pre' && !(element.attributes||[]).length && (node.children().length===0 || (node.children().length===1 && node.children()[0].name==='code' && !(node.children()[0].attributes||[]).length && !node.children().first().find('*').length))) return {type:'code',text:node.text().replace(/^\n|\n$/g,'')};
  if (tag==='ul' && !node.attr('style') && !node.attr('class') && node.children().toArray().every(child=>child.name==='li' && plainElement($,child))) return {type:'list',items:node.children().toArray().map(child=>cleanText($(child).text()))};
  if (tag === 'table' && !(element.attributes||[]).length && !node.find('a,img,b,strong,em,i,u,s,span,div,p,code,br,[style],[class],[colspan],[rowspan]').length && !node.find('*').toArray().some(child=>(child.attributes||[]).length) && node.children('thead').length===1 && node.children('tbody').length===1) {
    const header=node.children('thead').find('tr').first().children('th').toArray().map(cell=>cleanText($(cell).text()));
    const rows=node.children('tbody').find('tr').toArray().map(row=>$(row).children('td').toArray().map(cell=>cleanText($(cell).text())));
    if (header.length && rows.every(row=>row.length===header.length)) return {type:'table',headers:header,rows};
  }
  const sanitized=sanitizeImportedHtml($.html(element),blogUrl), key=sha(`${index}\0${stableHtml(sanitized,blogUrl)}`).slice(0,20);
  const rich=richTemplate(sanitized,key);
  const images=[];
  const richDom=load(sanitized,null,false);
  richDom('img').each((_,img)=>{const sourceUrl=richDom(img).attr('data-url')||richDom(img).attr('src');const stable=stableRemoteUrl(sourceUrl,blogUrl);if(stable)images.push({sourceKey:sha(stable).slice(0,24),url:sourceUrl,stableUrl:stable,alt:richDom(img).attr('alt')||''});});
  templates[key]={...rich,images};
  return {type:'rich',templateKey:key,template:rich.template,segments:rich.segments,segmentLabels:rich.segmentLabels,images,text};
}

export function parsePublicArticle(html, inputUrl, blogUrl) {
  const url=normalizePostUrl(inputUrl,blogUrl), $=load(String(html||''));
  const body=$('article#article > div.tt_article_useless_p_margin.contents_style').first().length ? $('article#article > div.tt_article_useless_p_margin.contents_style').first()
    : $('article#article .contents_style, article#article, .entry-content, .article-view').first();
  if (!body.length) invalid('공개 글 본문을 찾지 못했습니다. 티스토리 스킨 구조를 확인해 주세요.');
  const sanitizedBody=sanitizeImportedHtml(body.html(),blogUrl), bodyDom=load(sanitizedBody,null,false), templates={}, blocks=[];
  const children=bodyDom.root().contents().toArray();
  for (const [index,element] of children.entries()) { const block=createBlock(bodyDom,element,index,templates,blogUrl); if(block)blocks.push(block); }
  if (!blocks.length) invalid('가져올 공개 글 본문이 비어 있습니다.');
  const title=cleanText($('meta[property="og:title"]').attr('content')||$('article#article h1').first().text()||$('h1').first().text());
  if (!title) invalid('공개 글 제목을 읽지 못했습니다.');
  const article=$('article#article').first();
  let tagRoot=article.siblings('.tags').first();
  if(!tagRoot.length)tagRoot=article.parent().children('.tags').first();
  if(!tagRoot.length)tagRoot=article.closest('main,.area_view,.entry-content').find('.tags').filter((_,el)=>!$(el).closest('aside,nav,header,footer').length).first();
  if(!tagRoot.length)tagRoot=$('.tags').filter((_,el)=>!$(el).closest('aside,nav,header,footer').length).first();
  const tags=tagRoot.find('a[href^="/tag/"],a[href*="/tag/"]').toArray().map(el=>cleanText($(el).text()).replace(/^#/,'')).filter(Boolean);
  const categoryPath=cleanText($('a.category').first().text()).split('/').map(v=>v.trim()).filter(Boolean);
  const publishedAt=$('meta[property="article:published_time"]').attr('content')||$('time[datetime]').first().attr('datetime')||'';
  const postId=/^\/(\d+)$/.exec(new URL(url).pathname)?.[1] || $('meta[property="article:id"]').attr('content') || null;
  const sourceHtml=sanitizeImportedHtml(body.html(),blogUrl);
  const coverUrl=$('meta[property="og:image"]').attr('content')||'';
  const sourceDigest=sha(JSON.stringify({title,publishedAt,categoryPath,tags:[...new Set(tags)].slice(0,10),coverUrl:stableRemoteUrl(coverUrl,blogUrl)||coverUrl,body:stableHtml(sourceHtml,blogUrl)}));
  return {identity:{blogUrl:new URL(blogUrl).origin,url,postId:postId&&/^\d+$/.test(postId)?postId:null},source:{title,publishedAt,categoryPath,tags:[...new Set(tags)].slice(0,10),tagsObserved:tagRoot.length>0,coverUrl,html:sourceHtml,rawHtml:body.html(),digest:sourceDigest,capturedAt:new Date().toISOString(),templates},draft:{title,tags:[...new Set(tags)].slice(0,10),blocks}};
}

export function normalizeImportedDraft(draft, source) {
  if (!source?.templates || !Array.isArray(draft?.blocks)) return draft;
  draft.blocks=draft.blocks.map(block=>{
    if (block?.type!=='rich') return block;
    const stored=source.templates[block.templateKey];
    if (!stored || block.template!==stored.template || !Array.isArray(block.segments) || block.segments.length!==stored.segments.length) throw new Error('원문 형식 블록이 변경되었습니다. 글을 다시 열어 확인해 주세요.');
    return {...block,template:stored.template,segments:block.segments.map(value=>String(value??'').slice(0,20000)),segmentLabels:stored.segmentLabels,images:stored.images};
  });
  return draft;
}

export function mergeImportedDraft(base, local, remote) {
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b), merged=structuredClone(remote), conflicts=[];
  if(!same(local?.title,base?.title)){if(!same(remote.title,base.title)&&remote.title!==local.title)conflicts.push('제목');merged.title=local.title;}
  if(!same(local?.tags,base?.tags)){if(!same(remote.tags,base.tags)&&!same(remote.tags,local.tags))conflicts.push('태그');merged.tags=structuredClone(local.tags);}
  if(local?.category!=null)merged.category=structuredClone(local.category);
  if(local?.cover!=null)merged.cover=local.cover;
  if(local?.githubCard!=null)merged.githubCard=structuredClone(local.githubCard);
  const aligned=Array.isArray(base?.blocks)&&base.blocks.length===local?.blocks?.length&&base.blocks.length===remote?.blocks?.length&&base.blocks.every((block,index)=>block.type===local.blocks[index]?.type&&block.type===remote.blocks[index]?.type);
  if(!aligned)return {draft:merged,conflicts:['본문 구조'],fullyMerged:false};
  merged.blocks=remote.blocks.map((next,index)=>{
    const before=base.blocks[index],edited=local.blocks[index];
    if(next.type==='rich'&&before.type==='rich'&&edited.type==='rich'&&before.segments.length===edited.segments.length&&next.segments.length===edited.segments.length){
      next.segments=next.segments.map((value,segment)=>{if(edited.segments[segment]===before.segments[segment])return value;if(value!==before.segments[segment]&&value!==edited.segments[segment])conflicts.push(`본문 ${index+1}-${segment+1}`);return edited.segments[segment];});return next;
    }
    if(!same(edited,before)){if(!same(next,before)&&!same(next,edited))conflicts.push(`본문 ${index+1}`);return structuredClone(edited);}
    return next;
  });
  return {draft:merged,conflicts,fullyMerged:true};
}

export function isAllowedRemoteImage(url, blogUrl) { return !!stableRemoteUrl(url,blogUrl); }
