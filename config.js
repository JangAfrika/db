// Dynamic Builders — shared config & API client
// Every dashboard page (and index.html) loads this file first.

// Paste your deployed Apps Script Web App URL here after you deploy
// Code.gs/Auth.gs (Deploy > New deployment > Web app > Execute as Me,
// Who has access: Anyone). It will look like:
// https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXX/exec
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzCFPv81iDX-daFXZib7JBu2-f1a5ZaDmcmpSwXC6mhpPw14arVK86squ3WWbReryxzkg/exec';

// Where index.html sends each role after a successful login.
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

// Same four roles as a <select>-ready options list — used by IT Admin's Add
// user / Edit user / Approve user forms, and by the public registration
// form's "role you're applying for" dropdown.
const ROLE_OPTIONS = [
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN_SECRETARY', label: 'Admin secretary' },
  { value: 'SITE_SUPERVISOR', label: 'Site supervisor' },
  { value: 'IT_ADMIN', label: 'IT admin' }
];

/**
 * Call one action on the Apps Script API. Uses a text/plain Content-Type on
 * purpose: Apps Script web apps can't answer a browser's CORS preflight, so
 * the request has to stay a "simple request" (no custom headers, no
 * application/json) to avoid triggering one. The server still parses the
 * body as JSON regardless of the header — see Auth.gs's CORS note.
 */
async function apiCall(action, payload) {
  const token = sessionStorage.getItem('token');
  const res = await fetch(WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, token: token, payload: payload || {} })
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'Something went wrong.');
  return body.data;
}

/**
 * Wrap a <form>'s submit handler so a double click (or a slow connection)
 * can't fire it twice: disables the submit button and swaps in a "Submitting…"
 * label for the duration of the call. `handler` should do the apiCall(s) and
 * any success UI itself.
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
      await handler();
    } finally {
      form.dataset.submitting = '0';
      if (btn) { btn.disabled = false; btn.textContent = prevText; }
    }
  });
}

/**
 * Wrap a one-off action button (Approve, Assign, Resolve, etc.) the same
 * way. Returns an onclick handler: `oneShot(button, async () => {...})`.
 */
