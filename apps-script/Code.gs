/**
 * Dynamic Builders — Site Reporting Database
 * Google Apps Script backend: creates all tables (sheets) and relationships
 * in the target Spreadsheet, and prepares Drive folders for file/image uploads.
 *
 * SETUP:
 * 1. Open the target spreadsheet: Extensions > Apps Script.
 * 2. Paste this whole file in as Code.gs.
 * 3. Select the `setupDatabase` function and click Run (Apps Script will
 *    ask you to authorize access to the spreadsheet and Drive the first time).
 * 4. Re-running setupDatabase is safe — it never wipes existing data, it
 *    only creates missing sheets/headers and repairs formatting/validation.
 */

// ---------- CONFIG ----------

const SPREADSHEET_ID = '1bKCmrYy-KPQd7kUFkei6i0kyvDciNrMl6tDVwU8vHeA';
const ROOT_DRIVE_FOLDER_ID = '1wWHKVwCzUPlLGVogy_UEtxjSGfmoFdo1';

// Where the static frontend (index.html and friends) is actually hosted —
// used only to build clickable links inside the verification/approval
// emails sent from Auth.gs (e.g. "https://<this>/verify.html?token=...").
// No trailing slash. Leave empty and those emails still send, just with a
// plain-text instruction ("open the app and go to...") instead of a link.
const FRONTEND_BASE_URL = 'https://jangafrika.github.io/db';

// Tables that have a file/image column, and which Drive subfolder their
// uploaded files should live in.
const FILE_COLUMNS = {
  EXPENSES: { column: 'receipt_path', folder: 'Expense Receipts' },
  SAFETY_INCIDENTS: { column: 'photo_path', folder: 'Safety Photos' },
  DAILY_REPORT_PHOTOS: { column: 'photo_path', folder: 'Daily Report Photos' },
  TICKETS: { column: 'screenshot_path', folder: 'Ticket Screenshots' }
};

// ---------- SCHEMA ----------
// Each table: ordered array of column names. Column 1 is always the primary
// key "id" (a generated UUID, not a Sheets row number, so ids stay stable
// even if rows are sorted or filtered later).
//
// DAILY_REPORTS / WORK_PLANS and their child tables were redesigned to
// match Dynamic Builders' real paper "Daily Site Work Plan" and "Daily Site
// Report" forms (and the WhatsApp-style reports supervisors actually send)
// so the fields captured here are the fields the business runs on, not a
// generic placeholder shape. USERS is untouched.

