// One design for the app, exported preview, and Tistory HTML. Only app-owned
// styles are emitted; article text is always escaped, never treated as HTML.
export const articleStyles = {
  article: 'color:#243b53;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-size:16px;line-height:1.9;word-break:keep-all;overflow-wrap:anywhere;text-align:left;',
  title: 'margin:0 0 24px;color:#1c3146;font-size:30px;line-height:1.5;font-weight:750;letter-spacing:-0.6px;word-break:keep-all;overflow-wrap:anywhere;',
  heading: 'box-sizing:border-box;margin:40px 0 20px;border:0;border-left:3px solid #168198;padding:7px 0 7px 16px;background:transparent;color:#243b53;font-size:22px;line-height:1.5;font-weight:700;text-align:left;word-break:keep-all;overflow-wrap:anywhere;scroll-margin-top:100px;',
  toc: 'box-sizing:border-box;max-width:100%;margin:0 0 32px;padding:22px 24px;border:1px solid #dbe3ec;border-radius:12px;background:#ffffff;color:#243b53;text-align:left;',
  'toc-title': 'margin:0 0 12px;padding:0 0 12px;border:0;border-bottom:1px solid #dbe3ec;color:#243b53;font-size:15px;line-height:1.6;font-weight:700;',
  'toc-list': 'margin:0;padding:0;list-style:none;',
  'toc-item': 'margin:0;padding:0;list-style:none;',
  'toc-link': 'display:flex;justify-content:space-between;gap:16px;padding:7px 0;color:#52718e;font-size:14px;line-height:1.7;text-decoration:none;word-break:keep-all;overflow-wrap:anywhere;',
  'github-card': 'box-sizing:border-box;max-width:100%;background-color:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:12px 15px;margin:0 0 20px;font-size:0.9em;line-height:1.7;display:flex;align-items:center;font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;text-align:left;word-break:keep-all;overflow-wrap:anywhere;',
  'github-icon': 'margin-right:10px;font-size:1.2em;line-height:1.4;flex-shrink:0;',
  'github-content': 'min-width:0;flex:1;',
  'github-label': 'color:#57606a;font-weight:700;',
  'github-topic': 'color:#0969da;font-weight:700;margin-left:5px;',
  'github-link': 'color:#0969da;text-decoration:none;font-weight:700;margin-left:5px;word-break:keep-all;overflow-wrap:anywhere;',
  'github-description': 'color:#57606a;font-size:0.85em;margin-top:2px;line-height:1.7;',
  paragraph: 'margin:16px 0;padding:0;color:#243b53;font-size:16px;line-height:1.9;text-align:left;word-break:keep-all;overflow-wrap:anywhere;',
  callout: 'box-sizing:border-box;max-width:100%;margin:24px 0;padding:20px 22px;border:0;border-left:4px solid;border-radius:0;text-align:left;word-break:keep-all;overflow-wrap:anywhere;',
  tip: 'border-left-color:#247af6;background:#f1f6ff;color:#243b53;',
  warning: 'border-left-color:#b7791f;background:#fff8ed;color:#59401f;',
  summary: 'border-left-color:#168198;background:#eff8f8;color:#243b53;',
  'callout-title': 'display:block;margin:0;padding:0;color:inherit;font-size:16px;line-height:1.7;font-weight:700;word-break:keep-all;overflow-wrap:anywhere;',
  'callout-body': 'margin:10px 0 0;padding:0;color:inherit;font-size:16px;line-height:1.85;word-break:keep-all;overflow-wrap:anywhere;',
  list: 'margin:18px 0;padding:0 0 0 25px;color:#243b53;font-size:16px;line-height:1.9;list-style-type:disc;',
  item: 'margin:7px 0;padding:0 0 0 3px;word-break:keep-all;overflow-wrap:anywhere;',
  pre: 'box-sizing:border-box;max-width:100%;margin:24px 0;padding:18px 20px;border:1px solid #dbe3ec;border-radius:4px;background:#f4f6f8;color:#243b53;white-space:pre-wrap;overflow-x:auto;word-break:keep-all;overflow-wrap:anywhere;font:14px/1.8 Consolas,monospace;text-align:left;',
  code: 'margin:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;white-space:inherit;',
  'table-wrap': 'max-width:100%;margin:24px 0;overflow-x:auto;',
  table: 'width:100%;margin:0;border-collapse:collapse;border-spacing:0;table-layout:auto;color:#243b53;font-size:14px;line-height:1.75;',
  'table-wide': 'min-width:520px;',
  th: 'border:1px solid #dbe3ec;border-top:2px solid #168198;padding:12px 14px;background:#edf3f7;color:#243b53;font-weight:700;text-align:left;vertical-align:top;word-break:keep-all;overflow-wrap:anywhere;',
  td: 'border:1px solid #dbe3ec;padding:12px 14px;background:transparent;text-align:left;vertical-align:top;word-break:keep-all;overflow-wrap:anywhere;',
  'row-even': 'background:#ffffff;',
  'row-odd': 'background:#f7f9fc;',
  figure: 'max-width:100%;margin:28px 0;text-align:center;',
  image: 'display:block;max-width:100%;height:auto;margin:0 auto;border:0;border-radius:4px;',
  caption: 'margin:10px 0 0;padding:0;color:#607286;font-size:13px;line-height:1.7;text-align:center;word-break:keep-all;overflow-wrap:anywhere;'
};