function oneShot(button, handler) {
  return async function () {
    if (button.disabled) return;
    button.disabled = true;
    const prevText = button.textContent;
    try {
      await handler();
    } catch (err) {
      await uiAlert(err.message, { title: 'Something went wrong', danger: true });
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
  if (!token) { window.location.href = 'index.html'; return null; }
  // Logged in but no role yet means the account is still awaiting IT Admin
  // approval (see pending.html) — send them there instead of bouncing back
  // to the login page, which would look like they'd been logged out.
  if (!role) { window.location.href = 'pending.html'; return null; }
  if (role !== expectedRole) { window.location.href = 'index.html'; return null; }
  setupIdleLogout();
  return {
    token: token,
    role: role,
    userId: sessionStorage.getItem('userId'),
    name: sessionStorage.getItem('name'),
    email: sessionStorage.getItem('email')
  };
}

/**
 * Like requireRole(), but for pages any logged-in role may open (e.g. a
 * project detail page reachable from more than one dashboard) — just needs
 * a valid session, not a specific role.
 */
function requireSession() {
  const token = sessionStorage.getItem('token');
  const role = sessionStorage.getItem('role');
  if (!token) { window.location.href = 'index.html'; return null; }
  if (!role) { window.location.href = 'pending.html'; return null; }
  setupIdleLogout();
  return {
    token: token,
    role: role,
    userId: sessionStorage.getItem('userId'),
    name: sessionStorage.getItem('name'),
    email: sessionStorage.getItem('email')
  };
}

/**
 * For pending.html only — a session that's logged in but has no role yet
 * (account registered + email verified, awaiting IT Admin approval).
 * Unlike requireSession()/requireRole(), an empty role is the expected,
 * valid case here rather than a reason to redirect away.
 */
function requirePendingSession() {
  const token = sessionStorage.getItem('token');
  if (!token) { window.location.href = 'index.html'; return null; }
  setupIdleLogout();
  return {
    token: token,
    role: sessionStorage.getItem('role'),
    userId: sessionStorage.getItem('userId'),
    name: sessionStorage.getItem('name'),
    email: sessionStorage.getItem('email')
  };
}

function logout(reason) {
  apiCall('logout', {}).catch(function () {}).finally(function () {
    sessionStorage.clear();
    window.location.href = 'index.html' + (reason ? '?reason=' + encodeURIComponent(reason) : '');
  });
}

// ---- auto-logout after inactivity ----
//
// Called once by requireRole() on every dashboard page. Any mouse, keyboard,
// scroll or touch activity resets the clock; once IDLE_LOGOUT_MINUTES pass
// with none at all, the session is cleared and the page redirects to the
// login screen with a reason it can show the person. This is a client-side
// convenience only — the real session still expires server-side after
// SESSION_TTL_SECONDS (8 hours) regardless of activity.
const IDLE_LOGOUT_MINUTES = 20;
let _idleTimer = null;
let _idleSetUp = false;

function setupIdleLogout(minutes) {
  if (_idleSetUp) return; // only one set of listeners per page
  _idleSetUp = true;
  const ms = (minutes || IDLE_LOGOUT_MINUTES) * 60 * 1000;

  function reset() {
    if (!sessionStorage.getItem('token')) return; // already logged out
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(function () { logout('idle'); }, ms);
  }

  ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart', 'click'].forEach(function (evt) {
    window.addEventListener(evt, reset, { passive: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') reset();
  });

  reset();
}

// Resize + compress an image file in the browser before it ever leaves the
// page — a phone photo can be several MB, and nothing here needs more than
// maxDim px on its longest side. Shared by the Daily Report photo picker and
// reportIssue()'s screenshot attachment, so there's one implementation to
// trust instead of two copies that could drift apart.
function resizeImageToDataUrl(file, maxDim, quality) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onerror = function () { reject(new Error('Could not read "' + file.name + '".')); };
    reader.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error('"' + file.name + '" does not look like a valid image.')); };
      img.onload = function () {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Shared "raise a ticket" flow — a popup form (description + an optional
// screenshot) that uploads the screenshot if given and calls raiseTicket().
// Returns true on success, false if cancelled or it failed (an error is
// already shown to the user in that case). Used by reportIssue() (the
// sidebar's quick "Report an issue" action, which always lands on the
// IT Admin queue) and by each dashboard's own "+ TICKET ⚠" button on its
// Tickets tab, which also wants to refresh its own ticket list afterwards.
async function raiseTicketFlow() {
  const values = await uiForm({
    title: 'Raise a ticket',
    message: 'Tell IT what went wrong and we will look into it.',
    okText: 'Send to IT',
    fields: [
      { key: 'description', label: 'Description', multiline: true, rows: 4, placeholder: 'What happened, and what were you trying to do?' },
      { key: 'screenshot', label: 'Screenshot', type: 'file', required: false, placeholder: 'No screenshot attached' }
    ]
  });
  if (!values) return false;
  try {
    let screenshot_path = '';
    if (values.screenshot) {
      const dataUrl = await resizeImageToDataUrl(values.screenshot, 1600, 0.82);
      const uploaded = await apiCall('uploadTicketScreenshot', {
        filename: values.screenshot.name || 'screenshot.jpg',
        mimeType: 'image/jpeg',
        dataBase64: dataUrl.split(',')[1]
      });
      screenshot_path = uploaded.photo_path;
    }
    await apiCall('raiseTicket', { description: values.description, category: 'error', screenshot_path: screenshot_path });
    return true;
  } catch (err) {
    await uiAlert(err.message, { title: 'Something went wrong', danger: true });
    return false;
  }
}

// "Report an issue" — the sidebar's quick action, kept exactly as it
// behaved before: raise it and confirm, without needing a Tickets tab open.
async function reportIssue() {
  const ok = await raiseTicketFlow();
  if (ok) await uiAlert('Your ticket has been sent to the IT admin.', { title: 'Ticket sent', tone: 'success' });
}

// Renders "My tickets" (status + resolution notes) into bodyEl, filtered to
// the given userId — the shared table body for every dashboard's Tickets
// tab. tickets is the full TICKETS list (dashboards already have it cached
// or fetch it fresh); this just filters and draws.
function renderMyTickets(bodyEl, tickets, userId) {
  bodyEl.innerHTML = '';
  const mine = tickets.filter(function (t) { return t.raised_by === userId; }).slice().reverse();
  if (!mine.length) {
    bodyEl.appendChild(el('tr', {}, [el('td', { colspan: '5', class: 'empty', text: 'You haven\'t raised any tickets yet.' })]));
    return;
  }
  mine.forEach(function (t) {
    bodyEl.appendChild(el('tr', {}, [
      el('td', { text: t.category || '—' }),
      el('td', { text: t.description || '—' }),
      el('td', {}, [el('span', { class: 'status ' + t.status, text: t.status })]),
      el('td', { text: t.created_at ? fmtDate(t.created_at) : '—' }),
      el('td', { text: t.status === 'resolved' ? (t.resolution_notes || '—') : '—' })
    ]));
  });
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

// ---- "come back to where I was" navigation ----
//
// Every *Link() helper below opens a standalone detail page. So that page's
// "Back" link can return to the exact dashboard tab the click came from
// (not just the dashboard's default tab), each link records which tab it
// was rendered inside of — found at click time by walking up to the
// nearest .panel ancestor — as a `from=<tabId>` query param tacked onto its
// own href right before the browser navigates. A link that isn't inside a
// dashboard .panel (e.g. one standalone page linking to another) falls back
// to window.CURRENT_ORIGIN_TAB, which that page sets from its own `from`
// param — so the tab the user originally started from keeps following them
// through a chain of detail pages.
function withOriginTab_(anchor) {
  anchor.addEventListener('click', function () {
    try {
      const panel = anchor.closest('.panel');
      const tab = panel ? panel.id : (window.CURRENT_ORIGIN_TAB || null);
      if (!tab) return;
      const url = new URL(anchor.href, window.location.href);
      url.searchParams.set('from', tab);
      anchor.href = url.toString();
    } catch (e) { /* if anything goes wrong, just navigate without it */ }
  });
  return anchor;
}

// Call on every standalone detail page right after requireRole()/
// requireSession(), before building any *Link()s on that page. Reads this
// page's own `from` param so links further down the chain inherit it, and
// returns the href the page's own "Back" button should use.
// The Back link also prefers real browser history: if this page was opened
// from another page of the site (a KPI page, a dashboard tab, another detail
// page), Back returns to exactly that page and place instead of always going
// to the dashboard. The computed href below is only the fallback, for when
// the page was opened directly (bookmark, pasted link, new tab).
document.addEventListener('click', function (e) {
  const a = e.target.closest ? e.target.closest('a.back-link') : null;
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  try {
    if (window.history.length > 1 && document.referrer &&
        new URL(document.referrer).origin === window.location.origin) {
      e.preventDefault();
      window.history.back();
    }
  } catch (err) { /* fall through to the normal href */ }
});

function backLinkHref(session) {
  const from = new URLSearchParams(window.location.search).get('from');
  if (from) window.CURRENT_ORIGIN_TAB = from;
  const base = (session && ROLE_PAGES[session.role]) || 'index.html';
  return from ? base + '#' + encodeURIComponent(from) : base;
}

// A project name rendered as a link to its own interactive page
// (project.html?id=...). Used anywhere a table shows a project by name, so
// every dashboard can drill into the same project detail/print view.
function projectLink(id, name) {
  if (!id) return document.createTextNode(name || '—');
  return withOriginTab_(el('a', { class: 'name-link', href: 'project.html?id=' + encodeURIComponent(id), text: name || '(untitled project)' }));
}

function userLink(id, name) {
  if (!id) return document.createTextNode(name || '—');
  return withOriginTab_(el('a', { class: 'name-link', href: 'user.html?id=' + encodeURIComponent(id), text: name || '(unnamed user)' }));
}

function planLink(id, label) {
  if (!id) return document.createTextNode(label || '—');
  return withOriginTab_(el('a', { class: 'name-link', href: 'daily-plan.html?id=' + encodeURIComponent(id), text: label || 'View plan' }));
}

function reportLink(id, label) {
  if (!id) return document.createTextNode(label || '—');
  return withOriginTab_(el('a', { class: 'name-link', href: 'report.html?id=' + encodeURIComponent(id), text: label || 'View report' }));
}

function weeklyReviewLink(id, label) {
  if (!id) return document.createTextNode(label || '—');
  return withOriginTab_(el('a', { class: 'name-link', href: 'weekly-review.html?id=' + encodeURIComponent(id), text: label || 'View review' }));
}

function monthlyReviewLink(id, label) {
  if (!id) return document.createTextNode(label || '—');
  return withOriginTab_(el('a', { class: 'name-link', href: 'monthly-review.html?id=' + encodeURIComponent(id), text: label || 'View review' }));
}

function siteLink(id, name) {
  if (!id) return document.createTextNode(name || '—');
  return withOriginTab_(el('a', { class: 'name-link', href: 'site.html?id=' + encodeURIComponent(id), text: name || '(unnamed site)' }));
}

function kpiLink(userId, label) {
  if (!userId) return document.createTextNode(label || '—');
  return withOriginTab_(el('a', { class: 'name-link', href: 'kpi.html?userId=' + encodeURIComponent(userId), text: label || 'View KPI' }));
}

// A site's GPS coordinates, shown as a clickable value that confirms before
// jumping to the Map page centered on that site (map.html parses gps_coords
// itself from the site record — siteId is all this link needs to carry).
function gpsLink(coords, siteId) {
  if (!coords) return document.createTextNode('—');
  const a = el('a', { class: 'name-link', href: 'map.html' + (siteId ? '?site=' + encodeURIComponent(siteId) : ''), text: coords });
  a.addEventListener('click', async function (e) {
    e.preventDefault();
    const href = a.href;
    if (await uiConfirm('Open this location on the map?', { title: 'Open map', okText: 'Open map' })) {
      window.location.href = href;
    }
  });
  return a;
}

// ---- shared "+ RESOURCES" switchable add form ----
//
// materials.html, equipment.html and productivity-targets.html each carry
// their own copy of a hidden #resourceSection (shown as a popup via
// uiHostDialog) with a Type dropdown and three field groups — picking a
// type in the dropdown shows only that type's fields. This wires the
// show/hide-by-type and submit logic once so it isn't tripled across the
// three pages; the markup (ids: res_type, res_fields_material/equipment/
// target, res_m_*/res_e_*/res_t_*, resourceInnerForm, resourceError,
// resourceSuccess) is expected to already be on the page.
// `sites` populates the productivity target's Site dropdown (pass [] if the
// calling page has no use for it). `onAdded(type)` fires after a successful
// add so the calling page can refresh whichever of its own lists applies.
function setupResourceForm(sites, onAdded) {
  const typeSelect = document.getElementById('res_type');
  const groups = {
    material: document.getElementById('res_fields_material'),
    equipment: document.getElementById('res_fields_equipment'),
    target: document.getElementById('res_fields_target')
  };
  const errorEl = document.getElementById('resourceError');
  const successEl = document.getElementById('resourceSuccess');
  const form = document.getElementById('resourceInnerForm');
  const siteSelect = document.getElementById('res_t_site');

  siteSelect.innerHTML = '';
  (sites || []).forEach(function (s) { siteSelect.appendChild(el('option', { value: s.id, text: s.name + ' — ' + s.location })); });

  function showGroup(type) {
    Object.keys(groups).forEach(function (k) { groups[k].hidden = k !== type; });
  }
  showGroup(typeSelect.value);
  typeSelect.addEventListener('change', function () { showGroup(typeSelect.value); errorEl.hidden = true; });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;
    const type = typeSelect.value;
    try {
      if (type === 'material') {
        const name = document.getElementById('res_m_name').value.trim();
        const unit = document.getElementById('res_m_unit').value.trim();
        if (!name || !unit) throw new Error('Name and unit are required.');
        await apiCall('insert', { table: 'MATERIALS', record: { name: name, unit: unit } });
      } else if (type === 'equipment') {
        const name = document.getElementById('res_e_name').value.trim();
        const eqType = document.getElementById('res_e_type').value.trim();
        if (!name || !eqType) throw new Error('Name and type are required.');
        await apiCall('insert', { table: 'EQUIPMENT', record: { name: name, type: eqType } });
      } else {
        const site_id = siteSelect.value;
        const trade = document.getElementById('res_t_trade').value.trim();
        const unit = document.getElementById('res_t_unit').value.trim();
        const daily_target = document.getElementById('res_t_daily_target').value;
        if (!site_id || !trade || !unit || !daily_target) throw new Error('Site, trade, unit and daily target are all required.');
        await apiCall('insert', { table: 'PRODUCTIVITY_TARGETS', record: { site_id: site_id, trade: trade, unit: unit, daily_target: daily_target } });
      }
      form.reset();
      typeSelect.value = type;
      showGroup(type);
      successEl.textContent = 'Added.';
      successEl.hidden = false;
      if (onAdded) onAdded(type);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });
}

function clientLink(id, name) {
  if (!id) return document.createTextNode(name || '—');
  return withOriginTab_(el('a', { class: 'name-link', href: 'client.html?id=' + encodeURIComponent(id), text: name || '(unnamed client)' }));
}

// ---- add a client/consultant, inline from the site form ----
//
// The site add/edit forms' "Client / consultant" field is a <select> of
// existing CLIENTS plus a "+ Add new…" option; picking that option calls
// this to collect the new client's details in its own small popup, create
// it, and return the new record so the caller can use its id as client_id
// right away — the site form doesn't need to be reopened.
async function addClientFlow(session) {
  const values = await uiForm({
    title: 'Add client / consultant',
    okText: 'Add',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type', type: 'select', value: 'client', options: [{ value: 'client', label: 'Client' }, { value: 'consultant', label: 'Consultant' }] },
      { key: 'contact_name', label: 'Contact person', required: false },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'email', label: 'Email', required: false, type: 'email' },
      { key: 'address', label: 'Address', required: false },
      { key: 'notes', label: 'Notes', multiline: true, required: false }
    ]
  });
  if (!values) return null;
  values.created_by = session.userId;
  values.created_at = new Date().toISOString();
  const id = (await apiCall('insert', { table: 'CLIENTS', record: values })).id;
  return Object.assign({ id: id }, values);
}

