// analytics.js — the Analytics tab shared by the Manager and Admin secretary
// dashboards. Needs config.js and charts.js loaded first, plus this markup:
//   nav link href="#analytics", a panel #analytics containing
//   #anRange (select), #anRefresh (button) and #analyticsRoot (div).

const AN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AN_STATUS_COLORS = {
  pending_approval: '#d99a0b', submitted: '#d99a0b', pending_review: '#d99a0b',
  approved: '#12875e', reviewed: '#3355e8', assigned: '#7a5af8', completed: '#0ea5a4'
};

function anPad(n) { return n < 10 ? '0' + n : String(n); }
function anKey(d) { return d.getFullYear() + '-' + anPad(d.getMonth() + 1) + '-' + anPad(d.getDate()); }

// A plain 'YYYY-MM-DD' is used as-is; anything with a time part is read in
// the browser's local time (same as fmtDate), so a day never drifts.
function anDayKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && value.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return isNaN(d) ? '' : anKey(d);
}

function anParseKey(key) {
  const p = key.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function anWeekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // weeks start on Monday
  return x;
}

function anBuildWeeks(n) {
  const start = anWeekStart(new Date());
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - 7 * i);
    out.push(anKey(d));
  }
  return out;
}

function anWeekOf(dayKey) { return dayKey ? anKey(anWeekStart(anParseKey(dayKey))) : ''; }
function anLabel(weekKey) { const d = anParseKey(weekKey); return d.getDate() + ' ' + AN_MONTHS[d.getMonth()]; }
function anSum(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }
function anNice(status) { return String(status || '').replace(/_/g, ' '); }
function anColor(status, i) { return AN_STATUS_COLORS[status] || CHART_COLORS[i % CHART_COLORS.length]; }

// Count rows per week bucket using dateFn(row) to say which day a row belongs to.
function anCount(rows, dateFn, weeks) {
  const idx = {};
  weeks.forEach(function (w, i) { idx[w] = i; });
  const out = weeks.map(function () { return 0; });
  rows.forEach(function (r) {
    const w = anWeekOf(anDayKey(dateFn(r)));
    if (Object.prototype.hasOwnProperty.call(idx, w)) out[idx[w]]++;
  });
  return out;
}

function anCountBy(rows, statusFn) {
  const counts = {};
  rows.forEach(function (r) { const s = statusFn(r); counts[s] = (counts[s] || 0) + 1; });
  return Object.keys(counts).map(function (s, i) { return { label: anNice(s), value: counts[s], color: anColor(s, i) }; });
}