const SCHEMA = {
  // Enriched beyond the original {id,name,location,status} so a site's own
  // page has real detail to show: a full address, who the client is, what
  // kind of site it is, when work started, who manages it day to day, GPS
  // coordinates for a map link, and free-form notes. New columns are
  // appended safely by reconcileColumns_ below — existing rows keep their
  // id/name/location/status values exactly as they were.
  // edit_count tracks how many times a Manager/Admin Secretary has edited
  // this site via updateSite() — capped at 3 (see MAX_SELF_SERVICE_EDITS_ in
  // Auth.gs). IT Admin edits never touch this counter, so IT Admin stays
  // unrestricted no matter how many times Manager/Admin Secretary have
  // already used up their own edits.
  // client_id links to the new CLIENTS table below (a real record with its
  // own contact details) and is what the dashboards use going forward;
  // client_name is kept only so older rows recorded before CLIENTS existed
  // still show something until someone edits them onto a real client record.
  SITES: ['id', 'name', 'location', 'status', 'address', 'client_name', 'site_type', 'gps_coords', 'start_date', 'site_manager_id', 'notes', 'edit_count', 'client_id'],
  // Matches the live sheet exactly: profile fields (title, reports_to,
  // address, emergency_contact) already exist between phone and status —
  // SCHEMA just needs to know they're there so every column lines up.
  USERS: ['id', 'name', 'email', 'password_hash', 'password_salt', 'role', 'phone', 'title', 'reports_to', 'address', 'emergency_contact', 'status', 'email_verified', 'verification_token', 'verification_token_expires', 'password_reset_token', 'password_reset_expires', 'requested_role', 'approved_by', 'approved_at', 'created_by', 'created_at'],
  USER_SITES: ['id', 'user_id', 'site_id', 'is_primary'],
  // progress_percent is a manually-set 0-100 figure (Manager/Admin Secretary
  // update it as work proceeds) so project lists and project.html can show
  // a real progress bar instead of just a status word.
  // edit_count: same 3-edit cap for Manager/Admin Secretary as SITES.edit_count above.
  PROJECTS: ['id', 'site_id', 'name', 'description', 'planned_start', 'planned_end', 'budget', 'status', 'created_by', 'approved_by', 'approved_at', 'progress_percent', 'edit_count'],
  PROJECT_ASSIGNMENTS: ['id', 'project_id', 'supervisor_id', 'assigned_by', 'assigned_at', 'status'],
  TICKETS: ['id', 'raised_by', 'category', 'description', 'status', 'assigned_to', 'resolution_notes', 'created_at', 'resolved_at', 'screenshot_path'],
  COMPLETION_NOTICES: ['id', 'project_id', 'flagged_by', 'notes', 'status', 'created_at', 'reviewed_at'],

  // ---- Daily Work Plan ("Tomorrow Plan") — submitted ahead of the work day.
  // Header fields mirror the PDF templates' common header (project, date,
  // site, supervisor, weather) plus the manpower/safety summary block.
  WORK_PLANS: ['id', 'site_id', 'project_id', 'supervisor_id', 'plan_date', 'weather',
    'skilled_workers', 'labourers', 'subcontractors', 'total_workforce',
    'toolbox_talk', 'ppe_check', 'site_notes', 'target', 'status', 'created_at'],
  // One row per planned activity, e.g. "Plastering and finishing... - 2 masons".
  WORK_PLAN_TASKS: ['id', 'work_plan_id', 'seq', 'activity', 'work_area', 'responsible_team', 'manpower', 'materials_equipment', 'daily_target', 'status'],

  // ---- Site Daily Report — submitted after the work day.
  DAILY_REPORTS: ['id', 'site_id', 'project_id', 'supervisor_id', 'report_date', 'report_no', 'working_hours', 'weather',
    'skilled_workers', 'labourers', 'subcontractors', 'total_workforce',
    'toolbox_talk', 'ppe_compliance', 'quality_inspection',
    'problems_delays', 'action_taken',
    'tomorrow_plan', 'general_remarks',
    'reported_by_name', 'reported_by_role', 'status', 'created_at'],
  // "1. Tasks Today" / "2. Work Done Today", one row per activity.
  DAILY_REPORT_TASKS: ['id', 'daily_report_id', 'seq', 'activity', 'work_area', 'planned_target', 'actual_progress', 'status_remarks'],
  // "4. Photo Evidence" — caption + what/where the photo shows.
  DAILY_REPORT_PHOTOS: ['id', 'daily_report_id', 'photo_path', 'caption', 'location_activity'],

  EXPENSES: ['id', 'daily_report_id', 'category', 'amount', 'receipt_path', 'approved_by', 'status'],
  MATERIALS: ['id', 'name', 'unit'],
  // "3. Materials" — e.g. "Cement used: 3 bags, Cement balance: 51 bags".
  MATERIAL_USAGE: ['id', 'daily_report_id', 'material_id', 'opening_stock', 'received_qty', 'used_qty', 'balance_qty'],
  EQUIPMENT: ['id', 'name', 'type'],
  // "4. Equipment" — e.g. "Two wheelbarrow, two spade, six Iron profile."
  EQUIPMENT_USAGE: ['id', 'daily_report_id', 'equipment_id', 'quantity', 'notes'],
  SAFETY_INCIDENTS: ['id', 'daily_report_id', 'description', 'severity', 'corrective_action', 'resolved', 'photo_path'],
  PRODUCTIVITY_TARGETS: ['id', 'site_id', 'trade', 'unit', 'daily_target'],
  PRODUCTIVITY_ACTUALS: ['id', 'daily_report_id', 'target_id', 'actual_output', 'shortfall_reason'],
  OPEN_ISSUES: ['id', 'title', 'owner_id', 'raised_date', 'deadline', 'status', 'source_report_id'],
  WEEKLY_REVIEWS: ['id', 'site_id', 'week_start', 'week_end', 'prepared_by', 'summary'],
  MONTHLY_REVIEWS: ['id', 'site_id', 'month', 'year', 'summary'],
  SUPERVISOR_EVALUATIONS: ['id', 'user_id', 'monthly_review_id', 'score', 'notes'],
  // A running record of logins and significant actions (user/project
  // management, approvals, tickets, etc.) for IT Admin's Audit Log tab.
  // Written only via logActivity_() in Auth.gs, never through the generic
  // insert action.
  AUDIT_LOG: ['id', 'user_id', 'user_name', 'role', 'action', 'details', 'created_at'],
  // Clients and consultants a site is built for — a real record with its own
  // contacts, instead of the free-text SITES.client_name it replaces. type is
  // 'client' or 'consultant'. Linked from SITES.client_id, shown on client.html.
  CLIENTS: ['id', 'name', 'type', 'contact_name', 'phone', 'email', 'address', 'notes', 'created_by', 'created_at']
};

