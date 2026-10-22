// analytics.js — the Analytics tab shared by the IT admin, Manager and
// Admin secretary dashboards. Needs config.js and charts.js loaded first,
// plus this markup: nav link href="#analytics", a panel #analytics
// containing #anRange (select), #anRefresh (button) and #analyticsRoot
// (div). Call initAnalyticsTab(session.role) after setupMobileSidebar() —
// IT_ADMIN gets an extra "Users & support" section on top of the shared
// project/report/supervisor analytics; MANAGER and ADMIN_SECRETARY see the
// shared sections only.
//
// Status colors (good/warn/danger) are reserved for state — compliant vs
// not, clean vs flagged — and never reused as a categorical series color.

const AN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AN_GOOD = '#12875e', AN_WARN = '#9a6b06', AN_DANGER = '#c22c3b';
const AN_STATUS_COLORS = {
  pending_approval: AN_WARN, submitted: CHART_COLORS[0], pending_review: AN_WARN,
  approved: AN_GOOD, reviewed: CHART_COLORS[0], assigned: CHART_COLORS[6], completed: AN_GOOD
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
function anAvg(arr) { return arr.length ? anSum(arr) / arr.length : null; }
function anNice(status) { return String(status || '').replace(/_/g, ' '); }
function anColor(status, i) { return AN_STATUS_COLORS[status] || CHART_COLORS[i % CHART_COLORS.length]; }
function anNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function anPct(part, whole) { return whole ? Math.round((part / whole) * 100) : null; }

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

async function anFetch(role) {
  const names = ['PROJECTS', 'WORK_PLANS', 'DAILY_REPORTS', 'COMPLETION_NOTICES', 'USERS', 'PROJECT_ASSIGNMENTS'];
  if (role === 'IT_ADMIN') names.push('TICKETS');
  const calls = names.map(function (t) { return apiCall('list', { table: t }); });
  // Audit log uses its own IT-Admin-only endpoint (same one the Audit log
  // tab uses), not the generic list action.
  if (role === 'IT_ADMIN') calls.push(apiCall('getAuditLog', {}));
  const results = await Promise.all(calls);
  const data = {
    projects: results[0], plans: results[1], reports: results[2],
    notices: results[3], users: results[4], assignments: results[5]
  };
  if (role === 'IT_ADMIN') { data.tickets = results[6]; data.auditLog = results[7]; }
  return data;
}

// ---- day-granularity helpers, used only by the "System usage" section
// below — everything else in this file buckets by week, but logins/
// actions are meaningful at daily resolution (that's the actual question
// "how is the system being used day to day").
function anBuildDays(n) {
  const out = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(d);
    day.setDate(day.getDate() - i);
    out.push(anKey(day));
  }
  return out;
}
function anDayLabel(dayKey) {
  const d = anParseKey(dayKey);
  return d.getDate() + ' ' + AN_MONTHS[d.getMonth()];
}
function anCountDaily(rows, dateFn, days) {
  const idx = {};
  days.forEach(function (d, i) { idx[d] = i; });
  const out = days.map(function () { return 0; });
  rows.forEach(function (r) {
    const key = anDayKey(dateFn(r));
    if (key && idx[key] !== undefined) out[idx[key]]++;
  });
  return out;
}

const AN_ROLE_LABELS = { IT_ADMIN: 'IT admin', MANAGER: 'Manager', ADMIN_SECRETARY: 'Admin secretary', SITE_SUPERVISOR: 'Site supervisor' };

