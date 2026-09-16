import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(ip, prefix);
export const publicIP = ip => isIP(ip) === 4 ? !blocked.check(ip) : isIP(ip) === 6 && /^[23][a-f\d]{3}:/i.test(ip) && !/^2001:(?:0:|db8:)/i.test(ip);
export function publicAddress(value) {
  let url;
  try { url = new URL(value); } catch { fail('https://로 시작하는 공개 웹 페이지 주소를 입력해 주세요.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(url.hostname.replace(/[\[\]]/g,'')) || !url.hostname.includes('.') || /\.(localhost|local|internal)$/i.test(url.hostname)) fail('공개 웹 페이지의 HTTPS 주소를 입력해 주세요.');
  url.hash = '';
  return url.href.replace(/\/$/, '');
}

// Resolve and pin public addresses for every redirect; no credentials or cookies are sent.
export const fetchPublicPage = (input, redirects = 0) => requestPublic(input, null, redirects);
export async function fetchPublicJSON(input, data) {
  const page = await requestPublic(input, JSON.stringify(data));
  return JSON.parse(page.text);
}
async function requestPublic(input, body, redirects = 0) {
  const url = new URL(publicAddress(input));
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicIP(a.address))) fail('이 주소는 공개 웹 페이지 주소로 사용할 수 없습니다.');
  const chosen = addresses.find(a => a.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: body === null ? 'GET' : 'POST', agent: false, signal: AbortSignal.timeout(15000),
      headers: { Accept: body === null ? 'text/html, application/xml, text/xml, */*' : 'application/json', 'User-Agent': 'HDevStudio/0.4 (public reference reader)',
        ...(body === null ? {} : { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }) },
      lookup: (_host, options, callback) => options.all ? callback(null, [chosen]) : callback(null, chosen.address, chosen.family)
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        res.resume();
        if (body !== null || redirects >= 3 || !res.headers.location) return reject(new Error('페이지 주소 이동을 확인하지 못했습니다.'));
        try { resolve(fetchPublicPage(new URL(res.headers.location, url).href, redirects + 1)); } catch (e) { reject(e); }
        return;
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`공개 글에 연결하지 못했습니다 (${res.statusCode}).`)); }
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { req.destroy(new Error('공개 글의 크기가 너무 큽니다.')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), url: url.href, contentType: res.headers['content-type'] || '' }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}
