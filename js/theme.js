// theme.js — light/dark scheme + the shared page frame. Loaded in every
// page's <head> so the saved scheme is on <html> before anything paints.
//
// Once the page is parsed it also:
// - moves each page's title block (.topbar-title) and its action buttons
//   (Edit, Delete, Print…) out of the top bar into a .page-head at the top of
//   <main>, so the top bar holds only navigation, search and who's signed in;
// - adds the moon/sun switch (and Sign out, where there's a session) to the
//   right of the top bar, or a floating switch on pages without one.
// Nodes are moved, not copied, so every listener and id-based lookup the
// page already has keeps working.

(function () {
  const KEY = 'db_theme';

  function saved() {
    try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }
  function apply(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.querySelectorAll('[data-theme-toggle]').forEach(paintButton);
  }
  function toggle() {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* private mode: still switches for this page */ }
    apply(next);
  }

  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const LOGOUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
  const CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

  function paintButton(btn) {
    const dark = document.documentElement.classList.contains('dark');
    const label = dark ? 'Light' : 'Dark';
    btn.title = dark ? 'Switch to light scheme' : 'Switch to dark scheme';
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = (dark ? SUN : MOON) + (btn.classList.contains('topicon') ? '<span>' + label + '</span>' : '');
  }

  function makeButton(cls) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls;
    btn.setAttribute('data-theme-toggle', '');
    btn.addEventListener('click', toggle);
    paintButton(btn);
    return btn;
  }

  function buildFrame() {
    const topbar = document.querySelector('header.topbar');
    if (!topbar) {
      document.body.appendChild(makeButton('themebtn'));
      return;
    }

    const actions = topbar.querySelector('.topbar-actions');
    const title = topbar.querySelector('.topbar-title');
    const main = document.querySelector('main');
    if (title && main) {
      const head = document.createElement('div');
      head.className = 'page-head';
      head.appendChild(title);
      if (actions) {
        const grow = document.createElement('div');
        grow.className = 'grow';
        Array.from(actions.children).forEach(function (el) {
          if (el.matches('button, a.btn-link, select')) grow.appendChild(el);
        });
        if (grow.children.length) head.appendChild(grow);
      }
      main.insertBefore(head, main.firstChild);
    }

    const back = topbar.querySelector('.back-link');
    if (back) {
      const text = back.textContent.replace(/^\s*←\s*/, '').trim() || 'Back';
      back.innerHTML = CHEVRON + '<span></span>';
      back.querySelector('span').textContent = text;
    }

    const host = actions || topbar;
    host.appendChild(makeButton('topicon'));
    let signedIn = false;
    try { signedIn = !!sessionStorage.getItem('token'); } catch (e) { /* storage blocked */ }
    if (typeof window.logout === 'function' && signedIn) {
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'topicon';
      out.title = 'Log out';
      out.innerHTML = LOGOUT + '<span>Sign out</span>';
      out.addEventListener('click', function () { window.logout(); });
      host.appendChild(out);
    }
  }

  apply(saved());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildFrame);
  else buildFrame();
})();