function anRender(root, data, n, role) {
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

  // ---- Overview ----
  root.appendChild(el('h3', { class: 'chart-section', text: 'Overview' }));
  const statGrid = el('div', { class: 'stat-grid' });
  const sp = split(projectsWeekly), sl = split(plansWeekly), sr = split(reportsWeekly), sf = split(flaggedWeekly);
  statGrid.appendChild(anStat('Projects recorded', sp.cur, anDelta(sp.cur, sp.prev, n)));
  statGrid.appendChild(anStat('Work plans submitted', sl.cur, anDelta(sl.cur, sl.prev, n)));
  statGrid.appendChild(anStat('Daily reports submitted', sr.cur, anDelta(sr.cur, sr.prev, n)));
  statGrid.appendChild(anStat('Completions flagged', sf.cur, anDelta(sf.cur, sf.prev, n)));
  statGrid.appendChild(anStat('Active supervisors', activeSupervisors + ' / ' + supervisors.length, { text: 'submitted a plan or report in the period', cls: '' }));
  root.appendChild(statGrid);

  const ovGrid = el('div', { class: 'chart-grid' });
  let c = anCard('Projects by status', 'All projects, all time');
  donutChart(c.body, { data: anCountBy(data.projects, function (p) { return p.status; }), centerLabel: 'projects', emptyText: 'No projects recorded yet.' });
  ovGrid.appendChild(c.card);

  c = anCard('Work plans & reports per week', 'Submitted in the last ' + n + ' weeks');
  columnChart(c.body, {
    labels: labels, emptyText: 'No activity in this period.',
    series: [
      { name: 'Work plans', color: CHART_COLORS[0], values: plansWeekly.slice(n) },
      { name: 'Daily reports', color: CHART_COLORS[1], values: reportsWeekly.slice(n) }
    ]
  });
  ovGrid.appendChild(c.card);
  root.appendChild(ovGrid);

  // ---- Project completions ----
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

  // ====================================================================
  // Site supervisor KPIs — the heart of this tab.
  // ====================================================================
  root.appendChild(el('h3', { class: 'chart-section', text: 'Site supervisor KPIs' }));
  const supGrid = el('div', { class: 'chart-grid' });

  const latestAssignment = {};
  data.assignments.forEach(function (a) { latestAssignment[a.project_id] = a; });
  const projectsById = {};
  data.projects.forEach(function (p) { projectsById[p.id] = p; });

  const reportKeys = {};
  data.reports.forEach(function (r) { reportKeys[r.supervisor_id + '|' + r.project_id + '|' + reportDay(r)] = true; });

  const reportsInRange = data.reports.filter(function (r) { return inRange(reportDay(r)); });

  // Sitewide compliance snapshot, drawn from reports dated within the period.
  const toolboxYes = reportsInRange.filter(function (r) { return r.toolbox_talk === true || r.toolbox_talk === 'true' || r.toolbox_talk === 'TRUE'; }).length;
  const ppeSet = reportsInRange.filter(function (r) { return r.ppe_compliance; });
  const ppeGood = ppeSet.filter(function (r) { return r.ppe_compliance === 'good'; }).length;
  const qualitySet = reportsInRange.filter(function (r) { return r.quality_inspection; });
  const qualityPassed = qualitySet.filter(function (r) { return r.quality_inspection === 'passed'; }).length;
  const withProblems = reportsInRange.filter(function (r) { return r.problems_delays && String(r.problems_delays).trim(); }).length;

  c = anCard('Toolbox talk completed', 'Share of reports in the period');
  donutChart(c.body, {
    data: [
      { label: 'Completed', value: toolboxYes, color: AN_GOOD },
      { label: 'Missed', value: reportsInRange.length - toolboxYes, color: AN_DANGER }
    ],
    centerLabel: 'reports', emptyText: 'No daily reports in this period.'
  });
  supGrid.appendChild(c.card);

  c = anCard('PPE compliance', 'Of reports where PPE was recorded');
  donutChart(c.body, {
    data: [
      { label: 'Good', value: ppeGood, color: AN_GOOD },
      { label: 'Issue', value: ppeSet.length - ppeGood, color: AN_DANGER }
    ],
    centerLabel: 'reports', emptyText: 'PPE compliance was not recorded in this period.'
  });
  supGrid.appendChild(c.card);

  c = anCard('Quality inspection', 'Of reports where an inspection was recorded');
  donutChart(c.body, {
    data: [
      { label: 'Passed', value: qualityPassed, color: AN_GOOD },
      { label: 'Action needed', value: qualitySet.length - qualityPassed, color: AN_DANGER }
    ],
    centerLabel: 'reports', emptyText: 'No quality inspections recorded in this period.'
  });
  supGrid.appendChild(c.card);

  c = anCard('Reports with problems / delays', 'Clean vs flagged, per week');
  columnChart(c.body, {
    labels: labels, emptyText: 'No daily reports in this period.',
    series: [
      { name: 'Clean', color: AN_GOOD, values: anCount(reportsInRange.filter(function (r) { return !(r.problems_delays && String(r.problems_delays).trim()); }), reportDay, weeks) },
      { name: 'Problems/delays', color: AN_DANGER, values: anCount(reportsInRange.filter(function (r) { return r.problems_delays && String(r.problems_delays).trim(); }), reportDay, weeks) }
    ]
  });
  if (reportsInRange.length) c.card.appendChild(el('p', { class: 'analytics-note', text: withProblems + ' of ' + reportsInRange.length + ' reports in this period logged a problem or delay (' + anPct(withProblems, reportsInRange.length) + '%).' }));
  supGrid.appendChild(c.card);
  root.appendChild(supGrid);

  // Per-supervisor rollup — reports, plans, workforce, compliance, follow-through.
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

    const workforceVals = reportsIn.map(function (r) { return anNum(r.total_workforce); }).filter(function (v) { return v > 0; });
    const avgWorkforce = anAvg(workforceVals);
    const uToolboxSet = reportsIn, uToolboxYes = uToolboxSet.filter(function (r) { return r.toolbox_talk === true || r.toolbox_talk === 'true'; }).length;
    const uPpeSet = reportsIn.filter(function (r) { return r.ppe_compliance; }), uPpeGood = uPpeSet.filter(function (r) { return r.ppe_compliance === 'good'; }).length;
    const uQualitySet = reportsIn.filter(function (r) { return r.quality_inspection; }), uQualityGood = uQualitySet.filter(function (r) { return r.quality_inspection === 'passed'; }).length;
    const uProblems = reportsIn.filter(function (r) { return r.problems_delays && String(r.problems_delays).trim(); }).length;

    return {
      user: u, plansIn: plansIn.length, reportsIn: reportsIn.length, held: held, last: last, daysSince: daysSince,
      followThrough: due.length ? Math.round((followed / due.length) * 100) : null,
      avgWorkforce: avgWorkforce,
      toolboxPct: uToolboxSet.length ? anPct(uToolboxYes, uToolboxSet.length) : null,
      ppePct: uPpeSet.length ? anPct(uPpeGood, uPpeSet.length) : null,
      qualityPct: uQualitySet.length ? anPct(uQualityGood, uQualitySet.length) : null,
      problemsPct: reportsIn.length ? anPct(uProblems, reportsIn.length) : null,
      weekly: anCount(plansIn.concat(reportsIn), function (row) { return row.plan_date || row.report_date; }, weeks)
    };
  }).sort(function (a, b) { return (b.plansIn + b.reportsIn) - (a.plansIn + a.reportsIn); });

  const supGrid2 = el('div', { class: 'chart-grid' });
  c = anCard('Plans and reports per supervisor', 'Submitted in the last ' + n + ' weeks', true);
  hBarChart(c.body, {
    labels: stats.map(function (s) { return s.user.name; }),
    series: [
      { name: 'Work plans', color: CHART_COLORS[0], values: stats.map(function (s) { return s.plansIn; }) },
      { name: 'Daily reports', color: CHART_COLORS[1], values: stats.map(function (s) { return s.reportsIn; }) }
    ],
    emptyText: supervisors.length ? 'No supervisor activity in this period.' : 'No site supervisors yet.'
  });
  supGrid2.appendChild(c.card);

  c = anCard('Weekly activity by supervisor', 'Plans + reports combined' + (stats.length > 6 ? ' — top 6 shown' : ''), true);
  lineChart(c.body, {
    labels: labels, emptyText: 'No supervisor activity in this period.',
    series: stats.slice(0, 6).map(function (s, i) { return { name: s.user.name, color: CHART_COLORS[i], values: s.weekly }; }),
    showLegend: true
  });
  supGrid2.appendChild(c.card);
  root.appendChild(supGrid2);

  const tableCard = anCard('Supervisor KPI summary', 'Follow-through = share of past work plans in the period that got an end-of-day report the same day', true);
  if (!stats.length) {
    tableCard.body.appendChild(el('p', { class: 'chart-empty', text: 'No site supervisors yet.' }));
  } else {
    const pctCell = function (pct, invert) {
      if (pct === null) return el('td', { text: '—' });
      const good = invert ? pct <= 10 : pct >= 80;
      const bad = invert ? pct >= 30 : pct < 50;
      return el('td', {}, [el('span', { class: 'status ' + (good ? 'active' : bad ? 'suspended' : 'pending'), text: pct + '%' })]);
    };
    const tbody = el('tbody', {});
    stats.forEach(function (s) {
      let state = 'inactive', label = 'no submissions yet';
      if (s.daysSince !== null) {
        if (s.daysSince <= 2) { state = 'active'; label = 'active'; }
        else if (s.daysSince <= 7) { state = 'pending'; label = 'quiet'; }
        else { state = 'inactive'; label = 'inactive'; }
      }
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [kpiLink(s.user.id, s.user.name)]),
        el('td', { text: String(s.held) }),
        el('td', { text: String(s.plansIn) }),
        el('td', { text: String(s.reportsIn) }),
        el('td', { text: s.avgWorkforce === null ? '—' : s.avgWorkforce.toFixed(1) }),
        pctCell(s.toolboxPct),
        pctCell(s.ppePct),
        pctCell(s.qualityPct),
        pctCell(s.problemsPct, true),
        el('td', { text: s.followThrough === null ? '—' : s.followThrough + '%' }),
        el('td', { text: s.last ? anParseKey(s.last).toLocaleDateString() : '—' }),
        el('td', {}, [el('span', { class: 'status ' + state, text: label })])
      ]));
    });
    tableCard.body.appendChild(el('div', { class: 'table-scroll' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, ['Supervisor', 'Projects held', 'Plans', 'Reports', 'Avg workforce', 'Toolbox talk', 'PPE', 'Quality', 'Problems', 'Follow-through', 'Last submission', 'Status'].map(function (h) { return el('th', { text: h }); }))]),
      tbody
    ])]));
    tableCard.card.appendChild(el('p', { class: 'analytics-note', text: 'Active = submitted within 2 days · Quiet = 3–7 days · Inactive = more than 7 days ago. Toolbox talk/PPE/Quality are the share of that supervisor\'s reports in the period meeting the standard; Problems is the share flagging a delay or issue (lower is better).' }));
  }
  root.appendChild(el('div', { class: 'chart-grid', style: 'margin-top:16px' }, [tableCard.card]));

  // ====================================================================
  // Users & support — IT admin only.
  // ====================================================================
  if (role === 'IT_ADMIN') anRenderUsers(root, data, labels, weeks, n, today);
}