// Builds the <select> options for a site form's "Client / consultant"
// field: existing clients (grouped label shows which are consultants) plus
// a trailing "+ Add new…" option the caller checks for by value '__new__'.
function clientSelectOptions(clients) {
  const options = [{ value: '', label: '— none —' }];
  clients.forEach(function (c) {
    options.push({ value: c.id, label: c.name + ' (' + (c.type === 'consultant' ? 'Consultant' : 'Client') + ')' });
  });
  options.push({ value: '__new__', label: '+ Add new client/consultant…' });
  return options;
}

// A project's manual progress_percent rendered as a small bar + %. When
// `onEdit` is given (roles allowed to update progress), clicking it opens a
// number prompt and calls onEdit(newPercent) — the caller does the actual
// apiCall('updateProjectProgress', ...) and re-render.
function progressBar(percent, onEdit) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const fill = el('div', { class: 'progress-fill' + (pct >= 100 ? ' complete' : '') });
  fill.style.width = pct + '%';
  const wrap = el('div', { class: 'progress-wrap' + (onEdit ? ' editable' : '') }, [
    el('div', { class: 'progress-track' }, [fill]),
    el('span', { class: 'progress-pct', text: pct + '%' })
  ]);
  if (onEdit) {
    wrap.title = 'Click to update progress';
    wrap.addEventListener('click', async function () {
      const value = await uiPrompt('Progress (%)', { title: 'Update progress', label: 'Progress (0-100)', value: String(pct), type: 'number' });
      if (value === null || value === undefined || value === '') return;
      const next = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
      onEdit(next);
    });
  }
  return wrap;
}