// The app keeps its strict CSP: it loads this CSS as a same-origin stylesheet.
// Exported/published HTML carries the identical declarations inline, so it does
// not depend on a user's Tistory skin loading our stylesheet.
export const articleCss = Object.entries(articleStyles).map(([name, style]) =>
  `${name === 'article' ? '.hdev-article' : `.hdev-article .hdev-${name}`}{${style}}`).join('\n') +
  '\n.hdev-article .hdev-toc-link:hover{color:#168198;text-decoration:underline}.hdev-article .hdev-toc-link:focus-visible{outline:2px solid #168198;outline-offset:3px;}';

export const escapeArticleText = value => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const lines = text => escapeArticleText(text).replace(/\r\n?|\n/g, '<br>');
const required = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}에는 문자열이 필요합니다.`);
  return value;
};

export function articleAttributes(names, inlineStyles = true) {
  const keys = names.split(' ');
  return `class="${keys.map(name => `hdev-${name}`).join(' ')}"` +
    (inlineStyles ? ` style="${escapeArticleText(keys.map(name => articleStyles[name]).join(''))}"` : '');
}

export function normalizeGitHubCard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub 카드 내용을 확인해 주세요.');
  const limits={icon:20,categoryLabel:60,topic:200,sourceLabel:60,url:2048,linkText:200,description:1000};
  const labels={icon:'아이콘',categoryLabel:'주제 분류',topic:'주제',sourceLabel:'링크 분류',url:'링크 주소',linkText:'링크 이름',description:'설명'};
  const card={};
  for (const [key,max] of Object.entries(limits)) {
    if (typeof value[key] !== 'string' || value[key].length>max) throw new Error(`${labels[key]}은 ${max}자 이하로 입력해 주세요.`);
    card[key]=value[key].trim();
    if (key.endsWith('Label')) card[key]=card[key].replace(/[:：]$/u,'').trim();
    if (key!=='description' && !card[key]) throw new Error(`${labels[key]}을 입력해 주세요.`);
  }
  try {
    const url=new URL(card.url);
    if (url.protocol!=='https:' || !url.hostname || url.username || url.password) throw new Error();
    card.url=url.href;
  } catch { throw new Error('링크는 https://로 시작하는 주소를 입력해 주세요.'); }
  return card;
}

export function renderGitHubCard(value, { inlineStyles = true } = {}) {
  const card=normalizeGitHubCard(value), attrs=name=>articleAttributes(name,inlineStyles);
  return `<div ${attrs('github-card')} data-hdev-github-card="true" role="note" aria-label="주제와 참고 코드">` +
    `<span ${attrs('github-icon')} aria-hidden="true">${escapeArticleText(card.icon)}</span><div ${attrs('github-content')}>` +
    `<div><span ${attrs('github-label')}>${escapeArticleText(card.categoryLabel)}:</span> <span ${attrs('github-topic')}>${escapeArticleText(card.topic)}</span></div>` +
    `<div><span ${attrs('github-label')}>${escapeArticleText(card.sourceLabel)}:</span> <a ${attrs('github-link')} href="${escapeArticleText(card.url)}" target="_blank" rel="noopener noreferrer">${escapeArticleText(card.linkText)}</a></div>` +
    (card.description?`<div ${attrs('github-description')}>${lines(card.description)}</div>`:'') + '</div></div>';
}

export function renderArticleBlock(block, { inlineStyles = true, imageURL = name => `images/${encodeURIComponent(name)}`, headingId } = {}) {
  if (!block || typeof block !== 'object') throw new Error('각 block은 객체여야 합니다.');
  const attrs = name => articleAttributes(name, inlineStyles);
  switch (block.type) {
    case 'heading': return `<h2${headingId ? ` id="${escapeArticleText(headingId)}"` : ''} ${attrs('heading')}>${escapeArticleText(required(block.text, 'heading.text'))}</h2>`;
    case 'paragraph': {
      const text = required(block.text, 'paragraph.text');
      const marker = text.trimStart().match(/^(💡|⚠\uFE0F?|📌|✅)/u)?.[1];
      if (!marker) return `<p ${attrs('paragraph')}>${lines(text)}</p>`;
      const kind = marker === '💡' ? 'tip' : marker.startsWith('⚠') ? 'warning' : 'summary';
      const [title, ...body] = text.trimStart().split(/\r\n?|\n/);
      return `<div ${attrs(`callout ${kind}`)} data-hdev-callout="${kind}">` +
        `<p ${attrs('callout-title')}>${escapeArticleText(title)}</p>` +
        (body.length ? `<p ${attrs('callout-body')}>${lines(body.join('\n'))}</p>` : '') + '</div>';
    }
    case 'code': return `<pre ${attrs('pre')}><code ${attrs('code')}>${escapeArticleText(required(block.text, 'code.text'))}</code></pre>`;
    case 'list':
      if (!Array.isArray(block.items) || !block.items.length) throw new Error('list.items가 비어 있습니다.');
      return `<ul ${attrs('list')}>${block.items.map(item => `<li ${attrs('item')}>${escapeArticleText(required(item, 'list item'))}</li>`).join('')}</ul>`;
    case 'table':
      if (!Array.isArray(block.headers) || !block.headers.length || !Array.isArray(block.rows)) throw new Error('table.headers / rows가 필요합니다.');
      return `<div ${attrs('table-wrap')} role="region" aria-label="비교표" tabindex="0"><table ${attrs(block.headers.length >= 3 ? 'table table-wide' : 'table')}><thead><tr>${block.headers.map(header => `<th scope="col" ${attrs('th')}>${escapeArticleText(required(header, 'table header'))}</th>`).join('')}</tr></thead><tbody>` +
        block.rows.map((row, index) => {
          if (!Array.isArray(row) || row.length !== block.headers.length || !row.every(cell => typeof cell === 'string')) throw new Error('표의 열 수와 문자열 값을 확인하세요.');
          return `<tr ${attrs(index % 2 ? 'row-odd' : 'row-even')}>${row.map(cell => `<td ${attrs('td')}>${escapeArticleText(cell)}</td>`).join('')}</tr>`;
        }).join('') + '</tbody></table></div>';
    case 'image': return `<figure ${attrs('figure')}><img ${attrs('image')} src="${escapeArticleText(imageURL(block.file))}" alt="${escapeArticleText(required(block.alt, 'image.alt'))}">` +
      (block.caption ? `<figcaption ${attrs('caption')}>${escapeArticleText(block.caption)}</figcaption>` : '') + '</figure>';
    default: throw new Error(`지원하지 않는 block.type: ${block.type}`);
  }
}

export function renderArticleContent(blocks, options = {}) {
  const headings = blocks.filter(block => block.type === 'heading');
  const attrs = name => articleAttributes(name, options.inlineStyles !== false);
  const toc = options.includeToc !== false && headings.length ?
    `<div ${attrs('toc')} role="navigation" aria-label="목차" data-hdev-toc="true"><p ${attrs('toc-title')}>목차</p><ul ${attrs('toc-list')}>` +
    headings.map((heading, index) => `<li ${attrs('toc-item')}><a ${attrs('toc-link')} href="#hdev-section-${index + 1}"><span>${escapeArticleText(heading.text)}</span><span aria-hidden="true">→</span></a></li>`).join('') + '</ul></div>' : '';
  let headingIndex = 0;
  const githubCard=options.githubCard==null?'':renderGitHubCard(options.githubCard,options);
  return toc + githubCard + blocks.map(block => renderArticleBlock(block, { ...options, headingId: block.type === 'heading' ? `hdev-section-${++headingIndex}` : undefined })).join('\n');
}