function anDelta(cur, prev, n) {
  if (!prev && !cur) return { text: 'no activity in either period', cls: '' };
  if (!prev) return { text: '▲ new — nothing in the previous ' + n + ' weeks', cls: 'up' };
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return { text: 'same as the previous ' + n + ' weeks', cls: '' };
  return { text: (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '% vs previous ' + n + ' weeks', cls: pct > 0 ? 'up' : 'down' };
}

function anStat(label, value, delta) {
  const kids = [el('div', { class: 'label', text: label }), el('div', { class: 'value', text: String(value) })];
  if (delta) kids.push(el('div', { class: 'delta ' + delta.cls, text: delta.text }));
  return el('div', { class: 'stat-card' }, kids);
}

function anCard(title, subtitle, wide) {
  const body = el('div', {});
  const kids = [el('h4', { text: title })];
  if (subtitle) kids.push(el('p', { class: 'muted', text: subtitle }));
  kids.push(body);
  return { card: el('div', { class: 'chart-card' + (wide ? ' wide' : '') }, kids), body: body };
}

async function anFetch() {
  const names = ['PROJECTS', 'WORK_PLANS', 'DAILY_REPORTS', 'COMPLETION_NOTICES', 'USERS', 'PROJECT_ASSIGNMENTS'];
  const results = await Promise.all(names.map(function (t) { return apiCall('list', { table: t }); }));
  return {
    projects: results[0], plans: results[1], reports: results[2],
    notices: results[3], users: results[4], assignments: results[5]
  };
}

function anRender(root, data, n) {
  root.innerHTML = '';
  const today = anKey(new Date());
  const allWeeks = anBuildWeeks(n * 2);
  const weeks = allWeeks.slice(n);
  const labels = weeks.map(anLabel);
  const startKey = weeks[0];
  const inRange = function (key) { return key && key >= startKey; };
  const split = function (arr) { return { prev: anSum(arr.slice(0, n)), cur: anSum(arr.slice(n)) }; };

  const planDay = function (p) { return anDayKey(p.plan_date); };
  const reportDay = function (r) { return anDayKey(r.report_date); };
  const projectDate = function (p) { return p.created_at || p.approved_at || p.planned_start; };
  const supervisors = data.users.filter(function (u) { return u.role === 'SITE_SUPERVISOR'; });

  // ---- period totals for the stat cards ----
  const projectsWeekly = anCount(data.projects, projectDate, allWeeks);
  const plansWeekly = anCount(data.plans, function (p) { return p.plan_date; }, allWeeks);
  const reportsWeekly = anCount(data.reports, function (r) { return r.report_date; }, allWeeks);
  const flaggedWeekly = anCount(data.notices, function (c) { return c.created_at; }, allWeeks);
  const ackWeekly = anCount(data.notices.filter(function (c) { return c.reviewed_at; }), function (c) { return c.reviewed_at; }, allWeeks);

  const activeSupervisorIds = {};
  data.plans.forEach(function (p) { if (inRange(planDay(p))) activeSupervisorIds[p.supervisor_id] = true; });
  data.reports.forEach(function (r) { if (inRange(reportDay(r))) activeSupervisorIds[r.supervisor_id] = true; });
  const activeSupervisors = supervisors.filter(function (u) { return activeSupervisorIds[u.id]; }).length;

  const statGrid = el('div', { class: 'stat-grid' });
  const sp = split(projectsWeekly), sl = split(plansWeekly), sr = split(reportsWeekly), sf = split(flaggedWeekly);
  statGrid.appendChild(anStat('Projects recorded', sp.cur, anDelta(sp.cur, sp.prev, n)));
  statGrid.appendChild(anStat('Work plans submitted', sl.cur, anDelta(sl.cur, sl.prev, n)));
  statGrid.appendChild(anStat('Daily reports submitted', sr.cur, anDelta(sr.cur, sr.prev, n)));
  statGrid.appendChild(anStat('Completions flagged', sf.cur, anDelta(sf.cur, sf.prev, n)));
  statGrid.appendChild(anStat('Active supervisors', activeSupervisors + ' / ' + supervisors.length, { text: 'submitted a plan or report in the period', cls: '' }));
  root.appendChild(statGrid);

  // ---- Projects ----
  root.appendChild(el('h3', { class: 'chart-section', text: 'Projects' }));
  const projGrid = el('div', { class: 'chart-grid' });
  let c = anCard('Projects by status', 'All projects, all time');
  donutChart(c.body, { data: anCountBy(data.projects, function (p) { return p.status; }), centerLabel: 'projects', emptyText: 'No projects recorded yet.' });
  projGrid.appendChild(c.card);

  c = anCard('Projects recorded per week', 'Last ' + n + ' weeks');
  columnChart(c.body, { labels: labels, series: [{ name: 'Projects', color: CHART_COLORS[0], values: projectsWeekly.slice(n) }], emptyText: 'No projects recorded in this period.' });
  const undated = data.projects.filter(function (p) { return !anDayKey(projectDate(p)); }).length;
  if (undated) c.card.appendChild(el('p', { class: 'analytics-note', text: undated + ' older project(s) have no recorded date and are left out of this chart.' }));
  projGrid.appendChild(c.card);
  root.appendChild(projGrid);

  // ---- Plans & reports ----
  root.appendChild(el('h3', { class: 'chart-section', text: 'Work plans & daily reports' }));
  const prGrid = el('div', { class: 'chart-grid' });

  c = anCard('Work plans per week', 'Submitted vs approved by the Manager');
  lineChart(c.body, {
    labels: labels, emptyText: 'No work plans in this period.',
    series: [
      { name: 'Submitted', color: CHART_COLORS[0], values: plansWeekly.slice(n) },
      { name: 'Approved', color: CHART_COLORS[1], values: anCount(data.plans.filter(function (p) { return p.approved_at; }), function (p) { return p.approved_at; }, weeks) }
    ]
  });
  prGrid.appendChild(c.card);

  c = anCard('Daily reports per week', 'Submitted vs marked completed');
  lineChart(c.body, {
    labels: labels, emptyText: 'No daily reports in this period.',
    series: [
      { name: 'Submitted', color: CHART_COLORS[0], values: reportsWeekly.slice(n) },
      { name: 'Completed', color: CHART_COLORS[5], values: anCount(data.reports.filter(function (r) { return r.completed_at; }), function (r) { return r.completed_at; }, weeks) }
    ]
  });
  prGrid.appendChild(c.card);

  c = anCard('Where work plans are in the pipeline', 'Plans dated within the period');
  donutChart(c.body, {
    data: anCountBy(data.plans.filter(function (p) { return inRange(planDay(p)); }), function (p) { return p.status || 'submitted'; }),
    centerLabel: 'plans', emptyText: 'No work plans in this period.'
  });
  prGrid.appendChild(c.card);

  c = anCard('Where daily reports are in the pipeline', 'Reports dated within the period');
  donutChart(c.body, {
    data: anCountBy(data.reports.filter(function (r) { return inRange(reportDay(r)); }), function (r) { return r.status || 'submitted'; }),
    centerLabel: 'reports', emptyText: 'No daily reports in this period.'
  });
  prGrid.appendChild(c.card);
  root.appendChild(prGrid);

  // ---- Completions ----
  root.appendChild(el('h3', { class: 'chart-section', text: 'Project completions' }));
  const compGrid = el('div', { class: 'chart-grid' });

  c = anCard('Completion notices per week', 'Flagged by the Admin secretary vs acknowledged by the Manager');
  columnChart(c.body, {
    labels: labels, emptyText: 'No completion notices in this period.',
    series: [
      { name: 'Flagged', color: CHART_COLORS[2], values: flaggedWeekly.slice(n) },
      { name: 'Acknowledged', color: CHART_COLORS[1], values: ackWeekly.slice(n) }
    ]
  });
  compGrid.appendChild(c.card);

  c = anCard('Completion notice status', 'All time');
  donutChart(c.body, {
    data: anCountBy(data.notices, function (x) { return x.status || 'pending_review'; }),
    centerLabel: 'notices', emptyText: 'No completion notices yet.'
  });
  const turnaround = data.notices
    .filter(function (x) { return x.created_at && x.reviewed_at; })
    .map(function (x) { return (new Date(x.reviewed_at) - new Date(x.created_at)) / 86400000; })
    .filter(function (d) { return !isNaN(d) && d >= 0; });
  if (turnaround.length) {
    const avg = anSum(turnaround) / turnaround.length;
    c.card.appendChild(el('p', { class: 'analytics-note', text: 'Average time for the Manager to acknowledge a notice: ' + (avg < 1 ? 'under a day' : avg.toFixed(1) + ' days') + ' (' + turnaround.length + ' acknowledged).' }));
  }
  compGrid.appendChild(c.card);
  root.appendChild(compGrid);

  // ---- Site supervisors ----
  root.appendChild(el('h3', { class: 'chart-section', text: 'Site supervisors' }));
  const supGrid = el('div', { class: 'chart-grid' });

  // Latest assignment per project decides who currently holds it.
  const latestAssignment = {};
  data.assignments.forEach(function (a) { latestAssignment[a.project_id] = a; });
  const projectsById = {};
  data.projects.forEach(function (p) { projectsById[p.id] = p; });

  const reportKeys = {};
  data.reports.forEach(function (r) { reportKeys[r.supervisor_id + '|' + r.project_id + '|' + reportDay(r)] = true; });

  const stats = supervisors.map(function (u) {
    const plans = data.plans.filter(function (p) { return p.supervisor_id === u.id; });
    const reports = data.reports.filter(function (r) { return r.supervisor_id === u.id; });
    const plansIn = plans.filter(function (p) { return inRange(planDay(p)); });
    const reportsIn = reports.filter(function (r) { return inRange(reportDay(r)); });

    // Of the plans whose day has passed, how many got an end-of-day report?
    const due = plansIn.filter(function (p) { return planDay(p) < today; });
    const followed = due.filter(function (p) { return reportKeys[u.id + '|' + p.project_id + '|' + planDay(p)]; }).length;

    let last = '';
    plans.forEach(function (p) { if (planDay(p) > last) last = planDay(p); });
    reports.forEach(function (r) { if (reportDay(r) > last) last = reportDay(r); });
    const daysSince = last ? Math.max(0, Math.floor((anParseKey(today) - anParseKey(last)) / 86400000)) : null;

    const held = Object.keys(latestAssignment).filter(function (pid) {
      const p = projectsById[pid];
      return latestAssignment[pid].supervisor_id === u.id && p && p.status === 'assigned';
    }).length;

    return {
      user: u, plansIn: plansIn.length, reportsIn: reportsIn.length, held: held, last: last, daysSince: daysSince,
      followThrough: due.length ? Math.round((followed / due.length) * 100) : null,
      weekly: anCount(plansIn.concat(reportsIn), function (row) { return row.plan_date || row.report_date; }, weeks)
    };
  }).sort(function (a, b) { return (b.plansIn + b.reportsIn) - (a.plansIn + a.reportsIn); });

  c = anCard('Plans and reports per supervisor', 'Submitted in the last ' + n + ' weeks', true);
  hBarChart(c.body, {
    labels: stats.map(function (s) { return s.user.name; }),
    series: [
      { name: 'Work plans', color: CHART_COLORS[0], values: stats.map(function (s) { return s.plansIn; }) },
      { name: 'Daily reports', color: CHART_COLORS[1], values: stats.map(function (s) { return s.reportsIn; }) }
    ],
    emptyText: supervisors.length ? 'No supervisor activity in this period.' : 'No site supervisors yet.'
  });
  supGrid.appendChild(c.card);

  c = anCard('Weekly activity by supervisor', 'Plans + reports combined' + (stats.length > 6 ? ' — top 6 shown' : ''), true);
  lineChart(c.body, {
    labels: labels, emptyText: 'No supervisor activity in this period.',
    series: stats.slice(0, 6).map(function (s, i) { return { name: s.user.name, color: CHART_COLORS[i], values: s.weekly }; }),
    showLegend: true
  });
  supGrid.appendChild(c.card);
  root.appendChild(supGrid);

  const tableCard = anCard('Supervisor activity summary', 'Follow-through = share of past work plans in the period that got an end-of-day report the same day', true);
  if (!stats.length) {
    tableCard.body.appendChild(el('p', { class: 'chart-empty', text: 'No site supervisors yet.' }));
  } else {
    const tbody = el('tbody', {});
    stats.forEach(function (s) {
      let state = 'inactive', label = 'no submissions yet';
      if (s.daysSince !== null) {
        if (s.daysSince <= 2) { state = 'active'; label = 'active'; }
        else if (s.daysSince <= 7) { state = 'pending'; label = 'quiet'; }
        else { state = 'inactive'; label = 'inactive'; }
      }
      tbody.appendChild(el('tr', {}, [
        el('td', { text: s.user.name }),
        el('td', { text: String(s.held) }),
        el('td', { text: String(s.plansIn) }),
        el('td', { text: String(s.reportsIn) }),
        el('td', { text: s.followThrough === null ? '—' : s.followThrough + '%' }),
        el('td', { text: s.last ? anParseKey(s.last).toLocaleDateString() : '—' }),
        el('td', {}, [el('span', { class: 'status ' + state, text: label })])
      ]));
    });
    tableCard.body.appendChild(el('table', {}, [
      el('thead', {}, [el('tr', {}, ['Supervisor', 'Projects held', 'Plans', 'Reports', 'Follow-through', 'Last submission', 'Status'].map(function (h) { return el('th', { text: h }); }))]),
      tbody
    ]));
    tableCard.card.appendChild(el('p', { class: 'analytics-note', text: 'Active = submitted within 2 days · Quiet = 3–7 days · Inactive = more than 7 days ago.' }));
  }
  root.appendChild(el('div', { class: 'chart-grid', style: 'margin-top:16px' }, [tableCard.card]));
}

function initAnalyticsTab() {
  const root = document.getElementById('analyticsRoot');
  const range = document.getElementById('anRange');
  const refreshBtn = document.getElementById('anRefresh');
  let cache = null, started = false;

  function draw() {
    if (!cache) return;
    try { anRender(root, cache, parseInt(range.value, 10)); }
    catch (err) { root.innerHTML = ''; root.appendChild(el('p', { class: 'error', text: 'Could not draw analytics: ' + err.message })); }
  }

  async function load() {
    started = true;
    root.innerHTML = '';
    root.appendChild(el('p', { class: 'empty', text: 'Loading analytics…' }));
    try {
      cache = await anFetch();
      draw();
    } catch (err) {
      root.innerHTML = '';
      root.appendChild(el('p', { class: 'error', text: err.message }));
    }
  }

  range.addEventListener('change', draw);
  refreshBtn.addEventListener('click', load);
  const nav = document.querySelector('.sidebar .nav-item[href="#analytics"]');
  if (nav) nav.addEventListener('click', function () { if (!started) load(); });
  if (location.hash === '#analytics') load();
}
