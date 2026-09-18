// Read only the account's own blog list, observed at /member/blog on 2026-09-18.
export const accountUrl = 'https://www.tistory.com/member/blog';

export function accountBlogsCommand() {
  if (!['www.tistory.com', 'tistory.com'].includes(location.hostname) || location.pathname !== '/member/blog') return null;
  const list = document.querySelector('ul.ac-ul-blog');
  if (!list) return null;
  return [...list.querySelectorAll(':scope > li.ac-li-blog')].map(row => {
    const manage = row.querySelector('a.ac-item-thumb[href]');
    const title = row.querySelector('.ac-item-desc strong')?.textContent.trim();
    if (!manage || !title) throw new Error('티스토리의 내 블로그 목록 형식이 바뀌었습니다.');
    const url = new URL(manage.href);
    if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.tistory\.com$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/manage' || url.search || url.hash)
      throw new Error('내 블로그의 관리 주소를 확인하지 못했습니다.');
    return { url: url.origin, title };
  });
}

export function createTistoryAccountReader({ openWindow, timeout = 5 * 60 * 1000 }) {
  return async () => {
    const win = openWindow(accountUrl), wc = win.webContents;
    const end = Date.now() + timeout;
    try {
      while (Date.now() < end) {
        if (win.isDestroyed()) throw new Error('로그인 창을 닫았습니다. 티스토리 로그인을 다시 눌러 주세요.');
        if (!wc.isLoadingMainFrame()) {
          const url = new URL(wc.getURL() || 'about:blank');
          if (url.protocol === 'https:' && ['www.tistory.com', 'tistory.com'].includes(url.hostname)) {
            if (url.pathname === '/member/blog') {
              const result = await wc.executeJavaScript(`(() => { try { return { blogs: (${accountBlogsCommand.toString()})() }; } catch (error) { return { error: error.message }; } })()`);
              if (result.error) throw new Error(result.error);
              const blogs = result.blogs;
              if (blogs) {
                if (!blogs.length) throw new Error('이 계정에 운영 중인 블로그가 없습니다. 티스토리에서 블로그를 만든 뒤 다시 연결해 주세요.');
                return blogs;
              }
            } else if (url.pathname === '/') {
              // Some login flows return to the home page instead of the return URL.
              await wc.loadURL(accountUrl);
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      throw new Error('로그인 확인 시간이 지났습니다. 다시 눌러 로그인과 추가 인증을 완료해 주세요.');
    } finally { if (!win.isDestroyed()) win.close(); }
  };
}