function showError(containerEl, err) {
  containerEl.textContent = err.message || String(err);
  containerEl.hidden = false;
}

// ---- mobile sidebar: hamburger-triggered off-canvas drawer ----
//
// Below the 860px breakpoint the sidebar is hidden off-screen by CSS; this
// wires up the hamburger button to slide it in, a backdrop tap or a nav
// click to close it again, and resets state if the window is resized back
// past the breakpoint. Call once per page, after the sidebar/backdrop/
// hamburger markup exists in the DOM.
function setupMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const toggleBtn = document.getElementById('sidebarToggle');
  if (!sidebar || !toggleBtn) return;

  function open() {
    sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    document.body.classList.add('sidebar-locked');
  }
  function close() {
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.body.classList.remove('sidebar-locked');
  }

  toggleBtn.addEventListener('click', function () {
    if (sidebar.classList.contains('open')) close(); else open();
  });
  if (backdrop) backdrop.addEventListener('click', close);
  sidebar.querySelectorAll('.nav-item').forEach(function (item) {
    item.addEventListener('click', function () { if (window.innerWidth <= 860) close(); });
  });
  window.addEventListener('resize', function () { if (window.innerWidth > 860) close(); });
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

  // Exposed so code outside this function (e.g. "Edit" on a row in one tab
  // that needs to show a form living in another tab) can switch tabs too.
  window.showSidebarTab = function (id) {
    activate(id);
    history.replaceState(null, '', '#' + id);
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
