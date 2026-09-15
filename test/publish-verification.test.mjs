import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPublishedPost } from '../desktop/publish.mjs';

const blogUrl = 'https://example.tistory.com';
const draft = { title: '확인한 글', tags: [], blocks: [{ type: 'paragraph', text: '검토한 본문' }] };
const feed = '<rss><channel><title>Test</title><item><title>확인한 글</title><link>https://example.tistory.com/19</link></item></channel></rss>';
const html = '<html><head><meta property="og:title" content="확인한 글"></head><body>검토한 본문</body></html>';

test('publication verification discovers the real numeric URL and needs no open editor', async () => {
  const visited = [];
  const result = await waitForPublishedPost({ blogUrl, draft, uploaded: {}, candidateUrl: `${blogUrl}/entry/title`, timeoutMs: 10,
    fetchPublic: async (url, options) => {
      visited.push(url); assert.equal(options.credentials, 'omit');
      return url.endsWith('/rss') ? new Response(feed) : url.endsWith('/19') ? new Response(html) : new Response('', { status: 404 });
    } });
  assert.equal(result, `${blogUrl}/19`);
  assert.deepEqual(visited, [`${blogUrl}/rss`, `${blogUrl}/19`]);
});

test('an RSS entry alone cannot mark a missing, private, or deleted post as published', async () => {
  await assert.rejects(waitForPublishedPost({ blogUrl, draft, uploaded: {}, candidateUrl: `${blogUrl}/entry/title`, timeoutMs: 1,
    fetchPublic: async url => url.endsWith('/rss') ? new Response(feed) : new Response('', { status: 404 }) }), /확인하지 못했/);
});