// Foreign keys: table -> { column: referencedTable }. Sheets has no real FK
// constraints, so this drives (a) live dropdown validation at data-entry
// time and (b) documents the relationships for anything else built on top.
const RELATIONSHIPS = {
  USERS: { reports_to: 'USERS', approved_by: 'USERS' },
  SITES: { site_manager_id: 'USERS', client_id: 'CLIENTS' },
  USER_SITES: { user_id: 'USERS', site_id: 'SITES' },
  PROJECTS: { site_id: 'SITES', created_by: 'USERS', approved_by: 'USERS' },
  PROJECT_ASSIGNMENTS: { project_id: 'PROJECTS', supervisor_id: 'USERS', assigned_by: 'USERS' },
  TICKETS: { raised_by: 'USERS', assigned_to: 'USERS' },
  COMPLETION_NOTICES: { project_id: 'PROJECTS', flagged_by: 'USERS' },
  WORK_PLANS: { site_id: 'SITES', project_id: 'PROJECTS', supervisor_id: 'USERS' },
  WORK_PLAN_TASKS: { work_plan_id: 'WORK_PLANS' },
  DAILY_REPORTS: { site_id: 'SITES', project_id: 'PROJECTS', supervisor_id: 'USERS' },
  DAILY_REPORT_TASKS: { daily_report_id: 'DAILY_REPORTS' },
  DAILY_REPORT_PHOTOS: { daily_report_id: 'DAILY_REPORTS' },
  EXPENSES: { daily_report_id: 'DAILY_REPORTS', approved_by: 'USERS' },
  MATERIAL_USAGE: { daily_report_id: 'DAILY_REPORTS', material_id: 'MATERIALS' },
  EQUIPMENT_USAGE: { daily_report_id: 'DAILY_REPORTS', equipment_id: 'EQUIPMENT' },
  SAFETY_INCIDENTS: { daily_report_id: 'DAILY_REPORTS' },
  PRODUCTIVITY_TARGETS: { site_id: 'SITES' },
  PRODUCTIVITY_ACTUALS: { daily_report_id: 'DAILY_REPORTS', target_id: 'PRODUCTIVITY_TARGETS' },
  OPEN_ISSUES: { owner_id: 'USERS', source_report_id: 'DAILY_REPORTS' },
  WEEKLY_REVIEWS: { site_id: 'SITES', prepared_by: 'USERS' },
  MONTHLY_REVIEWS: { site_id: 'SITES' },
  SUPERVISOR_EVALUATIONS: { user_id: 'USERS', monthly_review_id: 'MONTHLY_REVIEWS' },
  AUDIT_LOG: { user_id: 'USERS' },
  CLIENTS: { created_by: 'USERS' }
};

