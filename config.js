// Dynamic Builders — shared config & API client
// Every dashboard page (and login.html) loads this file first.

// Paste your deployed Apps Script Web App URL here after you deploy
// Code.gs/Auth.gs (Deploy > New deployment > Web app > Execute as Me,
// Who has access: Anyone). It will look like:
// https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXX/exec
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbz1lif_6wQAlhTFZOvpK7WLaG43SN8mHcuASpo2zPfkijcOrT0Qgz7yie-BTbuZPGj09w/exec';

// Where login.html sends each role after a successful login.
const ROLE_PAGES = {
  IT_ADMIN: 'it-admin.html',
  MANAGER: 'manager.html',
  ADMIN_SECRETARY: 'admin-secretary.html',
  SITE_SUPERVISOR: 'site-supervisor.html'
};

const ROLE_LABELS = {
  IT_ADMIN: 'IT admin',
  MANAGER: 'Manager',
  ADMIN_SECRETARY: 'Admin secretary',
  SITE_SUPERVISOR: 'Site supervisor'
};

/**
 * Call one action on the Apps Script API. Uses a text/plain Content-Type on
 * purpose: Apps Script web apps can't answer a browser's CORS preflight, so
 * the request has to stay a "simple request" (no custom headers, no
 * application/json) to avoid triggering one. The server still parses the
 * body as JSON regardless of the header — see Auth.gs's CORS note.
 */
async function apiCall(action, payload, clientRequestId) {
  const token = sessionStorage.getItem('token');
  const res = await fetch(WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, token: token, payload: payload || {}, clientRequestId: clientRequestId })
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'Something went wrong.');
  return body.data;
}

// ---- duplicate-submit protection ----
//
// Every action that creates or changes a record should go through one of
// these two, not straight into apiCall: both disable the control for the
// duration of the request (so a double click can't fire it twice) and tag
// the call with a fresh id the server uses to collapse an accidental
// duplicate delivery into a single write (see Auth.gs's withIdempotency_).

function newRequestId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

/**
 * Wrap a <form>'s submit handler. `handler(clientRequestId)` should do the
 * apiCall(s) and any success UI itself; guardSubmit only manages the
 * busy/disabled state and the id.
 */
function guardSubmit(form, handler) {
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (form.dataset.submitting === '1') return;
    form.dataset.submitting = '1';
    const btn = form.querySelector('button[type="submit"]');
    const prevText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
    try {
      await handler(newRequestId());
    } finally {
      form.dataset.submitting = '0';
      if (btn) { btn.disabled = false; btn.textContent = prevText; }
    }
  });
}

/**
 * Wrap a one-off action button (Approve, Assign, Resolve, etc.) the same
 * way. Returns an onclick handler: `oneShot(button, async (id) => {...})`.
 */
function oneShot(button, handler) {
  return async function () {
    if (button.disabled) return;
    button.disabled = true;
    const prevText = button.textContent;
    try {
      await handler(newRequestId());
    } catch (err) {
      alert(err.message);
    } finally {
      button.disabled = false;
      button.textContent = prevText;
    }
  };
}

/**
 * Call at the top of every dashboard page. Redirects to login if there's no
 * session, or if the logged-in role doesn't match the page's own role, so a
 * Site Supervisor can't just type manager.html into the address bar.
 */
function requireRole(expectedRole) {
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  if (!token || role !== expectedRole) {
    window.location.href = 'login.html';
    return null;
  }
  return {
    token: token,
    role: role,
    userId: sessionStorage.getItem('userId'),
    name: sessionStorage.getItem('name'),
    email: sessionStorage.getItem('email')
  };
}

function logout() {
  apiCall('logout', {}).catch(function () {}).finally(function () {
    sessionStorage.clear();
    window.location.href = 'login.html';
  });
}

async function reportIssue() {
  const description = prompt('Describe the issue:');
  if (!description) return;
  try {
    await apiCall('raiseTicket', { description: description, category: 'error' });
    alert('Ticket sent to IT admin.');
  } catch (err) {
    alert(err.message);
  }
}

// ---- small shared helpers used across dashboards ----