function anRenderUsage(root, data, today) {
  const log = data.auditLog || [];
  const usersById = {};
  (data.users || []).forEach(function (u) { usersById[u.id] = u; });

  const days = anBuildDays(14);
  const dayLabels = days.map(anDayLabel);
  const todayKey = days[days.length - 1];

  const logins = log.filter(function (r) { return r.action === 'Login'; });
  const activeTodayIds = {}, activeRangeIds = {};
  log.forEach(function (r) {
    const key = anDayKey(r.created_at);
    if (!r.user_id) return;
    if (key === todayKey) activeTodayIds[r.user_id] = true;
    if (key && key >= days[0]) activeRangeIds[r.user_id] = true;
  });
  const loginsToday = anCountDaily(logins, function (r) { return r.created_at; }, [todayKey])[0];
  const actionsInRange = anCountDaily(log, function (r) { return r.created_at; }, days);

  root.appendChild(el('h3', { class: 'chart-section', text: 'System usage' }));
  root.appendChild(el('p', { class: 'muted', style: 'margin-top:-6px', text: 'Built from the Audit Log — every login and significant action, who did it and when. The last 14 days, always (independent of the range picker above).' }));
  const statGrid = el('div', { class: 'stat-grid' });
  statGrid.appendChild(anStat('Active today', Object.keys(activeTodayIds).length));
  statGrid.appendChild(anStat('Logins today', loginsToday));
  statGrid.appendChild(anStat('Active in last 14 days', Object.keys(activeRangeIds).length));
  statGrid.appendChild(anStat('Actions in last 14 days', anSum(actionsInRange)));
  root.appendChild(statGrid);

  const usageGrid = el('div', { class: 'chart-grid' });
  let c = anCard('Activity per day', 'Logins and actions, last 14 days', true);
  lineChart(c.body, {
    labels: dayLabels, emptyText: 'No activity recorded yet.',
    series: [
      { name: 'Logins', color: CHART_COLORS[0], values: anCountDaily(logins, function (r) { return r.created_at; }, days) },
      { name: 'All actions', color: CHART_COLORS[3], values: actionsInRange }
    ],
    showLegend: true
  });
  usageGrid.appendChild(c.card);
  root.appendChild(usageGrid);

  const byUser = {};
  log.forEach(function (r) {
    if (!r.user_id) return;
    byUser[r.user_id] = byUser[r.user_id] || { name: r.user_name || (usersById[r.user_id] && usersById[r.user_id].name) || 'Unknown', count: 0, last: '' };
    byUser[r.user_id].count++;
    if (!byUser[r.user_id].last || r.created_at > byUser[r.user_id].last) byUser[r.user_id].last = r.created_at;
  });
  const topUsers = Object.values(byUser).sort(function (a, b) { return b.count - a.count; }).slice(0, 8);
  c = anCard('Most active users', 'By number of logged actions, all time', true);
  if (topUsers.length) {
    hBarChart(c.body, {
      labels: topUsers.map(function (u) { return u.name; }),
      series: [{ name: 'Actions', color: CHART_COLORS[1], values: topUsers.map(function (u) { return u.count; }) }]
    });
  } else {
    chartEmpty(c.body, 'No activity recorded yet.');
  }
  root.appendChild(el('div', { class: 'chart-grid' }, [c.card]));
}

