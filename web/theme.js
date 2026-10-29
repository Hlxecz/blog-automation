// Restore before styles load so a saved light theme never flashes dark on reload.
(() => {
  const root = document.documentElement;
  // Local server ports change on restart; cookies retain this preference across ports.
  root.dataset.theme = document.cookie.split(';').some(value => value.trim() === 'hdev-studio-theme=light') ? 'light' : 'dark';
  document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('.theme-switch button');
    const update = () => buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === root.dataset.theme)));
    buttons.forEach(button => button.addEventListener('click', () => {
      root.dataset.theme = button.dataset.theme;
      document.cookie = `hdev-studio-theme=${root.dataset.theme}; Max-Age=31536000; Path=/; SameSite=Strict`;
      update();
    }));
    update();
  });
})();