/**
 * Read-only: prints the USERS sheet's actual header row next to what the
 * schema expects, column by column, so a misalignment (the cause of a
 * "this account is not active" error on an account that really is active)
 * can be seen and fixed by hand — dragging the real column into place in
 * Sheets — without any script writing to the sheet. Run from the Apps
 * Script editor and check View > Logs (or the execution log) afterwards.
 */
function diagnoseUsersSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('USERS');
  if (!sheet) { Logger.log('No USERS sheet found.'); return; }

  const expected = SCHEMA.USERS;
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const actual = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  let report = 'Column #  |  Expected        |  Actual in sheet\n';
  const width = Math.max(expected.length, actual.length);
  let mismatches = 0;
  for (let i = 0; i < width; i++) {
    const exp = expected[i] || '(none)';
    const act = actual[i] || '(none)';
    const flag = exp !== act ? '  <-- MISMATCH' : '';
    if (exp !== act) mismatches++;
    report += (i + 1) + '  |  ' + exp + '  |  ' + act + flag + '\n';
  }
  report += mismatches
    ? '\n' + mismatches + ' column(s) out of place. Fix by dragging the actual column(s) in Sheets to match the Expected order above — do not delete or retype the header text itself.'
    : '\nNo mismatch found — headers line up with the schema.';

  Logger.log(report);
  try { SpreadsheetApp.getUi().alert(report); } catch (e) { /* not run from the sheet's menu */ }
}

// ---------- SETUP ----------

// Apps Script stops any run at 6 minutes. Setup stops itself a little
// before that and asks to be run again; since tables that already match the
// schema are skipped, each re-run picks up where the last one left off.
const SETUP_TIME_BUDGET_MS_ = 4.5 * 60 * 1000;

function setupDatabase() {
  const started = Date.now();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const needsManualFix = [];
  const updated = [];
  const tables = Object.keys(SCHEMA);
  let stoppedAt = -1;

  for (let i = 0; i < tables.length; i++) {
    if (Date.now() - started > SETUP_TIME_BUDGET_MS_) { stoppedAt = i; break; }
    const result = createOrRepairTable_(ss, tables[i]);
    if (result.needsManualFix) needsManualFix.push(tables[i]);
    if (result.changed) updated.push(tables[i]);
  }

  if (stoppedAt === -1) {
    setupDriveFolders_();
    removeDefaultBlankSheet_(ss);
  }

  let message;
  if (stoppedAt !== -1) {
    message = 'Setup is partway done (' + stoppedAt + ' of ' + tables.length + ' tables checked) and stopped before Apps Script\'s 6-minute limit. Run setupDatabase again to finish — it carries on from where it stopped.';
  } else if (needsManualFix.length) {
    message = 'Setup finished, but these tables have a column in an unexpected position and were left alone rather than risk scrambling data — check them by hand: ' + needsManualFix.join(', ');
  } else {
    message = 'Database setup complete: ' + tables.length + ' tables checked' + (updated.length ? '; created/updated: ' + updated.join(', ') : '; all were already up to date') + '.';
  }

  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    // getUi() only works when triggered from an open spreadsheet's menu, not
    // from the Apps Script editor's Run button — log it there instead.
    Logger.log(message);
  }
}

/**
 * Deletes and freshly recreates ONE table's sheet from the current SCHEMA —
 * a clean rebuild instead of reconcileColumns_'s cautious in-place repair.
 * This is destructive (every row in that sheet is lost), so it only ever
 * runs on the explicit table names passed to resetWorkPlanAndReportTables()
 * below — never on a table with real data worth keeping, and USERS is never
 * eligible here at all.
 */
function resetTable_(ss, tableName) {
  if (tableName === 'USERS') throw new Error('Refusing to reset USERS — this would delete every login account.');
  const existing = ss.getSheetByName(tableName);
  if (existing) ss.deleteSheet(existing);
  createOrRepairTable_(ss, tableName);
  invalidateIndex_(tableName);
  invalidateIndex_(tableName, 'email');
}

