/**
 * Dynamic Builders — Page-bundle read/write endpoints
 * Split out from Auth.gs so each standalone page (user.html, daily-plan.html,
 * report.html, weekly-review.html, kpi.html) can load everything it needs in
 * one round trip instead of several — fewer requests means a faster first
 * paint. Apps Script merges every .gs file in the project into one shared
 * scope, so these call the same authorize_()/getById()/getRowsByForeignKey_()
 * helpers defined in Code.gs and Auth.gs with no extra wiring.
 */

/**
 * One user's full profile in a single call: the account row itself (password
 * fields stripped, same as every other USERS read), the projects they're
 * assigned to supervise, and a quick activity rollup (plan/report/ticket
 * counts + most recent submission date) so user.html never has to pull whole
 * tables just to answer "how active is this person?".
 *
 * Anyone may fetch their OWN profile this way (a Site Supervisor opening
 * their own user.html link); fetching someone ELSE's profile still requires
 * USERS_READ_ROLES, same as every other USERS lookup in this app.
 */
function getUserProfile(token, userId) {
  const session = authorize_(token, null);
  if (!userId) throw new Error('userId is required.');
  if (userId !== session.userId) authorize_(token, USERS_READ_ROLES);

  const raw = getById('USERS', userId);
  if (!raw) throw new Error('No such user.');
  const user = Object.assign({}, raw);
  delete user.password_hash;
  delete user.password_salt;
  delete user.verification_token;
  delete user.password_reset_token;

  const assignments = getRowsByForeignKey_(token, 'PROJECT_ASSIGNMENTS', 'supervisor_id', userId)
    .map(function (a) { return Object.assign({}, a, { project: getById('PROJECTS', a.project_id) }); });

  const plans = getRowsByForeignKey_(token, 'WORK_PLANS', 'supervisor_id', userId);
  const reports = getRowsByForeignKey_(token, 'DAILY_REPORTS', 'supervisor_id', userId);
  const tickets = getRowsByForeignKey_(token, 'TICKETS', 'raised_by', userId);
  const evaluations = getRowsByForeignKey_(token, 'SUPERVISOR_EVALUATIONS', 'user_id', userId);

  let lastActivity = '';
  plans.forEach(function (p) { if (p.plan_date && String(p.plan_date) > lastActivity) lastActivity = String(p.plan_date); });
  reports.forEach(function (r) { if (r.report_date && String(r.report_date) > lastActivity) lastActivity = String(r.report_date); });

  return {
    user: user,
    assignedProjects: assignments,
    stats: {
      plans: plans.length,
      reports: reports.length,
      ticketsRaised: tickets.length,
      lastActivity: lastActivity
    },
    evaluations: evaluations
  };
}

/**
 * One site's full picture in a single call, for site.html: the site row
 * itself (with the manager's name resolved), every project at the site,
 * the supervisors currently assigned to those projects, the productivity
 * targets set for it, and its weekly/monthly reviews — so the page can show
 * a real "detail" view instead of just {name, location, status}.
 */
function getSiteOverview(token, siteId) {
  authorize_(token, null);
  const site = getById('SITES', siteId);
  if (!site) throw new Error('No such site: ' + siteId);

  const manager = site.site_manager_id ? getById('USERS', site.site_manager_id) : null;
  const client = site.client_id ? getById('CLIENTS', site.client_id) : null;
  const projects = getRowsByForeignKey_(token, 'PROJECTS', 'site_id', siteId);
  const projectIds = {};
  projects.forEach(function (p) { projectIds[p.id] = true; });

  const allAssignments = listTable(token, 'PROJECT_ASSIGNMENTS');
  const assignments = allAssignments.filter(function (a) { return projectIds[a.project_id]; });

  return {
    site: site,
    manager: manager ? { id: manager.id, name: manager.name, role: manager.role, email: manager.email } : null,
    client: client,
    projects: projects,
    assignments: assignments,
    targets: getRowsByForeignKey_(token, 'PRODUCTIVITY_TARGETS', 'site_id', siteId),
    weeklyReviews: getRowsByForeignKey_(token, 'WEEKLY_REVIEWS', 'site_id', siteId),
    monthlyReviews: getRowsByForeignKey_(token, 'MONTHLY_REVIEWS', 'site_id', siteId)
  };
}

/**
 * One monthly review plus the site it's for and every supervisor evaluation
 * recorded against it, for monthly-review.html.
 */
function getMonthlyReviewDetail(token, reviewId) {
  authorize_(token, null);
  const review = getById('MONTHLY_REVIEWS', reviewId);
  if (!review) throw new Error('No such monthly review: ' + reviewId);

  const site = review.site_id ? getById('SITES', review.site_id) : null;
  const evaluations = getRowsByForeignKey_(token, 'SUPERVISOR_EVALUATIONS', 'monthly_review_id', reviewId)
    .map(function (ev) {
      const user = getById('USERS', ev.user_id);
      return Object.assign({}, ev, { supervisorName: user ? user.name : ev.user_id });
    });

  return { review: review, site: site, evaluations: evaluations };
}

/**
 * Save a screenshot attached to a support ticket. Mirrors
 * uploadDailyReportPhoto()'s shape exactly (resize/compress happens in the
 * browser first) but files land in their own top-level Drive folder — a
 * ticket isn't tied to one project, so there's no per-project subfolder to
 * nest it under. Any logged-in role may attach a screenshot to their own
 * ticket; raiseTicket() is what actually links it to the ticket row.
 */
function uploadTicketScreenshot(token, payload) {
  authorize_(token, null);
  if (!payload.dataBase64) throw new Error('No screenshot data received.');

  const bytes = Utilities.base64Decode(payload.dataBase64);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Screenshot is too large (max 8MB after compression).');

  const blob = Utilities.newBlob(bytes, payload.mimeType || 'image/jpeg', payload.filename || 'screenshot.jpg');
  const uploaded = uploadFile('TICKETS', blob, null);

  return { photo_path: uploaded.directUrl, driveUrl: uploaded.url, fileId: uploaded.id };
}