// Turn a list of rows into an {id: row} map for quick client-side joins,
// e.g. showing a site's name next to a project instead of its raw id.
function byId(rows) {
  const map = {};
  rows.forEach(function (r) { map[r.id] = r; });
  return map;
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d) ? String(value) : d.toLocaleDateString();
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) {
    if (k === 'text') node.textContent = attrs[k];
    else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
    else node.setAttribute(k, attrs[k]);
  });
  (children || []).forEach(function (c) { node.appendChild(c); });
  return node;
}

function showError(containerEl, err) {
  containerEl.textContent = err.message || String(err);
  containerEl.hidden = false;
}

// ---- sidebar tabs: only one section visible at a time ----
//
// Every dashboard's sidebar links to a #section that matches a .panel's id
// in <main>. Instead of those being anchor-scroll links down one long page,
// clicking one shows only that panel (and hides the rest) and marks the
// nav item active — so "click Projects to see Projects" actually switches
// views instead of just jumping down the page.
function setupSidebarTabs(defaultId) {
  const navItems = Array.from(document.querySelectorAll('.sidebar .nav-item[href^="#"]'));
  const panels = Array.from(document.querySelectorAll('main .panel'));
  if (!navItems.length || !panels.length) return;

  function activate(id) {
    let matched = false;
    panels.forEach(function (p) {
      const show = p.id === id;
      p.hidden = !show;
      if (show) matched = true;
    });
    if (!matched) { panels[0].hidden = false; id = panels[0].id; }
    navItems.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + id);
    });
  }

  navItems.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      activate(a.getAttribute('href').slice(1));
      history.replaceState(null, '', a.getAttribute('href'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  const fromHash = (location.hash || '').slice(1);
  activate(fromHash || defaultId || (panels[0] && panels[0].id));
}

// ---- multi-row entry for adding many items before a single submit ----
//
// Renders one blank row (name + detail) into #containerId; the button
// #addBtnId appends another. getRows() returns every non-blank row,
// reset() goes back to a single blank row. Removing the last row leaves a
// fresh blank one so there's always somewhere to type.
function makeCatalogRows(containerId, addBtnId, opts) {
  const container = document.getElementById(containerId);
  const addBtn = document.getElementById(addBtnId);

  function addRow() {
    const name = el('input', { placeholder: opts.namePlaceholder || 'Name' });
    const detail = el('input', { placeholder: opts.detailPlaceholder || '' });
    const removeBtn = el('button', { type: 'button', class: 'secondary small', text: '×' });
    const row = el('div', { class: 'repeater-row' }, [
      el('div', {}, [name]),
      el('div', {}, [detail]),
      removeBtn
    ]);
    row._name = name;
    row._detail = detail;
    // Enter moves on to a fresh row instead of submitting a half-finished batch.
    [name, detail].forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addRow()._name.focus(); }
      });
    });
    removeBtn.addEventListener('click', function () {
      row.remove();
      if (!container.querySelector('.repeater-row')) addRow();
    });
    container.appendChild(row);
    return row;
  }

  addBtn.addEventListener('click', function () { addRow()._name.focus(); });
  addRow();

  return {
    getRows: function () {
      return Array.from(container.querySelectorAll('.repeater-row')).map(function (row) {
        return { name: row._name.value.trim(), detail: row._detail.value.trim() };
      }).filter(function (r) { return r.name || r.detail; });
    },
    reset: function () {
      container.innerHTML = '';
      addRow();
    }
  };
}

// ---- forms that only appear once their trigger button is clicked ----
//
// Every "create" form in the app starts hidden; clicking its trigger
// button (e.g. "+ Add user") reveals it and turns the button into a
// Cancel; clicking again, or a successful submit, closes it back up.
function setupFormToggle(toggleBtn, wrapper, openLabel) {
  openLabel = openLabel || toggleBtn.textContent;
  wrapper.hidden = true;
  function close() {
    wrapper.hidden = true;
    toggleBtn.textContent = openLabel;
  }
  toggleBtn.addEventListener('click', function () {
    if (wrapper.hidden) {
      wrapper.hidden = false;
      toggleBtn.textContent = 'Cancel';
      const first = wrapper.querySelector('input, select, textarea');
      if (first) first.focus();
    } else {
      close();
    }
  });
  return { close: close };
}