/**
 * One-time cleanup after the Sept 2026 schema redesign: WORK_PLANS and
 * DAILY_REPORTS (plus their child tables) hold no real submissions yet, so
 * rather than leave stray old-shape columns sitting next to the new ones,
 * this wipes just those sheets and rebuilds them exactly to the current
 * SCHEMA. Run this once, manually, from the Apps Script editor — not from
 * the web app. USERS and every other table are left completely untouched.
 */
function resetWorkPlanAndReportTables() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tables = ['WORK_PLANS', 'WORK_PLAN_TASKS', 'DAILY_REPORTS', 'DAILY_REPORT_TASKS', 'DAILY_REPORT_PHOTOS', 'MATERIAL_USAGE', 'EQUIPMENT_USAGE'];
  tables.forEach(function (t) { resetTable_(ss, t); });
  ['list_WORK_PLANS', 'list_WORK_PLAN_TASKS', 'list_DAILY_REPORTS', 'list_DAILY_REPORT_TASKS', 'list_DAILY_REPORT_PHOTOS', 'list_MATERIAL_USAGE', 'list_EQUIPMENT_USAGE']
    .forEach(function (key) { CacheService.getScriptCache().remove(key); });
  Logger.log('Reset complete: ' + tables.join(', ') + ' were rebuilt fresh from the current schema.');
}

// Returns { changed, needsManualFix }. A sheet that already matches the
// schema is left completely alone: re-applying header formatting, column
// widths and the dropdown validations to every table on every run is what
// used to push setupDatabase() past the 6-minute limit.
function createOrRepairTable_(ss, tableName) {
  const columns = SCHEMA[tableName];
  let sheet = ss.getSheetByName(tableName);

  if (!sheet) {
    sheet = ss.insertSheet(tableName);
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
  } else {
    const result = reconcileColumns_(sheet, columns);
    if (!result.aligned) return { changed: result.inserted, needsManualFix: true };
    if (!result.inserted) return { changed: false, needsManualFix: false };
  }

  sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold').setBackground('#f1efe8');
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, columns.length, 140);

  applyForeignKeyValidation_(ss, sheet, tableName, columns);
  return { changed: true, needsManualFix: false };
}

/**
 * Bring an existing sheet's columns in line with the current schema without
 * disturbing existing data. Any column the schema now expects that this
 * sheet doesn't have yet is inserted at the correct position — insertColumnBefore
 * shifts every existing column at or after that point one to the right,
 * which keeps already-entered data lined up with its own (unmoved) header.
 * Returns { aligned, inserted }. aligned is false, and nothing further is
 * touched, if a column exists but sits in the wrong position relative to
 * the schema: reordering it automatically would risk scrambling every row,
 * so that case is left for a manual look instead of being guessed at.
 * inserted says whether any missing column was added.
 */
function reconcileColumns_(sheet, targetColumns) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  let inserted = false;
  targetColumns.forEach(function (colName, targetIndex) {
    if (currentHeaders.indexOf(colName) === -1) {
      sheet.insertColumnBefore(targetIndex + 1);
      currentHeaders.splice(targetIndex, 0, colName);
      inserted = true;
    }
  });

  const aligned = targetColumns.every(function (colName, i) { return currentHeaders[i] === colName; });
  if (!aligned) return { aligned: false, inserted: inserted };

  if (inserted) sheet.getRange(1, 1, 1, targetColumns.length).setValues([targetColumns]);
  return { aligned: true, inserted: inserted };
}

// Adds a dropdown data-validation rule on each FK column, pulling live values
// from the referenced table's id column — bad references get caught at entry
// time instead of during a later fetch or report.
function applyForeignKeyValidation_(ss, sheet, tableName, columns) {
  const fks = RELATIONSHIPS[tableName];
  if (!fks) return;

  Object.keys(fks).forEach(function (fkColumn) {
    const refTable = fks[fkColumn];
    const refSheet = ss.getSheetByName(refTable);
    if (!refSheet) return;

    const colIndex = columns.indexOf(fkColumn) + 1;
    if (colIndex === 0) return;

    const idRange = refSheet.getRange('A2:A2000'); // referenced table's id column
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(idRange, true)
      .setAllowInvalid(true) // don't hard-block entry while a table is still small
      .setHelpText('Must match an id from ' + refTable)
      .build();

    sheet.getRange(2, colIndex, 1998, 1).setDataValidation(rule);
  });
}

