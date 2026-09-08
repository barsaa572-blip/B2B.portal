(() => {
  const root = document.documentElement;
  const preference = matchMedia('(prefers-color-scheme: dark)');
  let saved;
  try { saved = localStorage.getItem('flightb2b-theme'); } catch {}
  const setTheme = theme => {
    root.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.textContent = theme === 'dark' ? '☀ Day mode' : '☾ Night mode';
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    });
  };
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.themeToggle = ''; button.className = 'theme-toggle secondary';
  button.setAttribute('aria-label', 'Toggle day and night mode');
  document.body.append(button);
  setTheme(saved === 'dark' || saved === 'light' ? saved : preference.matches ? 'dark' : 'light');
  button.addEventListener('click', () => {
    saved = root.dataset.theme === 'dark' ? 'light' : 'dark'; setTheme(saved);
    try { localStorage.setItem('flightb2b-theme', saved); } catch {}
  });
  preference.addEventListener('change', event => { if (!saved) setTheme(event.matches ? 'dark' : 'light'); });
  const toast = document.querySelector('#toast');
  if ('showPopover' in toast) toast.setAttribute('popover', 'manual');
  const refreshToastLayer = () => {
    if (toast.classList.contains('show')) {
      if (toast.showPopover) { if (toast.matches(':popover-open')) toast.hidePopover(); toast.showPopover(); }
      else (Array.from(document.querySelectorAll('dialog[open]')).at(-1) || document.body).append(toast);
    } else if (toast.hidePopover && toast.matches(':popover-open')) toast.hidePopover();
  };
  new MutationObserver(refreshToastLayer).observe(toast, { attributes: true, attributeFilter: ['class'], childList: true });
  new MutationObserver(refreshToastLayer).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
})();