function anRenderUsers(root, data, labels, weeks, n, today) {
  const users = data.users || [];
  const tickets = data.tickets || [];
  const activeUsers = users.filter(function (u) { return u.status === 'active'; }).length;
  const suspendedUsers = users.filter(function (u) { return u.status === 'suspended'; }).length;

  const usersWeekly = anCount(users, function (u) { return u.created_at; }, anBuildWeeks(n * 2));
  const uSplit = { prev: anSum(usersWeekly.slice(0, n)), cur: anSum(usersWeekly.slice(n)) };
  const openTickets = tickets.filter(function (t) { return t.status === 'open'; }).length;
  const resolvedInRange = tickets.filter(function (t) { return t.resolved_at && anWeekOf(anDayKey(t.resolved_at)) >= weeks[0]; }).length;

  anRenderUsage(root, data, today);

  root.appendChild(el('h3', { class: 'chart-section', text: 'Users & support' }));
  const statGrid = el('div', { class: 'stat-grid' });
  statGrid.appendChild(anStat('Total users', users.length));
  statGrid.appendChild(anStat('Active users', activeUsers));
  statGrid.appendChild(anStat('Suspended users', suspendedUsers));
  statGrid.appendChild(anStat('New accounts', uSplit.cur, anDelta(uSplit.cur, uSplit.prev, n)));
  statGrid.appendChild(anStat('Open tickets', openTickets));
  root.appendChild(statGrid);

  const uGrid = el('div', { class: 'chart-grid' });
  let c = anCard('Users by role', 'All accounts');
  const roleCounts = {};
  users.forEach(function (u) { roleCounts[u.role] = (roleCounts[u.role] || 0) + 1; });
  donutChart(c.body, {
    data: Object.keys(roleCounts).map(function (r, i) { return { label: AN_ROLE_LABELS[r] || anNice(r), value: roleCounts[r], color: CHART_COLORS[i % CHART_COLORS.length] }; }),
    centerLabel: 'users', emptyText: 'No user accounts yet.'
  });
  uGrid.appendChild(c.card);

  c = anCard('Account status', 'All accounts');
  donutChart(c.body, {
    data: [
      { label: 'Active', value: activeUsers, color: AN_GOOD },
      { label: 'Suspended', value: suspendedUsers, color: AN_DANGER }
    ],
    centerLabel: 'users', emptyText: 'No user accounts yet.'
  });
  uGrid.appendChild(c.card);

  c = anCard('New accounts per week', 'Created in the last ' + n + ' weeks');
  columnChart(c.body, {
    labels: labels, emptyText: 'No new accounts in this period.',
    series: [{ name: 'Accounts created', color: CHART_COLORS[3], values: usersWeekly.slice(n) }]
  });
  uGrid.appendChild(c.card);
  root.appendChild(uGrid);

  // ---- Support tickets ----
  root.appendChild(el('h3', { class: 'chart-section', text: 'Support tickets' }));
  const tGrid = el('div', { class: 'chart-grid' });

  c = anCard('Tickets by status', 'All time');
  donutChart(c.body, {
    data: anCountBy(tickets, function (t) { return t.status; }),
    centerLabel: 'tickets', emptyText: 'No support tickets raised yet.'
  });
  tGrid.appendChild(c.card);

  c = anCard('Tickets by category', 'All time');
  donutChart(c.body, {
    data: anCountBy(tickets, function (t) { return t.category || 'other'; }),
    centerLabel: 'tickets', emptyText: 'No support tickets raised yet.'
  });
  tGrid.appendChild(c.card);

  c = anCard('Raised vs resolved per week', 'In the last ' + n + ' weeks');
  columnChart(c.body, {
    labels: labels, emptyText: 'No ticket activity in this period.',
    series: [
      { name: 'Raised', color: CHART_COLORS[0], values: anCount(tickets, function (t) { return t.created_at; }, weeks) },
      { name: 'Resolved', color: AN_GOOD, values: anCount(tickets.filter(function (t) { return t.resolved_at; }), function (t) { return t.resolved_at; }, weeks) }
    ]
  });
  const resolutionTimes = tickets
    .filter(function (t) { return t.created_at && t.resolved_at; })
    .map(function (t) { return (new Date(t.resolved_at) - new Date(t.created_at)) / 86400000; })
    .filter(function (d) { return !isNaN(d) && d >= 0; });
  if (resolutionTimes.length) {
    const avg = anSum(resolutionTimes) / resolutionTimes.length;
    c.card.appendChild(el('p', { class: 'analytics-note', text: 'Average time to resolve a ticket: ' + (avg < 1 ? 'under a day' : avg.toFixed(1) + ' days') + ' (' + resolutionTimes.length + ' resolved). ' + resolvedInRange + ' resolved in this period.' }));
  }
  tGrid.appendChild(c.card);
  root.appendChild(tGrid);
}

function initAnalyticsTab(role) {
  const root = document.getElementById('analyticsRoot');
  const range = document.getElementById('anRange');
  const refreshBtn = document.getElementById('anRefresh');
  let cache = null, started = false;

  function draw() {
    if (!cache) return;
    try { anRender(root, cache, parseInt(range.value, 10), role); }
    catch (err) { root.innerHTML = ''; root.appendChild(el('p', { class: 'error', text: 'Could not draw analytics: ' + err.message })); }
  }

  async function load() {
    started = true;
    root.innerHTML = '';
    root.appendChild(el('p', { class: 'empty', text: 'Loading analytics…' }));
    try {
      cache = await anFetch(role);
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