function removeDefaultBlankSheet_(ss) {
  const sheet = ss.getSheetByName('Sheet1');
  if (sheet && ss.getSheets().length > 1) {
    const isEmpty = sheet.getLastRow() === 0 && sheet.getLastColumn() === 0;
    if (isEmpty) ss.deleteSheet(sheet);
  }
}

function setupDriveFolders_() {
  const root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
  Object.keys(FILE_COLUMNS).forEach(function (tableName) {
    getOrCreateSubfolder_(root, FILE_COLUMNS[tableName].folder);
  });
}

function getOrCreateSubfolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parent.createFolder(name);
}

// ---------- FAST ID LOOKUP (indexed, not full-sheet scan) ----------
//
// A naive lookup means reading every row until one matches — fine at 100
// rows, slow once a table has thousands. Instead, each table's id column is
// indexed once into a { id -> rowNumber } map and cached in CacheService, so
// repeat lookups are O(1) instead of O(n). The index rebuilds automatically
// whenever it's missing or expired, and updates incrementally on insert so
// it never goes stale.

const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

function getIndex_(tableName, columnName) {
  columnName = columnName || 'id';
  const cache = CacheService.getScriptCache();
  const cacheKey = 'idx_' + tableName + '_' + columnName;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const columns = SCHEMA[tableName];
  const colIndex = columns.indexOf(columnName);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(tableName);
  const lastRow = sheet.getLastRow();
  const index = {};

  if (lastRow > 1) {
    const values = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      if (values[i][0]) index[values[i][0]] = i + 2; // +2: header row, 1-based rows
    }
  }

  try {
    // CacheService caps each value at 100KB — comfortably fits tens of
    // thousands of ids. If a single table ever outgrows that, shard its
    // index by date/site or move that table to a real database instead.
    cache.put(cacheKey, JSON.stringify(index), CACHE_TTL_SECONDS);
  } catch (e) {
    // Too large to cache — lookups still work, just re-scan each time.
  }

  return index;
}

function invalidateIndex_(tableName, columnName) {
  CacheService.getScriptCache().remove('idx_' + tableName + '_' + (columnName || 'id'));
}

/**
 * Fetch a single row by id in O(1) via the cached index, instead of scanning
 * the whole table. Returns an object keyed by column name, or null.
 */
function getById(tableName, id) {
  const columns = SCHEMA[tableName];
  const index = getIndex_(tableName);
  const rowNumber = index[id];
  if (!rowNumber) return null;

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(tableName);
  const values = sheet.getRange(rowNumber, 1, 1, columns.length).getValues()[0];

  const record = {};
  columns.forEach(function (col, i) { record[col] = values[i]; });
  return record;
}

/**
 * Insert a row. Auto-generates the id if not supplied, appends in a single
 * call (never cell-by-cell — that's the other big Apps Script speed trap),
 * and updates the cached index incrementally instead of forcing a rebuild.
 */
function insertRow(tableName, record) {
  const columns = SCHEMA[tableName];
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(tableName);

  if (!record.id) record.id = Utilities.getUuid();

  const row = columns.map(function (col) {
    return record[col] !== undefined ? record[col] : '';
  });
  sheet.appendRow(row);

  const index = getIndex_(tableName);
  index[record.id] = sheet.getLastRow();
  CacheService.getScriptCache().put('idx_' + tableName + '_id', JSON.stringify(index), CACHE_TTL_SECONDS);

  if (tableName === 'USERS') invalidateIndex_('USERS', 'email');

  return record.id;
}

/**
 * Update specific columns of one existing row, found via the id index (a
 * single targeted read + single write — not a full-sheet scan). Used for
 * status changes: approving a project, resolving a ticket, and so on.
 */
