// pwa.js — makes the app installable, and actually tells people so.
// Loaded by every page, right after ga.js.
//
// Two separate things happen here:
// 1. Register the service worker (sw.js) — required, along with
//    manifest.json, for Chrome/Edge/Android to consider this a real,
//    installable app.
// 2. Chrome doesn't show its own install UI automatically — it fires
//    "beforeinstallprompt" and waits for the page to call .prompt() itself.
//    Left alone, most people never see an install option at all. This
//    captures that event and shows a small "Install app" button in the
//    corner so the prompt is actually reachable.

(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButton();
  });

  // Already installed and running standalone (iOS Safari has no
  // beforeinstallprompt event at all) — nothing to show either way.
  function alreadyInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function showInstallButton() {
    if (alreadyInstalled() || document.getElementById('pwaInstallBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'pwaInstallBtn';
    btn.type = 'button';
    btn.textContent = 'Install app';
    btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:1000;' +
      'background:#3355e8;color:#fff;border:none;border-radius:999px;' +
      'padding:10px 18px;font-size:13px;font-weight:600;font-family:inherit;' +
      'box-shadow:0 8px 20px rgba(16,24,40,.25);cursor:pointer;';
    btn.addEventListener('click', function () {
      btn.remove();
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
    });
    document.addEventListener('DOMContentLoaded', function () {
      if (document.body && !document.getElementById('pwaInstallBtn')) document.body.appendChild(btn);
    });
    if (document.body) document.body.appendChild(btn);
  }

  window.addEventListener('appinstalled', function () {
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.remove();
    deferredPrompt = null;
  });
})();