function updateRow(tableName, id, updates) {
  const columns = SCHEMA[tableName];
  const index = getIndex_(tableName);
  const rowNumber = index[id];
  if (!rowNumber) throw new Error('No such ' + tableName + ' record: ' + id);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(tableName);
  const range = sheet.getRange(rowNumber, 1, 1, columns.length);
  const row = range.getValues()[0];

  columns.forEach(function (col, i) {
    if (Object.prototype.hasOwnProperty.call(updates, col)) row[i] = updates[col];
  });

  range.setValues([row]);
  return true;
}

/**
 * Permanently remove one row, found via the id index. Deleting a row shifts
 * every row after it up by one, which would desync the cached row-number
 * index — so this invalidates the whole index rather than patching it
 * incrementally (the next lookup rebuilds it from a fresh scan).
 */
function deleteRow(tableName, id) {
  const index = getIndex_(tableName);
  const rowNumber = index[id];
  if (!rowNumber) throw new Error('No such ' + tableName + ' record: ' + id);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(tableName);
  sheet.deleteRow(rowNumber);

  invalidateIndex_(tableName);
  return true;
}

/**
 * Delete every row in `tableName` where `fkColumn` equals `fkValue` — the
 * cascade primitive behind deleteProject() (Auth.gs): deleting a project
 * also removes its assignments, work plans, daily reports and everything
 * hung off those. Reads the sheet directly (not through listTable()'s
 * cache, which could be stale) and deletes bottom-to-top in one pass so an
 * earlier match's row number is never shifted by a later deletion in the
 * same call. Returns the deleted rows' own ids, so a caller can cascade one
 * level further (e.g. a removed WORK_PLANS row's id is also
 * WORK_PLAN_TASKS.work_plan_id).
 */
function deleteRowsWhere_(tableName, fkColumn, fkValue) {
  const columns = SCHEMA[tableName];
  const fkIndex = columns.indexOf(fkColumn);
  const idIndex = columns.indexOf('id');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(tableName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, columns.length).getValues();
  const deletedIds = [];
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i][fkIndex] === fkValue) {
      deletedIds.push(values[i][idIndex]);
      sheet.deleteRow(i + 2); // +2: header row, 1-based rows
    }
  }
  if (deletedIds.length) {
    invalidateIndex_(tableName);
    invalidateListCache_(tableName);
  }
  return deletedIds;
}

/**
 * Save a file (e.g. a receipt or safety photo) into the correct Drive
 * subfolder — optionally inside a further per-project subfolder of that
 * (e.g. "Daily Report Photos/Riverside Tower [a1b2c3]") — and return both
 * its normal Drive URL (for "open in Drive") and a direct-view URL that
 * works in a plain <img src>. `blob` is a Utilities.Blob, e.g. built from
 * a base64 upload in the web app's request body.
 *
 * The file is shared "anyone with the link can view" so it can be embedded
 * in the dashboard and in printed reports without every viewer needing
 * their own Drive access to this folder — fine for site-progress photos,
 * but worth knowing if this is ever repurposed for something sensitive.
 */
function uploadFile(tableName, blob, subfolderName) {
  const config = FILE_COLUMNS[tableName];
  if (!config) throw new Error(tableName + ' has no file column configured.');

  const root = DriveApp.getFolderById(ROOT_DRIVE_FOLDER_ID);
  let folder = getOrCreateSubfolder_(root, config.folder);
  if (subfolderName) folder = getOrCreateSubfolder_(folder, subfolderName);
  const file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* org Drive policy may block this; file still saves */ }

  return {
    id: file.getId(),
    url: file.getUrl(),
    directUrl: 'https://drive.google.com/uc?export=view&id=' + file.getId()
  };
}

// A project's own name can repeat or change, so its photo subfolder name
// is "<name> [<first 6 of its id>]" — readable in Drive, but still unique
// and stable even if the project is later renamed.
function projectSubfolderName_(projectId) {
  if (!projectId) return 'Unassigned';
  const project = getById('PROJECTS', projectId);
  if (!project) return 'Unassigned';
  return (project.name || 'Untitled project') + ' [' + String(projectId).slice(0, 6) + ']';
}
