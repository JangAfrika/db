/**
 * Dynamic Builders — Auth & API layer
 * Adds to Code.gs: roles, email+password login, sessions, and the JSON Web
 * App endpoints your GitHub-hosted dashboard (HTML/JS) will call over fetch.
 *
 * SETUP (after running setupDatabase() from Code.gs once):
 * 1. Run bootstrapFirstAdmin() manually from the Apps Script editor to
 *    create the first IT_ADMIN account (edit the email/password in that
 *    function first). Every other user is created via createUser(), which
 *    only an IT_ADMIN session can call.
 * 2. Deploy > New deployment > type "Web app" > Execute as "Me" > Who has
 *    access "Anyone". Copy the resulting /exec URL into your frontend.
 * 3. Because "Anyone" can reach that URL, EVERY action below re-checks the
 *    session token itself — nothing here relies on Google's own login.
 */

// ---------- ROLES ----------

const ROLES = {
  IT_ADMIN: 'IT_ADMIN',
  MANAGER: 'MANAGER',
  ADMIN_SECRETARY: 'ADMIN_SECRETARY',
  SITE_SUPERVISOR: 'SITE_SUPERVISOR'
};

// Manager/Admin Secretary may edit a given site or project at most this
// many times (tracked by SITES.edit_count / PROJECTS.edit_count — see
// updateSite()/updateProject() below). IT Admin is exempt: IT Admin edits
// never increment the counter and are never blocked by it.
const MAX_SELF_SERVICE_EDITS_ = 3;

// Which roles may WRITE (insert) to each table. Any logged-in role may READ
// via listTable(), except USERS (IT_ADMIN/MANAGER/ADMIN_SECRETARY only — see USERS_READ_ROLES).
const WRITE_PERMISSIONS = {
  USERS: [], // user rows are only ever written via createUser(), never generic insert
  // Admin Secretary is the Manager's assistant and can do everything the
  // Manager can here: register sites, add to the materials/equipment
  // catalogue, and set productivity targets.
  SITES: [ROLES.IT_ADMIN, ROLES.MANAGER, ROLES.ADMIN_SECRETARY],
  // Clients/consultants are created inline from the site form (or managed on
  // their own), same roles as SITES — updateClient()/deleteClient() below
  // handle edits/deletes since those aren't generic-insert actions.
  CLIENTS: [ROLES.IT_ADMIN, ROLES.MANAGER, ROLES.ADMIN_SECRETARY],
  MATERIALS: [ROLES.IT_ADMIN, ROLES.MANAGER, ROLES.ADMIN_SECRETARY],
  EQUIPMENT: [ROLES.IT_ADMIN, ROLES.MANAGER, ROLES.ADMIN_SECRETARY],
  PRODUCTIVITY_TARGETS: [ROLES.IT_ADMIN, ROLES.MANAGER, ROLES.ADMIN_SECRETARY],
  USER_SITES: [ROLES.IT_ADMIN],
  PROJECTS: [], // created via createProject(), approved via approveProject() — never generic insert
  PROJECT_ASSIGNMENTS: [], // created via assignProject()
  TICKETS: [], // created via raiseTicket(), resolved via resolveTicket()
  COMPLETION_NOTICES: [], // created via flagCompletion(), reviewed via reviewCompletionNotice()
  WORK_PLANS: [], // created via submitWorkPlan(), never generic insert
  WORK_PLAN_TASKS: [], // written only as part of submitWorkPlan()'s bundle
  DAILY_REPORTS: [ROLES.SITE_SUPERVISOR, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN],
  DAILY_REPORT_TASKS: [ROLES.SITE_SUPERVISOR, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN],
  DAILY_REPORT_PHOTOS: [ROLES.SITE_SUPERVISOR, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN],
  EXPENSES: [ROLES.SITE_SUPERVISOR, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN],
  MATERIAL_USAGE: [ROLES.SITE_SUPERVISOR, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN],
  EQUIPMENT_USAGE: [ROLES.SITE_SUPERVISOR, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN],
  SAFETY_INCIDENTS: [ROLES.SITE_SUPERVISOR, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN],
  PRODUCTIVITY_ACTUALS: [ROLES.SITE_SUPERVISOR, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN],
  OPEN_ISSUES: [ROLES.MANAGER, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN],
  WEEKLY_REVIEWS: [ROLES.MANAGER, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN],
  MONTHLY_REVIEWS: [ROLES.MANAGER, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN],
  SUPERVISOR_EVALUATIONS: [ROLES.MANAGER, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN]
};

const USERS_READ_ROLES = [ROLES.IT_ADMIN, ROLES.MANAGER, ROLES.ADMIN_SECRETARY];

// ---------- SESSIONS ----------

const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8-hour login session

function createSession_(user) {
  const token = Utilities.getUuid();
  const session = { userId: user.id, role: user.role, name: user.name, email: user.email };
  CacheService.getScriptCache().put('session_' + token, JSON.stringify(session), SESSION_TTL_SECONDS);
  return token;
}

function getSession_(token) {
  const raw = token ? CacheService.getScriptCache().get('session_' + token) : null;
  return raw ? JSON.parse(raw) : null;
}

function destroySession_(token) {
  CacheService.getScriptCache().remove('session_' + token);
}

// Throws if the token is missing/expired, or the session's role isn't in
// allowedRoles. Pass null for allowedRoles to mean "any logged-in role".
// Every write and every sensitive read must call this first.
function authorize_(token, allowedRoles) {
  const session = getSession_(token);
  if (!session) throw new Error('Not logged in, or your session expired — please log in again.');
  if (allowedRoles && allowedRoles.indexOf(session.role) === -1) {
    throw new Error('Your role (' + session.role + ') is not allowed to do this.');
  }
  return session;
}

// ---------- AUDIT LOG ----------
//
// A lightweight trail of logins and significant actions, for IT Admin's
// Audit Log tab. Written directly via insertRow() (never the generic,
// role-gated insert action) so every call site below can log without
// needing its own WRITE_PERMISSIONS entry. Logging never blocks or breaks
// the action it's recording — a logging failure is swallowed, not thrown.

function logActivity_(tokenOrActor, action, details) {
  try {
    let userId = '', userName = 'Unknown', role = '';
    if (tokenOrActor && tokenOrActor.userId && tokenOrActor.name) {
      // Explicit actor object — used right after login, before a session
      // token even exists to look up.
      userId = tokenOrActor.userId;
      userName = tokenOrActor.name;
      role = tokenOrActor.role || '';
    } else {
      const session = getSession_(tokenOrActor);
      if (session) {
        userId = session.userId;
        userName = session.name;
        role = session.role;
      }
    }
    insertRow('AUDIT_LOG', {
      user_id: userId,
      user_name: userName,
      role: role,
      action: action,
      details: details || '',
      created_at: new Date()
    });
    invalidateListCache_('AUDIT_LOG');
  } catch (e) {
    // Never let a logging failure break the action it's recording.
  }
}

/** IT_ADMIN-only: the full audit trail, newest first. */
function getAuditLog(token) {
  authorize_(token, [ROLES.IT_ADMIN]);
  const rows = listTable(token, 'AUDIT_LOG');
  return rows.slice().sort(function (a, b) {
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

// ---------- PASSWORDS ----------

function hashPassword_(password, salt) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

// ---------- LOGIN / USER MANAGEMENT ----------

function login(email, password) {
  const emailIndex = getIndex_('USERS', 'email');
  const rowNumber = emailIndex[email];
  if (!rowNumber) throw new Error('No account with that email.');

  const columns = SCHEMA.USERS;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('USERS');
  const values = sheet.getRange(rowNumber, 1, 1, columns.length).getValues()[0];
  const user = {};
  columns.forEach(function (col, i) { user[col] = values[i]; });

  if (user.status === 'pending_verification') {
    throw new Error('Please verify your email first — check your inbox (and spam folder) for the link we sent when you registered.');
  }
  if (user.status === 'suspended') throw new Error('This account is not active — contact your IT admin.');
  if (hashPassword_(password, user.password_salt) !== user.password_hash) {
    throw new Error('Incorrect email or password.');
  }

  // 'pending_approval' logs in fine — they just see a profile-only, "awaiting
  // approval" view (role comes back empty) until IT Admin approves them and
  // assigns a role; see approveUser() and pending.html on the frontend.
  const token = createSession_(user);
  logActivity_({ userId: user.id, name: user.name, role: user.role }, 'Login', '');
  return { token: token, userId: user.id, name: user.name, role: user.role, email: user.email, status: user.status };
}

function logout(token) {
  destroySession_(token);
  return { ok: true };
}

// ---------- SELF-SERVICE REGISTRATION ----------
//
// register.html -> registerAccount() -> verification email -> verify.html
// -> verifyEmail() -> they can log in (pending.html, profile only, no
// role) -> IT Admin's Users tab -> approveUser() -> approval email -> full
// access. See "Self-service account registration" in the README for the
// whole flow and the email setup (MailApp, FRONTEND_BASE_URL).

const EMAIL_RE_ = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFICATION_TOKEN_TTL_HOURS_ = 48;

/**
 * Public — no session token. Anyone can call this; it's the sign-up form.
 * Creates the account in 'pending_verification' with no role yet (role is
 * assigned later, at approval) and emails a verification link. The account
 * cannot log in until that link is clicked (see login()'s pending_verification
 * check above).
 */
function registerAccount(newUser) {
  if (!newUser.name || !newUser.email || !newUser.password) {
    throw new Error('Name, email and password are all required.');
  }
  const email = String(newUser.email).trim().toLowerCase();
  if (!EMAIL_RE_.test(email)) throw new Error('That doesn\'t look like a valid email address.');
  if (String(newUser.password).length < 6) throw new Error('Password must be at least 6 characters.');
  if (getIndex_('USERS', 'email')[email]) throw new Error('That email is already registered.');
  if (newUser.requestedRole && Object.keys(ROLES).indexOf(newUser.requestedRole) === -1) {
    throw new Error('Unknown role: ' + newUser.requestedRole);
  }

  const salt = Utilities.getUuid();
  const token = Utilities.getUuid();
  const expires = new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS_ * 60 * 60 * 1000);

  const id = insertRow('USERS', {
    name: newUser.name,
    email: email,
    password_hash: hashPassword_(newUser.password, salt),
    password_salt: salt,
    role: '',
    phone: newUser.phone || '',
    status: 'pending_verification',
    email_verified: false,
    verification_token: token,
    verification_token_expires: expires,
    requested_role: newUser.requestedRole || '',
    created_at: new Date()
  });
  invalidateIndex_('USERS', 'email');
  invalidateIndex_('USERS', 'verification_token');
  invalidateListCache_('USERS');
  logActivity_({ userId: id, name: newUser.name, role: '' }, 'Register account', email + (newUser.requestedRole ? ' (applying as ' + (ROLE_LABELS_[newUser.requestedRole] || newUser.requestedRole) + ')' : ''));

  sendVerificationEmail_({ id: id, name: newUser.name, email: email }, token);

  return { id: id };
}

/**
 * Public — the token IS the credential (it's a long random UUID, texted/
 * emailed only to the account owner, single-use, and expires). Confirms the
 * email is real and moves the account from pending_verification to
 * pending_approval, where it sits until IT Admin acts on it.
 */
function verifyEmail(token) {
  if (!token) throw new Error('Missing verification token.');
  const index = getIndex_('USERS', 'verification_token');
  const rowNumber = index[token];
  if (!rowNumber) throw new Error('This verification link is invalid or has already been used.');

  const user = getById('USERS', getIdAtRow_('USERS', rowNumber));
  if (!user) throw new Error('This verification link is invalid or has already been used.');
  if (user.verification_token_expires && new Date(user.verification_token_expires) < new Date()) {
    throw new Error('This verification link has expired. Use "Resend verification email" to get a new one.');
  }

  updateRow('USERS', user.id, {
    status: 'pending_approval',
    email_verified: true,
    verification_token: '',
    verification_token_expires: ''
  });
  invalidateIndex_('USERS', 'verification_token');
  invalidateListCache_('USERS');
  logActivity_({ userId: user.id, name: user.name, role: '' }, 'Verify email', user.email);

  return { ok: true, name: user.name };
}

/**
 * Public. Re-issues a fresh verification token/email for someone whose
 * first one expired or never arrived — without this, a lost email strands
 * the account forever with no way back in. Deliberately returns the same
 * generic "if that email is pending, we've sent it" message whether or not
 * the address exists, so this can't be used to probe which emails are
 * registered.
 */
function resendVerification(email) {
  email = String(email || '').trim().toLowerCase();
  const generic = { ok: true, message: 'If that email is awaiting verification, a new link has been sent.' };
  if (!email) return generic;

  const index = getIndex_('USERS', 'email');
  const rowNumber = index[email];
  if (!rowNumber) return generic;
  const user = getById('USERS', getIdAtRow_('USERS', rowNumber));
  if (!user || user.status !== 'pending_verification') return generic;

  const token = Utilities.getUuid();
  const expires = new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS_ * 60 * 60 * 1000);
  updateRow('USERS', user.id, { verification_token: token, verification_token_expires: expires });
  invalidateIndex_('USERS', 'verification_token');
  invalidateListCache_('USERS');
  sendVerificationEmail_(user, token);

  return generic;
}

/**
 * IT_ADMIN only. The other half of registerAccount(): assigns the role,
 * activates the account, and emails the approval notice. `role` defaults to
 * whatever the applicant requested at sign-up if the caller doesn't
 * override it.
 */
function approveUser(token, userId, role) {
  const actor = authorize_(token, [ROLES.IT_ADMIN]);
  const user = getById('USERS', userId);
  if (!user) throw new Error('No such user.');
  if (user.status !== 'pending_approval') throw new Error('This account isn\'t awaiting approval (status: ' + user.status + ').');

  role = role || user.requested_role;
  if (!role || Object.keys(ROLES).indexOf(role) === -1) throw new Error('Pick a valid role to approve this account with.');

  updateRow('USERS', userId, {
    role: role,
    status: 'active',
    approved_by: actor.userId,
    approved_at: new Date()
  });
  invalidateListCache_('USERS');
  logActivity_(token, 'Approve user', user.name + ' (' + user.email + ') as ' + (ROLE_LABELS_[role] || role));

  sendApprovalEmail_(Object.assign({}, user, { role: role }));

  return { ok: true };
}

// Small helper: getIndex_()/listTable() key everything by id, but a few
// lookups above (verify/resend) need to go the other way — from a row
// number (found via a non-id index) back to that row's id — without a
// second full-table scan.
function getIdAtRow_(tableName, rowNumber) {
  const columns = SCHEMA[tableName];
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(tableName);
  return sheet.getRange(rowNumber, columns.indexOf('id') + 1, 1, 1).getValue();
}

// ---------- FORGOT PASSWORD / SELF-SERVICE RESET ----------
//
// index.html "Forgot password?" -> forgot-password.html -> requestPasswordReset()
// -> reset email -> reset-password.html?token=... -> resetPassword() -> log in
// with the new password. See "Forgot password / password reset" in the README.
//
// The emailed token is a random UUID, but only its SHA-256 hash is stored in
// USERS.password_reset_token — so even someone who could read the sheet
// can't turn what's stored there into a working reset link. It's single-use
// (cleared the moment it's used, or replaced by a newer request) and
// expires after PASSWORD_RESET_TTL_MINUTES_.

const PASSWORD_RESET_TTL_MINUTES_ = 60;
// Minimum gap between two reset emails to the same account, so the public
// form can't be used to flood someone's inbox.
const PASSWORD_RESET_COOLDOWN_SECONDS_ = 120;

function hashResetToken_(token) {
  return hashPassword_(String(token), 'password-reset');
}

/**
 * Public — no session token. Emails a reset link if the address belongs to
 * an account that can log in (active, or verified and awaiting approval).
 * Always returns the same generic response whether or not the address is
 * registered, same as resendVerification(), so it can't be used to check
 * which emails have accounts.
 */
function requestPasswordReset(email) {
  email = String(email || '').trim().toLowerCase();
  const generic = { ok: true, message: 'If an account exists for that email, a password reset link has been sent.' };
  if (!email || !EMAIL_RE_.test(email)) return generic;

  const rowNumber = getIndex_('USERS', 'email')[email];
  if (!rowNumber) return generic;
  const user = getById('USERS', getIdAtRow_('USERS', rowNumber));
  if (!user || (user.status !== 'active' && user.status !== 'pending_approval')) return generic;

  const cache = CacheService.getScriptCache();
  const cooldownKey = 'pwreset_cooldown_' + user.id;
  if (cache.get(cooldownKey)) return generic;
  cache.put(cooldownKey, '1', PASSWORD_RESET_COOLDOWN_SECONDS_);

  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const expires = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES_ * 60 * 1000);
  updateRow('USERS', user.id, { password_reset_token: hashResetToken_(token), password_reset_expires: expires });
  invalidateIndex_('USERS', 'password_reset_token');
  invalidateListCache_('USERS');
  logActivity_({ userId: user.id, name: user.name, role: user.role }, 'Request password reset', user.email);

  sendPasswordResetEmail_(user, token);

  return generic;
}

// Shared by checkPasswordResetToken()/resetPassword(): the user a reset
// token belongs to, or a thrown error if it's unknown, used or expired.
function findUserByResetToken_(token) {
  const invalid = 'This reset link is invalid or has already been used. Request a new one from the login page.';
  if (!token) throw new Error(invalid);
  const rowNumber = getIndex_('USERS', 'password_reset_token')[hashResetToken_(token)];
  if (!rowNumber) throw new Error(invalid);
  const user = getById('USERS', getIdAtRow_('USERS', rowNumber));
  if (!user || user.password_reset_token !== hashResetToken_(token)) throw new Error(invalid);
  if (!user.password_reset_expires || new Date(user.password_reset_expires) < new Date()) {
    throw new Error('This reset link has expired. Request a new one from the login page.');
  }
  if (user.status !== 'active' && user.status !== 'pending_approval') {
    throw new Error('This account is not active — contact your IT admin.');
  }
  return user;
}

/** Public. Lets reset-password.html tell someone their link is dead before they type a new password. */
function checkPasswordResetToken(token) {
  const user = findUserByResetToken_(token);
  return { ok: true, email: user.email };
}

/**
 * Public — the token IS the credential. Sets the new password and clears the
 * token so the link can't be used again.
 */
function resetPassword(token, password) {
  const user = findUserByResetToken_(token);
  if (String(password || '').length < 6) throw new Error('Password must be at least 6 characters.');

  const salt = Utilities.getUuid();
  updateRow('USERS', user.id, {
    password_hash: hashPassword_(password, salt),
    password_salt: salt,
    password_reset_token: '',
    password_reset_expires: ''
  });
  invalidateIndex_('USERS', 'password_reset_token');
  invalidateListCache_('USERS');
  logActivity_({ userId: user.id, name: user.name, role: user.role }, 'Reset password', user.email + ' (via emailed reset link)');

  sendPasswordChangedEmail_(user);

  return { ok: true };
}

// ---------- REGISTRATION / APPROVAL EMAILS ----------
//
// Sent via MailApp from whichever Google account owns this Apps Script
// project — no extra setup, no API key, but subject to that account's
// daily send quota (≈100/day on a plain Gmail account, ≈1500/day on
// Google Workspace — plenty for staff onboarding, but worth knowing if
// you ever bulk-import users). A failed send never blocks the action it's
// attached to — registerAccount()/approveUser() still succeed even if the
// email bounces, since resendVerification() (frontend: verify.html) gives
// a way to recover from a lost verification email, and IT Admin can always
// see/communicate approval status directly from the Users tab either way.

function frontendUrl_(path) {
  return FRONTEND_BASE_URL ? (FRONTEND_BASE_URL.replace(/\/$/, '') + '/' + path) : '';
}

// Every email is sent plain-text (for clients/previews that don't render
// HTML) AND as a short HTML body so a single word — "Verify", "Login" —
// can be a real clickable hyperlink instead of a long raw URL. Both bodies
// are built from the same `lines` array: each entry is either a plain
// string (its own paragraph) or { link: url, label: 'Verify' } for the one
// line that should render as a hyperlink.
function emailEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sendSimpleEmail_(to, subject, lines) {
  try {
    const textParts = [], htmlParts = [];
    lines.forEach(function (line) {
      if (line && typeof line === 'object' && line.link) {
        if (line.link) {
          textParts.push(line.label + ': ' + line.link);
          htmlParts.push('<p><a href="' + line.link + '" style="color:#2a78d6;font-weight:600;text-decoration:underline;">' + emailEsc_(line.label) + '</a></p>');
        }
      } else if (line !== null && line !== undefined) {
        textParts.push(String(line));
        htmlParts.push('<p style="margin:0 0 12px;">' + emailEsc_(line).replace(/\n/g, '<br>') + '</p>');
      }
    });
    const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">' + htmlParts.join('') + '</div>';
    MailApp.sendEmail({ to: to, subject: subject, body: textParts.join('\n\n'), htmlBody: html });
  } catch (e) {
    // Swallowed on purpose throughout this file — a failed notification
    // email never blocks the action it's attached to (account still gets
    // created/approved/suspended/etc. either way), and resendVerification()
    // (frontend: verify.html) is the recovery path for the one email a
    // person actually needs to act on.
  }
}

function sendVerificationEmail_(user, token) {
  const link = frontendUrl_('verify.html?token=' + encodeURIComponent(token));
  sendSimpleEmail_(user.email, 'Verify your email — Dynamic Builders', [
    'Hi ' + user.name + ',',
    'Thanks for registering for Dynamic Builders. Please confirm this is your email address by clicking the link below (it expires in ' + VERIFICATION_TOKEN_TTL_HOURS_ + ' hours)',
    link ? { link: link, label: 'Verify' } : '(Ask your IT admin for the verification link — this system isn\'t configured with a web address yet.)',
    '— Dynamic Builders\n— IT Admin'
  ]);
}

function sendPasswordResetEmail_(user, token) {
  const link = frontendUrl_('reset-password.html?token=' + encodeURIComponent(token));
  sendSimpleEmail_(user.email, 'Reset your password — Dynamic Builders', [
    'Hi ' + user.name + ',',
    'We received a request to reset the password for your Dynamic Builders account. Click the link below to choose a new password. The link works once and expires in ' + PASSWORD_RESET_TTL_MINUTES_ + ' minutes.',
    link ? { link: link, label: 'Reset password' } : '(Ask your IT admin to reset your password — this system isn\'t configured with a web address yet.)',
    'If you didn\'t ask for this, you can ignore this email — your password stays the same.',
    '— Dynamic Builders\n— IT Admin'
  ]);
}

/** Heads-up after a successful reset, so an unexpected change doesn't go unnoticed. */
function sendPasswordChangedEmail_(user) {
  const link = frontendUrl_('index.html');
  sendSimpleEmail_(user.email, 'Your password was changed — Dynamic Builders', [
    'Hi ' + user.name + ',',
    'The password for your Dynamic Builders account was just changed using a reset link. You can log in with your new password now.',
    link ? { link: link, label: 'Login' } : null,
    'If this wasn\'t you, contact your IT admin straight away.',
    '— Dynamic Builders\n— IT Admin'
  ]);
}

function sendApprovalEmail_(user) {
  const link = frontendUrl_('index.html');
  sendSimpleEmail_(user.email, 'Your account is approved — Dynamic Builders', [
    'Hi ' + user.name + ',',
    'Your Dynamic Builders account has been approved as ' + (ROLE_LABELS_[user.role] || user.role) + '.',
    'You can log in now with the email and password you registered with',
    link ? { link: link, label: 'Login' } : null,
    '— Dynamic Builders\n— IT Admin'
  ]);
}

/** Applicant rejected — their pending_verification/pending_approval account was deleted instead of approved. */
function sendRejectionEmail_(user) {
  sendSimpleEmail_(user.email, 'Your Dynamic Builders application', [
    'Hi ' + user.name + ',',
    'Thanks for your interest in Dynamic Builders. After review, we\'re not able to approve your account at this time.',
    'If you think this is a mistake, contact your IT admin.',
    '— Dynamic Builders\n— IT Admin'
  ]);
}

/** An active or suspended account was permanently deleted by IT Admin. */
function sendAccountDeletedEmail_(user) {
  sendSimpleEmail_(user.email, 'Your Dynamic Builders account has been removed', [
    'Hi ' + user.name + ',',
    'Your Dynamic Builders account (' + user.email + ') has been removed. You no longer have access to the system.',
    'If you think this is a mistake, contact your IT admin.',
    '— Dynamic Builders\n— IT Admin'
  ]);
}

function sendSuspensionEmail_(user) {
  sendSimpleEmail_(user.email, 'Your Dynamic Builders account has been suspended', [
    'Hi ' + user.name + ',',
    'Your Dynamic Builders account has been suspended. You won\'t be able to log in until it\'s reactivated.',
    'If you think this is a mistake, contact your IT admin.',
    '— Dynamic Builders\n— IT Admin'
  ]);
}

function sendReactivationEmail_(user) {
  const link = frontendUrl_('index.html');
  sendSimpleEmail_(user.email, 'Your Dynamic Builders account has been reactivated', [
    'Hi ' + user.name + ',',
    'Your Dynamic Builders account has been reactivated.',
    'You can log in now with the email and password you registered with',
    link ? { link: link, label: 'Login' } : null,
    '— Dynamic Builders\n— IT Admin'
  ]);
}

/** IT Admin added this account directly (createUser()) — give them their login details. */
function sendNewUserCredentialsEmail_(user, tempPassword) {
  const link = frontendUrl_('index.html');
  sendSimpleEmail_(user.email, 'Your Dynamic Builders account', [
    'Hi ' + user.name + ',',
    'An IT admin has registered you on Dynamic Builders as ' + (ROLE_LABELS_[user.role] || user.role) + '.',
    'Email: ' + user.email + '\nTemporary password: ' + tempPassword + '\n(please change it after logging in)',
    link ? { link: link, label: 'Login' } : null,
    '— Dynamic Builders\n— IT Admin'
  ]);
}

/**
 * Every active user whose role is in `roles`, as full {id,name,email,role,...}
 * rows — the fan-out list behind every "notify everyone who can act on this"
 * email below (e.g. every Manager + Admin Secretary when a work plan comes
 * in). A direct sheet scan, same shape as listUsersByRole() above, but for
 * internal use (no token/authorize_) since these are server-triggered, not
 * a frontend call.
 */
function getActiveUsersByRoles_(roles) {
  const columns = SCHEMA.USERS;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('USERS');
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, columns.length).getValues() : [];
  return rows
    .map(function (row) {
      const record = {};
      columns.forEach(function (col, i) { record[col] = row[i]; });
      return record;
    })
    .filter(function (u) { return roles.indexOf(u.role) !== -1 && u.status === 'active' && u.email; });
}

/** Every active IT Admin's email, for the "new ticket" notification below. */
function getActiveItAdminEmails_() {
  return getActiveUsersByRoles_([ROLES.IT_ADMIN]).map(function (u) { return u.email; });
}

/**
 * Send the same notification to a list of {name,email} users — each gets
 * their own "Hi <name>," greeting prepended, same template otherwise. Used
 * wherever one action (a work plan, a daily report, a completion notice)
 * needs to reach more than one person.
 */
function broadcastEmail_(users, subject, bodyLines) {
  (users || []).forEach(function (u) {
    if (!u || !u.email) return;
    sendSimpleEmail_(u.email, subject, ['Hi ' + u.name + ','].concat(bodyLines));
  });
}

/** New support ticket raised — notify every active IT Admin. */
function sendTicketNotificationEmail_(raisedBy, ticket) {
  const emails = getActiveItAdminEmails_();
  if (!emails.length) return;
  const link = frontendUrl_('dashboards/it-admin.html');
  emails.forEach(function (email) {
    sendSimpleEmail_(email, 'New support ticket — Dynamic Builders', [
      'Hi IT Admin,',
      raisedBy.name + ' (' + (ROLE_LABELS_[raisedBy.role] || raisedBy.role) + ') raised a new ' + (ticket.category || 'error') + ' ticket:',
      '"' + ticket.description + '"',
      link ? { link: link, label: 'Open IT Admin dashboard' } : null,
      '— Dynamic Builders'
    ]);
  });
}

/**
 * Create a new, already-active user account directly. Requires an
 * IT_ADMIN session token — this is the "add a user myself" path (IT Admin
 * picks the role and a temporary password up front, no verification
 * needed since IT Admin is vouching for them personally). The other path
 * is self-service: registerAccount() -> verifyEmail() -> approveUser(),
 * for people who sign themselves up and need review first.
 */
function createUser(token, newUser) {
  authorize_(token, [ROLES.IT_ADMIN]);

  if (!newUser.email || !newUser.password || !newUser.role || !newUser.name) {
    throw new Error('name, email, password and role are all required.');
  }
  if (Object.keys(ROLES).indexOf(newUser.role) === -1) {
    throw new Error('Unknown role: ' + newUser.role);
  }
  if (getIndex_('USERS', 'email')[newUser.email]) {
    throw new Error('That email is already registered.');
  }

  const actor = getSession_(token);
  const salt = Utilities.getUuid();

  const id = insertRow('USERS', {
    name: newUser.name,
    email: newUser.email,
    password_hash: hashPassword_(newUser.password, salt),
    password_salt: salt,
    role: newUser.role,
    phone: newUser.phone || '',
    status: 'active',
    email_verified: true,
    created_by: actor.userId,
    created_at: new Date()
  });
  invalidateIndex_('USERS', 'email');
  invalidateListCache_('USERS');
  logActivity_(token, 'Create user', 'Created ' + ROLE_LABELS_[newUser.role] + ' account: ' + newUser.name + ' (' + newUser.email + ')');

  sendNewUserCredentialsEmail_({ id: id, name: newUser.name, email: newUser.email, role: newUser.role }, newUser.password);

  return { id: id };
}

/**
 * Edit an existing user's profile — name, email, phone, role, status, and
 * optionally reset their password. IT_ADMIN only — the same authority that
 * creates an account is the only one that can change or disable it. Only
 * the fields present in `updates` are touched, so a caller can send just
 * `{ status: 'suspended' }` without re-sending the whole profile.
 */
function updateUser(token, userId, updates) {
  const session = authorize_(token, [ROLES.IT_ADMIN]);
  const existing = getById('USERS', userId);
  if (!existing) throw new Error('No such user.');

  const changes = {};

  if (updates.name) changes.name = updates.name;
  if (updates.phone !== undefined) changes.phone = updates.phone;

  if (updates.email && updates.email !== existing.email) {
    if (getIndex_('USERS', 'email')[updates.email]) throw new Error('That email is already registered.');
    changes.email = updates.email;
  }

  if (updates.role) {
    if (Object.keys(ROLES).indexOf(updates.role) === -1) throw new Error('Unknown role: ' + updates.role);
    changes.role = updates.role;
  }

  if (updates.status) {
    if (['active', 'suspended'].indexOf(updates.status) === -1) throw new Error('Unknown status: ' + updates.status);
    if (updates.status !== 'active' && userId === session.userId) {
      throw new Error('You can\'t suspend your own account.');
    }
    // A self-registered account with no role yet goes through approveUser()
    // instead, which sets the role and activates it together — activating
    // one here would leave it active with no role, which can log in but
    // can't land on any dashboard.
    if (updates.status === 'active' && !existing.role && !updates.role) {
      throw new Error('This account hasn\'t been assigned a role yet — use Approve instead of Activate.');
    }
    changes.status = updates.status;
  }

  if (updates.password) {
    const salt = Utilities.getUuid();
    changes.password_hash = hashPassword_(updates.password, salt);
    changes.password_salt = salt;
    // An IT Admin reset supersedes any self-service reset link still
    // sitting in the user's inbox.
    changes.password_reset_token = '';
    changes.password_reset_expires = '';
  }

  updateRow('USERS', userId, changes);
  if (changes.email) invalidateIndex_('USERS', 'email');
  if (changes.password_hash) invalidateIndex_('USERS', 'password_reset_token');
  invalidateListCache_('USERS');
  const changedFields = Object.keys(changes).filter(function (k) { return ['password_hash', 'password_salt', 'password_reset_token', 'password_reset_expires'].indexOf(k) === -1; });
  if (changes.password_hash) changedFields.push('password reset');
  logActivity_(token, 'Update user', existing.name + ': ' + (changedFields.join(', ') || 'no changes'));

  // Suspended/reactivated — only a true suspend-or-reactivate transition
  // here; approveUser() sends its own email for pending -> active.
  if (changes.status === 'suspended') {
    sendSuspensionEmail_(Object.assign({}, existing, changes));
  } else if (changes.status === 'active' && existing.status === 'suspended') {
    sendReactivationEmail_(Object.assign({}, existing, changes));
  }

  return { ok: true };
}

/**
 * Permanently remove a user account. IT_ADMIN only, and an admin can never
 * delete their own account — suspending is the reversible option; this
 * guardrail just stops every admin from ever locking themselves out.
 */
function deleteUser(token, userId) {
  const session = authorize_(token, [ROLES.IT_ADMIN]);
  if (userId === session.userId) throw new Error('You can\'t delete your own account.');
  const existing = getById('USERS', userId);
  if (!existing) throw new Error('No such user.');
  const isPending = existing.status === 'pending_verification' || existing.status === 'pending_approval';

  deleteRow('USERS', userId);
  // deleteRow() only invalidates the 'id' index — deleting a row shifts
  // every row after it up by one, which would silently stale-out any other
  // cached USERS index (email, verification_token, password_reset_token)
  // for those rows too.
  invalidateIndex_('USERS', 'email');
  invalidateIndex_('USERS', 'verification_token');
  invalidateIndex_('USERS', 'password_reset_token');
  invalidateListCache_('USERS');
  logActivity_(token, 'Delete user', 'Deleted ' + (ROLE_LABELS_[existing.role] || existing.role) + ' account: ' + existing.name + ' (' + existing.email + ')');

  // A pending applicant deleted here is a rejection; an active/suspended
  // account deleted here is a real removal — different wording for each.
  if (isPending) sendRejectionEmail_(existing); else sendAccountDeletedEmail_(existing);

  return { ok: true };
}

/**
 * One-time bootstrap — run manually from the Apps Script editor (never via
 * the web app) to create the first IT_ADMIN, since createUser() itself
 * requires an existing IT_ADMIN session. Edit the email/password below,
 * run once, log in, change the password, and leave this alone after that.
 */
function bootstrapFirstAdmin() {
  const email = 'info.jangafrica@gmail.com';
  const password = 'nssnsn@255252';
  const salt = Utilities.getUuid();

  insertRow('USERS', {
    name: 'IT Admin',
    email: email,
    password_hash: hashPassword_(password, salt),
    password_salt: salt,
    role: ROLES.IT_ADMIN,
    phone: '',
    status: 'active',
    created_by: 'bootstrap',
    created_at: new Date()
  });

  Logger.log('First IT_ADMIN created: ' + email + ' — log in once, then change the password.');
}

// ---------- PROJECT / ASSIGNMENT / REPORT CHAIN ----------
//
// Assignment chain: Manager records a project -> approveProject() (Manager)
// -> assignProject() (Admin Secretary) hands it to a Site Supervisor.
// Report chain: Site Supervisor submits daily reports against that project
// -> Admin Secretary reviews them -> flagCompletion() notifies the Manager.

/**
 * Manager records a new project against a site. Starts pending approval —
 * approveProject() is a separate, deliberate action, not implied by creation.
 */
function createProject(token, project) {
  const session = authorize_(token, [ROLES.MANAGER, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN]);
  if (!project.site_id || !project.name) throw new Error('site_id and name are required.');

  const id = insertRow('PROJECTS', {
    site_id: project.site_id,
    name: project.name,
    description: project.description || '',
    planned_start: project.planned_start || '',
    planned_end: project.planned_end || '',
    budget: project.budget || '',
    status: 'pending_approval',
    created_by: session.userId,
    approved_by: '',
    approved_at: ''
  });
  invalidateListCache_('PROJECTS');
  logActivity_(token, 'Create project', 'Project "' + project.name + '"');
  return { id: id };
}

/**
 * Edit an existing project's details (name, site, description, planned
 * dates, budget) — Manager, Admin Secretary, and IT Admin. Manager/Admin
 * Secretary are capped at MAX_SELF_SERVICE_EDITS_ edits per project; once
 * they hit that cap, only IT Admin can change it further. IT Admin's own
 * edits are unrestricted and never count against the cap.
 */
function updateProject(token, projectId, updates) {
  const session = authorize_(token, [ROLES.MANAGER, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN]);
  const existing = getById('PROJECTS', projectId);
  if (!existing) throw new Error('No such project.');

  const used = Number(existing.edit_count) || 0;
  if (session.role !== ROLES.IT_ADMIN && used >= MAX_SELF_SERVICE_EDITS_) {
    throw new Error('This project has already been edited ' + MAX_SELF_SERVICE_EDITS_ + ' times by Manager/Admin Secretary — only IT Admin can make further changes.');
  }

  const changes = {};
  ['name', 'site_id', 'description', 'planned_start', 'planned_end', 'budget'].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) changes[key] = updates[key];
  });
  if (session.role !== ROLES.IT_ADMIN) changes.edit_count = used + 1;

  updateRow('PROJECTS', projectId, changes);
  invalidateListCache_('PROJECTS');
  logActivity_(token, 'Update project', existing.name + (session.role === ROLES.IT_ADMIN ? ' (IT Admin, unrestricted)' : ' (edit ' + (used + 1) + ' of ' + MAX_SELF_SERVICE_EDITS_ + ')'));

  return { ok: true, edit_count: changes.edit_count !== undefined ? changes.edit_count : used };
}

/**
 * Permanently remove a project AND every record that only exists because of
 * it: assignments, completion notices, work plans (+ their tasks), and
 * daily reports (+ everything hung off a report — tasks, photos, expenses,
 * material/equipment usage, safety incidents, productivity actuals, and any
 * open issue raised from one of those reports). IT Admin only.
 *
 * Drive files referenced by deleted photo/receipt rows (photo_path/
 * receipt_path) are NOT deleted from Drive — only the Dynamic Builders
 * records that pointed at them are removed, so nothing already uploaded is
 * silently lost from storage.
 */
function deleteProject(token, projectId) {
  authorize_(token, [ROLES.IT_ADMIN]);
  const existing = getById('PROJECTS', projectId);
  if (!existing) throw new Error('No such project.');

  deleteRowsWhere_('PROJECT_ASSIGNMENTS', 'project_id', projectId);
  deleteRowsWhere_('COMPLETION_NOTICES', 'project_id', projectId);

  const planIds = deleteRowsWhere_('WORK_PLANS', 'project_id', projectId);
  planIds.forEach(function (planId) {
    deleteRowsWhere_('WORK_PLAN_TASKS', 'work_plan_id', planId);
  });

  const reportIds = deleteRowsWhere_('DAILY_REPORTS', 'project_id', projectId);
  reportIds.forEach(function (reportId) {
    deleteRowsWhere_('DAILY_REPORT_TASKS', 'daily_report_id', reportId);
    deleteRowsWhere_('DAILY_REPORT_PHOTOS', 'daily_report_id', reportId);
    deleteRowsWhere_('EXPENSES', 'daily_report_id', reportId);
    deleteRowsWhere_('MATERIAL_USAGE', 'daily_report_id', reportId);
    deleteRowsWhere_('EQUIPMENT_USAGE', 'daily_report_id', reportId);
    deleteRowsWhere_('SAFETY_INCIDENTS', 'daily_report_id', reportId);
    deleteRowsWhere_('PRODUCTIVITY_ACTUALS', 'daily_report_id', reportId);
    deleteRowsWhere_('OPEN_ISSUES', 'source_report_id', reportId);
  });

  deleteRow('PROJECTS', projectId);
  invalidateListCache_('PROJECTS');
  logActivity_(token, 'Delete project', existing.name + ' (' + projectId + ') — cascaded to ' +
    planIds.length + ' work plan(s) and ' + reportIds.length + ' daily report(s), plus their assignments/notices/tasks/photos/expenses/usage/incidents');

  return { ok: true };
}

/**
 * Edit an existing site's details — same Manager/Admin Secretary 3-edit cap
 * (per site) as updateProject(), with IT Admin unrestricted and exempt from
 * the counter.
 */
function updateSite(token, siteId, updates) {
  const session = authorize_(token, [ROLES.MANAGER, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN]);
  const existing = getById('SITES', siteId);
  if (!existing) throw new Error('No such site.');

  const used = Number(existing.edit_count) || 0;
  if (session.role !== ROLES.IT_ADMIN && used >= MAX_SELF_SERVICE_EDITS_) {
    throw new Error('This site has already been edited ' + MAX_SELF_SERVICE_EDITS_ + ' times by Manager/Admin Secretary — only IT Admin can make further changes.');
  }

  const changes = {};
  ['name', 'location', 'status', 'address', 'client_name', 'client_id', 'site_type', 'gps_coords', 'start_date', 'site_manager_id', 'notes'].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) changes[key] = updates[key];
  });
  if (session.role !== ROLES.IT_ADMIN) changes.edit_count = used + 1;

  updateRow('SITES', siteId, changes);
  invalidateListCache_('SITES');
  logActivity_(token, 'Update site', existing.name + (session.role === ROLES.IT_ADMIN ? ' (IT Admin, unrestricted)' : ' (edit ' + (used + 1) + ' of ' + MAX_SELF_SERVICE_EDITS_ + ')'));

  return { ok: true, edit_count: changes.edit_count !== undefined ? changes.edit_count : used };
}

/**
 * Permanently remove a site. IT Admin only, same reasoning as
 * deleteProject() above. Projects already recorded at this site are left
 * in place (their site_id just no longer resolves to a live site).
 */
function deleteSite(token, siteId) {
  authorize_(token, [ROLES.IT_ADMIN]);
  const existing = getById('SITES', siteId);
  if (!existing) throw new Error('No such site.');

  deleteRow('SITES', siteId);
  invalidateListCache_('SITES');
  logActivity_(token, 'Delete site', existing.name + ' (' + siteId + ')');

  return { ok: true };
}

/**
 * Edit an existing client/consultant record. Same roles as creating one
 * (insertRowSecure against WRITE_PERMISSIONS.CLIENTS) — no edit cap, unlike
 * SITES/PROJECTS, since a client record is contact details rather than
 * something worth rate-limiting changes to.
 */
function updateClient(token, clientId, updates) {
  authorize_(token, [ROLES.IT_ADMIN, ROLES.MANAGER, ROLES.ADMIN_SECRETARY]);
  const existing = getById('CLIENTS', clientId);
  if (!existing) throw new Error('No such client/consultant.');

  const changes = {};
  ['name', 'type', 'contact_name', 'phone', 'email', 'address', 'notes'].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) changes[key] = updates[key];
  });

  updateRow('CLIENTS', clientId, changes);
  invalidateListCache_('CLIENTS');
  logActivity_(token, 'Update client/consultant', existing.name);

  return { ok: true };
}

/**
 * Permanently remove a client/consultant record. IT Admin only, same
 * reasoning as deleteSite()/deleteProject() above. Sites that referenced
 * this client keep their client_id as-is (it just won't resolve to a live
 * record any more) — same non-cascading behaviour as deleteSite().
 */
function deleteClient(token, clientId) {
  authorize_(token, [ROLES.IT_ADMIN]);
  const existing = getById('CLIENTS', clientId);
  if (!existing) throw new Error('No such client/consultant.');

  deleteRow('CLIENTS', clientId);
  invalidateListCache_('CLIENTS');
  logActivity_(token, 'Delete client/consultant', existing.name + ' (' + clientId + ')');

  return { ok: true };
}

/**
 * Approves a project before it can be assigned to a supervisor. Admin
 * Secretary has the same approval ability as Manager here — per Dynamic
 * Builders' "assistant does what the manager does" setup — while IT Admin
 * keeps its usual override access.
 */
function approveProject(token, projectId) {
  const session = authorize_(token, [ROLES.MANAGER, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN]);
  const project = getById('PROJECTS', projectId);
  updateRow('PROJECTS', projectId, { status: 'approved', approved_by: session.userId, approved_at: new Date() });
  invalidateListCache_('PROJECTS');
  logActivity_(token, 'Approve project', 'Project ' + projectId);

  if (project && project.created_by && project.created_by !== session.userId) {
    const creator = getById('USERS', project.created_by);
    if (creator && creator.email) {
      const link = frontendUrl_('projects/project.html?id=' + encodeURIComponent(projectId));
      sendSimpleEmail_(creator.email, 'Project approved — Dynamic Builders', [
        'Hi ' + creator.name + ',',
        'Your project "' + project.name + '" has been approved and is ready to be assigned to a site supervisor.',
        link ? { link: link, label: 'View project' } : null,
        '— Dynamic Builders'
      ]);
    }
  }

  return { ok: true };
}

/**
 * Update a project's manual progress figure (0-100), shown as a progress
 * bar wherever the project is listed. Same roles who can manage projects
 * generally; a Site Supervisor can also update progress on a project
 * they're assigned to, since they're the one who actually knows how far
 * along the work is day to day.
 */
function updateProjectProgress(token, projectId, progressPercent) {
  const session = authorize_(token, null);
  const pct = Math.max(0, Math.min(100, Math.round(Number(progressPercent) || 0)));
  if (session.role === ROLES.SITE_SUPERVISOR) {
    const assignments = getRowsByForeignKey_(token, 'PROJECT_ASSIGNMENTS', 'project_id', projectId);
    const isAssigned = assignments.some(function (a) { return a.supervisor_id === session.userId; });
    if (!isAssigned) throw new Error('You are not assigned to this project.');
  } else {
    authorize_(token, [ROLES.MANAGER, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN]);
  }
  updateRow('PROJECTS', projectId, { progress_percent: pct });
  invalidateListCache_('PROJECTS');
  return { ok: true, progress_percent: pct };
}

/** Admin Secretary assigns an approved project to a site supervisor. */
function assignProject(token, projectId, supervisorId) {
  const session = authorize_(token, [ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN]);
  const project = getById('PROJECTS', projectId);
  if (!project) throw new Error('No such project.');
  if (project.status !== 'approved') throw new Error('Project must be approved before it can be assigned.');

  const id = insertRow('PROJECT_ASSIGNMENTS', {
    project_id: projectId,
    supervisor_id: supervisorId,
    assigned_by: session.userId,
    assigned_at: new Date(),
    status: 'assigned'
  });
  updateRow('PROJECTS', projectId, { status: 'assigned' });
  invalidateListCache_('PROJECT_ASSIGNMENTS');
  invalidateListCache_('PROJECTS');
  logActivity_(token, 'Assign project', 'Project ' + projectId + ' to supervisor ' + supervisorId);

  const supervisor = getById('USERS', supervisorId);
  if (supervisor && supervisor.email) {
    const site = getById('SITES', project.site_id);
    const link = frontendUrl_('projects/project.html?id=' + encodeURIComponent(projectId));
    sendSimpleEmail_(supervisor.email, 'New project assigned — Dynamic Builders', [
      'Hi ' + supervisor.name + ',',
      'You\'ve been assigned to project "' + project.name + '"' + (site ? ' at ' + site.name : '') + '.',
      link ? { link: link, label: 'View project' } : null,
      '— Dynamic Builders'
    ]);
  }

  return { id: id };
}

/**
 * Admin Secretary reviews a project's daily reports and flags a completion
 * notice up to the Manager — where the report chain (Supervisor -> Admin
 * Secretary -> Manager) ends.
 */
function flagCompletion(token, projectId, notes) {
  const session = authorize_(token, [ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN]);
  const id = insertRow('COMPLETION_NOTICES', {
    project_id: projectId,
    flagged_by: session.userId,
    notes: notes || '',
    status: 'pending_review',
    created_at: new Date(),
    reviewed_at: ''
  });
  invalidateListCache_('COMPLETION_NOTICES');
  logActivity_(token, 'Flag completion', 'Project ' + projectId);

  const project = getById('PROJECTS', projectId);
  const managers = getActiveUsersByRoles_([ROLES.MANAGER]).filter(function (u) { return u.id !== session.userId; });
  const link = frontendUrl_('projects/project.html?id=' + encodeURIComponent(projectId));
  broadcastEmail_(managers, 'Completion notice flagged — Dynamic Builders', [
    session.name + ' flagged project "' + (project ? project.name : projectId) + '" as complete and needs your review.',
    link ? { link: link, label: 'View project' } : null,
    '— Dynamic Builders'
  ]);

  return { id: id };
}

/** Manager (or Admin Secretary, acting with the same authority) acknowledges a completion notice. */
function reviewCompletionNotice(token, noticeId) {
  const session = authorize_(token, [ROLES.MANAGER, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN]);
  const notice = getById('COMPLETION_NOTICES', noticeId);
  updateRow('COMPLETION_NOTICES', noticeId, { status: 'reviewed', reviewed_at: new Date() });
  invalidateListCache_('COMPLETION_NOTICES');
  logActivity_(token, 'Review completion notice', 'Notice ' + noticeId);

  if (notice && notice.flagged_by && notice.flagged_by !== session.userId) {
    const flagger = getById('USERS', notice.flagged_by);
    const project = getById('PROJECTS', notice.project_id);
    if (flagger && flagger.email) {
      const link = frontendUrl_('projects/project.html?id=' + encodeURIComponent(notice.project_id));
      sendSimpleEmail_(flagger.email, 'Completion notice reviewed — Dynamic Builders', [
        'Hi ' + flagger.name + ',',
        session.name + ' reviewed and acknowledged the completion notice for "' + (project ? project.name : notice.project_id) + '".',
        link ? { link: link, label: 'View project' } : null,
        '— Dynamic Builders'
      ]);
    }
  }

  return { ok: true };
}

/**
 * Last step of the report chain: Supervisor submits daily reports -> Admin
 * Secretary reviews them and flags completion -> Manager reviews (approves)
 * the notice -> Admin Secretary marks the project completed. Requires an
 * existing completion notice the Manager has already reviewed — this can't
 * be used to skip that approval step.
 */
function completeProject(token, projectId) {
  const session = authorize_(token, [ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN]);
  const project = getById('PROJECTS', projectId);
  if (!project) throw new Error('No such project.');

  const approved = listTable(token, 'COMPLETION_NOTICES').some(function (n) {
    return n.project_id === projectId && n.status === 'reviewed';
  });
  if (!approved) throw new Error('This project has no manager-approved completion notice yet.');

  updateRow('PROJECTS', projectId, { status: 'completed' });
  invalidateListCache_('PROJECTS');
  logActivity_(token, 'Complete project', 'Project ' + projectId);

  // Notify whoever's affected: the project's creator and whichever
  // supervisor was last assigned to it (if either exists and isn't the
  // person who just completed it).
  const notifyIds = {};
  if (project.created_by) notifyIds[project.created_by] = true;
  const assignments = getRowsByForeignKey_(token, 'PROJECT_ASSIGNMENTS', 'project_id', projectId);
  const latestAssignment = assignments[assignments.length - 1];
  if (latestAssignment && latestAssignment.supervisor_id) notifyIds[latestAssignment.supervisor_id] = true;
  delete notifyIds[session.userId];

  const link = frontendUrl_('projects/project.html?id=' + encodeURIComponent(projectId));
  Object.keys(notifyIds).forEach(function (userId) {
    const user = getById('USERS', userId);
    if (user && user.email) {
      sendSimpleEmail_(user.email, 'Project completed — Dynamic Builders', [
        'Hi ' + user.name + ',',
        'Project "' + project.name + '" has been marked completed.',
        link ? { link: link, label: 'View project' } : null,
        '— Dynamic Builders'
      ]);
    }
  });

  return { ok: true };
}

// ---------- SUPPORT TICKETS (IT Admin) ----------

/** Any logged-in role can raise an error/support ticket for IT Admin. */
function raiseTicket(token, ticket) {
  const session = authorize_(token, null);
  if (!ticket.description) throw new Error('description is required.');

  const id = insertRow('TICKETS', {
    raised_by: session.userId,
    category: ticket.category || 'error',
    description: ticket.description,
    status: 'open',
    assigned_to: '',
    resolution_notes: '',
    created_at: new Date(),
    resolved_at: '',
    screenshot_path: ticket.screenshot_path || ''
  });
  invalidateListCache_('TICKETS');
  logActivity_(token, 'Raise ticket', (ticket.category || 'error') + ': ' + ticket.description);

  sendTicketNotificationEmail_(session, { category: ticket.category || 'error', description: ticket.description });

  return { id: id };
}

/** Only IT_ADMIN resolves a ticket — this is part of "make sure system is running". */
function resolveTicket(token, ticketId, resolutionNotes) {
  const session = authorize_(token, [ROLES.IT_ADMIN]);
  const ticket = getById('TICKETS', ticketId);
  updateRow('TICKETS', ticketId, {
    status: 'resolved',
    assigned_to: session.userId,
    resolution_notes: resolutionNotes || '',
    resolved_at: new Date()
  });
  invalidateListCache_('TICKETS');
  logActivity_(token, 'Resolve ticket', 'Ticket ' + ticketId);

  if (ticket && ticket.raised_by) {
    const raiser = getById('USERS', ticket.raised_by);
    if (raiser && raiser.email) {
      sendSimpleEmail_(raiser.email, 'Your ticket has been resolved — Dynamic Builders', [
        'Hi ' + raiser.name + ',',
        'Your ' + (ticket.category || 'error') + ' ticket ("' + ticket.description + '") has been resolved.' +
          (resolutionNotes ? '\n\n' + resolutionNotes : ''),
        '— Dynamic Builders\n— IT Admin'
      ]);
    }
  }

  return { ok: true };
}

/**
 * Permanently remove a ticket. IT_ADMIN only — part of keeping the support
 * queue manageable (clearing out spam/duplicates/mistaken reports), not
 * something any other role needs to do.
 */
function deleteTicket(token, ticketId) {
  authorize_(token, [ROLES.IT_ADMIN]);
  const existing = getById('TICKETS', ticketId);
  if (!existing) throw new Error('No such ticket.');

  deleteRow('TICKETS', ticketId);
  invalidateListCache_('TICKETS');
  logActivity_(token, 'Delete ticket', 'Ticket ' + ticketId + ' (' + (existing.category || 'error') + ': ' + (existing.description || '') + ')');

  return { ok: true };
}

// ---------- BUNDLED REPORT / ENTRY FUNCTIONS ----------
//
// A supervisor's "one day of work" touches six tables (the report itself,
// plus expenses, material usage, equipment usage, safety incidents,
// productivity actuals). Without a bundled entry point, the frontend would
// need six separate calls — and six separate chances for one to fail while
// the others succeed. These bundle the writes (and, in reverse, the reads)
// into a single call each.

/**
 * Get every row in tableName where fkColumn equals fkValue. Built on top of
 * listTable()'s existing 60-second cache, so repeated lookups against the
 * same table (e.g. loading several reports' expenses in a row) don't cost a
 * fresh sheet read each time. Fine at the scale this system runs at; if a
 * child table ever grows into the tens of thousands of rows, this is the
 * place to swap in a proper grouped index instead of an in-memory filter.
 */
function getRowsByForeignKey_(token, tableName, fkColumn, fkValue) {
  return listTable(token, tableName).filter(function (row) {
    return row[fkColumn] === fkValue;
  });
}

/**
 * Write a full "Daily Work Plan" in one call — the tomorrow-facing plan a
 * supervisor sends the evening before (WORK_PLANS), plus its list of
 * planned tasks (WORK_PLAN_TASKS), e.g. "Plastering and finishing... -
 * 2 masons". Mirrors submitDailyReport()'s bundle-in-one-call shape.
 */
function submitWorkPlan(token, plan) {
  const session = authorize_(token, [ROLES.SITE_SUPERVISOR, ROLES.ADMIN_SECRETARY, ROLES.IT_ADMIN]);

  if (!plan.site_id || !plan.plan_date) {
    throw new Error('site_id and plan_date are required.');
  }

  const planId = insertRow('WORK_PLANS', {
    site_id: plan.site_id,
    project_id: plan.project_id || '',
    supervisor_id: plan.supervisor_id || session.userId,
    plan_date: plan.plan_date,
    weather: plan.weather || '',
    skilled_workers: plan.skilled_workers || '',
    labourers: plan.labourers || '',
    subcontractors: plan.subcontractors || '',
    total_workforce: plan.total_workforce || '',
    toolbox_talk: plan.toolbox_talk || false,
    ppe_check: plan.ppe_check || false,
    site_notes: plan.site_notes || '',
    target: plan.target || '',
    status: 'submitted',
    created_at: new Date()
  });

  const result = {
    id: planId,
    tasks: insertChildRows_('WORK_PLAN_TASKS', 'work_plan_id', planId, (plan.tasks || []).map(function (t, i) {
      return Object.assign({ seq: i + 1 }, t);
    }))
  };

  ['WORK_PLANS', 'WORK_PLAN_TASKS'].forEach(invalidateListCache_);

  notifyManagersOfSubmission_(session, 'work plan', plan.site_id, plan.plan_date, 'projects/daily-plan.html?id=' + encodeURIComponent(planId));

  return result;
}

/**
 * Shared by submitWorkPlan()/submitDailyReport(): every active Manager +
 * Admin Secretary (the two roles that review a supervisor's submissions)
 * gets a short "X submitted a Y for site Z" email, except the submitter
 * themselves if they happen to be one of those roles (e.g. Admin Secretary
 * filing a report on a supervisor's behalf).
 */
function notifyManagersOfSubmission_(session, kind, siteId, dateValue, linkPath) {
  const recipients = getActiveUsersByRoles_([ROLES.MANAGER, ROLES.ADMIN_SECRETARY])
    .filter(function (u) { return u.id !== session.userId; });
  if (!recipients.length) return;
  const site = getById('SITES', siteId);
  const link = frontendUrl_(linkPath);
  broadcastEmail_(recipients, 'New ' + kind + ' submitted — Dynamic Builders', [
    session.name + ' submitted a ' + kind + ' for ' + (site ? site.name : 'a site') + ' (' + dateValue + ').',
    link ? { link: link, label: 'View ' + kind } : null,
    '— Dynamic Builders'
  ]);
}

/**
 * Read a work plan and its tasks in a single call.
 */
function getWorkPlanDetail(token, planId) {
  authorize_(token, null);
  const plan = getById('WORK_PLANS', planId);
  if (!plan) throw new Error('No such work plan: ' + planId);

  return {
    plan: plan,
    tasks: getRowsByForeignKey_(token, 'WORK_PLAN_TASKS', 'work_plan_id', planId)
  };
}

/**
 * Write a full "Site Daily Report" in one call: the DAILY_REPORTS row
 * itself (manpower summary, toolbox talk/PPE/quality checks, problems and
 * delays, tomorrow's plan, reported-by signature line) plus whichever child
 * arrays are included — tasks (Tasks Today / Work Done Today),
 * materialUsage (with opening stock / received / used / balance),
 * equipmentUsage, photos (photo evidence), safetyIncidents and expenses.
 * Each child row is tagged with the new report's id automatically — the
 * caller never has to know or guess it. Authorization is checked once, up
 * front, for the whole bundle rather than once per table.
 */
function submitDailyReport(token, report) {
  const session = authorize_(token, WRITE_PERMISSIONS.DAILY_REPORTS);

  if (!report.site_id || !report.report_date) {
    throw new Error('site_id and report_date are required.');
  }

  const reportId = insertRow('DAILY_REPORTS', {
    site_id: report.site_id,
    project_id: report.project_id || '',
    supervisor_id: report.supervisor_id || session.userId,
    report_date: report.report_date,
    report_no: report.report_no || '',
    working_hours: report.working_hours || '',
    weather: report.weather || '',
    skilled_workers: report.skilled_workers || '',
    labourers: report.labourers || '',
    subcontractors: report.subcontractors || '',
    total_workforce: report.total_workforce || '',
    toolbox_talk: report.toolbox_talk || false,
    ppe_compliance: report.ppe_compliance || '',
    quality_inspection: report.quality_inspection || '',
    problems_delays: report.problems_delays || '',
    action_taken: report.action_taken || '',
    tomorrow_plan: report.tomorrow_plan || '',
    general_remarks: report.general_remarks || '',
    reported_by_name: report.reported_by_name || session.name,
    reported_by_role: report.reported_by_role || ROLE_LABELS_[session.role] || session.role,
    status: 'submitted',
    created_at: new Date()
  });

  const result = {
    id: reportId,
    tasks: insertChildRows_('DAILY_REPORT_TASKS', 'daily_report_id', reportId, (report.tasks || []).map(function (t, i) {
      return Object.assign({ seq: i + 1 }, t);
    })),
    photos: insertChildRows_('DAILY_REPORT_PHOTOS', 'daily_report_id', reportId, report.photos),
    expenses: insertChildRows_('EXPENSES', 'daily_report_id', reportId, report.expenses),
    materialUsage: insertChildRows_('MATERIAL_USAGE', 'daily_report_id', reportId, report.materialUsage),
    equipmentUsage: insertChildRows_('EQUIPMENT_USAGE', 'daily_report_id', reportId, report.equipmentUsage),
    safetyIncidents: insertChildRows_('SAFETY_INCIDENTS', 'daily_report_id', reportId, report.safetyIncidents)
  };

  ['DAILY_REPORTS', 'DAILY_REPORT_TASKS', 'DAILY_REPORT_PHOTOS', 'EXPENSES', 'MATERIAL_USAGE', 'EQUIPMENT_USAGE', 'SAFETY_INCIDENTS']
    .forEach(invalidateListCache_);

  notifyManagersOfSubmission_(session, 'daily report', report.site_id, report.report_date, 'projects/report.html?id=' + encodeURIComponent(reportId));

  return result;
}

/**
 * Save one Daily Report photo to Drive, in a subfolder named for its
 * project, and hand back the URLs to store on the DAILY_REPORT_PHOTOS row
 * (submitDailyReport() takes it from here — this only uploads the file
 * itself; it doesn't write any row). payload: { projectId, filename,
 * mimeType, dataBase64 }. Same write roles as DAILY_REPORT_PHOTOS itself,
 * since a photo with nowhere to attach isn't useful to anyone else.
 */
function uploadDailyReportPhoto(token, payload) {
  authorize_(token, WRITE_PERMISSIONS.DAILY_REPORT_PHOTOS);
  if (!payload.dataBase64) throw new Error('No photo data received.');

  const bytes = Utilities.base64Decode(payload.dataBase64);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Photo is too large (max 8MB after compression).');

  const blob = Utilities.newBlob(bytes, payload.mimeType || 'image/jpeg', payload.filename || 'photo.jpg');
  const subfolder = projectSubfolderName_(payload.projectId);
  const uploaded = uploadFile('DAILY_REPORT_PHOTOS', blob, subfolder);

  return { photo_path: uploaded.directUrl, driveUrl: uploaded.url, fileId: uploaded.id };
}

const ROLE_LABELS_ = {
  IT_ADMIN: 'IT Admin',
  MANAGER: 'Manager',
  ADMIN_SECRETARY: 'Admin Secretary',
  SITE_SUPERVISOR: 'Site Supervisor'
};

function insertChildRows_(tableName, fkColumn, fkValue, rows) {
  if (!rows || !rows.length) return [];
  return rows.map(function (row) {
    const tagged = {};
    tagged[fkColumn] = fkValue;
    return insertRow(tableName, Object.assign({}, row, tagged));
  });
}

/**
 * Read a daily report and every one of its child rows in a single call,
 * instead of the frontend making several separate list requests and
 * filtering each one client-side.
 */
function getDailyReportDetail(token, reportId) {
  authorize_(token, null);
  const report = getById('DAILY_REPORTS', reportId);
  if (!report) throw new Error('No such daily report: ' + reportId);

  return {
    report: report,
    tasks: getRowsByForeignKey_(token, 'DAILY_REPORT_TASKS', 'daily_report_id', reportId),
    photos: getRowsByForeignKey_(token, 'DAILY_REPORT_PHOTOS', 'daily_report_id', reportId),
    expenses: getRowsByForeignKey_(token, 'EXPENSES', 'daily_report_id', reportId),
    materialUsage: getRowsByForeignKey_(token, 'MATERIAL_USAGE', 'daily_report_id', reportId),
    equipmentUsage: getRowsByForeignKey_(token, 'EQUIPMENT_USAGE', 'daily_report_id', reportId),
    safetyIncidents: getRowsByForeignKey_(token, 'SAFETY_INCIDENTS', 'daily_report_id', reportId)
  };
}

/**
 * Read a project plus its assignment(s), a rollup of the daily reports
 * logged against it, and any completion notices — the shape a project or
 * site dashboard actually wants, in one call instead of four.
 */
function getProjectOverview(token, projectId) {
  authorize_(token, null);
  const project = getById('PROJECTS', projectId);
  if (!project) throw new Error('No such project: ' + projectId);

  const dailyReports = getRowsByForeignKey_(token, 'DAILY_REPORTS', 'project_id', projectId);

  return {
    project: project,
    assignments: getRowsByForeignKey_(token, 'PROJECT_ASSIGNMENTS', 'project_id', projectId),
    reportCount: dailyReports.length,
    latestReport: dailyReports.length ? dailyReports[dailyReports.length - 1] : null,
    completionNotices: getRowsByForeignKey_(token, 'COMPLETION_NOTICES', 'project_id', projectId)
  };
}

/**
 * A minimal, role-safe list of active users filtered by role — e.g. Admin
 * Secretary needs to see which Site Supervisors exist to assign a project
 * to, without being handed the full USERS table (emails included) that
 * listTable() reserves for IT_ADMIN/MANAGER. Only id and name leave the
 * server here, regardless of who's asking.
 */
function listUsersByRole(token, role) {
  authorize_(token, [ROLES.IT_ADMIN, ROLES.MANAGER, ROLES.ADMIN_SECRETARY]);

  const columns = SCHEMA.USERS;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('USERS');
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, columns.length).getValues() : [];

  return rows
    .map(function (row) {
      const record = {};
      columns.forEach(function (col, i) { record[col] = row[i]; });
      return record;
    })
    .filter(function (u) { return u.role === role && u.status === 'active'; })
    .map(function (u) { return { id: u.id, name: u.name }; });
}

/** A Site Supervisor's own project assignments, each with its project attached. */
function listMyAssignments(token) {
  const session = authorize_(token, [ROLES.SITE_SUPERVISOR, ROLES.IT_ADMIN]);
  const assignments = getRowsByForeignKey_(token, 'PROJECT_ASSIGNMENTS', 'supervisor_id', session.userId);
  return assignments.map(function (a) {
    return Object.assign({}, a, { project: getById('PROJECTS', a.project_id) });
  });
}

// ---------- SECURE READ/WRITE WRAPPERS ----------

/**
 * Insert into any table, but only if the caller's role is permitted to
 * write to that table. The API layer always goes through this — never
 * insertRow() directly — so a permission check can't be skipped by mistake.
 */
function insertRowSecure(token, tableName, record) {
  const allowedRoles = WRITE_PERMISSIONS[tableName];
  if (!allowedRoles) throw new Error('Unknown table: ' + tableName);
  authorize_(token, allowedRoles);
  const id = insertRow(tableName, record);
  invalidateListCache_(tableName);
  return id;
}

const LIST_CACHE_TTL_SECONDS = 60; // dashboards re-hitting a table get a cached read, not a fresh sheet scan

/**
 * Read every row of a table, cached briefly so a dashboard re-polling the
 * same table doesn't re-read the sheet on every request. USERS is
 * IT_ADMIN/MANAGER only, and always has its password fields stripped before
 * it leaves the server, however it's requested.
 */
function listTable(token, tableName) {
  authorize_(token, tableName === 'USERS' ? USERS_READ_ROLES : null);

  const cache = CacheService.getScriptCache();
  const cacheKey = 'list_' + tableName;
  const cached = cache.get(cacheKey);
  if (cached) return sanitize_(tableName, JSON.parse(cached));

  const columns = SCHEMA[tableName];
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(tableName);
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, columns.length).getValues() : [];

  const records = rows.map(function (row) {
    const record = {};
    columns.forEach(function (col, i) { record[col] = row[i]; });
    return record;
  });

  try {
    cache.put(cacheKey, JSON.stringify(records), LIST_CACHE_TTL_SECONDS);
  } catch (e) {
    // Too big for one cached blob — past this point a table needs its
    // dashboard to filter by site/date rather than pulling everything.
  }

  return sanitize_(tableName, records);
}

function sanitize_(tableName, records) {
  if (tableName !== 'USERS') return records;
  return records.map(function (r) {
    const copy = Object.assign({}, r);
    delete copy.password_hash;
    delete copy.password_salt;
    // A still-valid verification token is effectively a login bypass (it's
    // how verifyEmail() confirms ownership of the account) — never let it
    // leave the server via the generic list/USERS read, same as the
    // password fields above.
    delete copy.verification_token;
    delete copy.password_reset_token;
    return copy;
  });
}

function invalidateListCache_(tableName) {
  CacheService.getScriptCache().remove('list_' + tableName);
}

// ---------- WEB APP API ----------
//
// CORS note: Apps Script web apps can't respond to the OPTIONS preflight a
// browser sends before a JSON POST. Call it as a "simple request" instead —
// Content-Type text/plain, not application/json — and it still parses fine
// as JSON server-side:
//
//   fetch(WEB_APP_URL, {
//     method: 'POST',
//     headers: { 'Content-Type': 'text/plain;charset=utf-8' },
//     body: JSON.stringify({ action: 'login', payload: { email, password } })
//   }).then(r => r.json())
//
// Use POST for every action, including reads — a GET puts the token in the
// URL (and in server logs), which a POST body avoids.

function doPost(e) {
  return handleRequest_(e);
}

function doGet(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  let result;
  try {
    const body = e.postData ? JSON.parse(e.postData.contents) : (e.parameter || {});
    const action = body.action;
    const token = body.token;
    const payload = body.payload || {};

    switch (action) {
      case 'login':
        result = login(payload.email, payload.password);
        break;
      case 'logout':
        result = logout(token);
        break;
      case 'registerAccount':
        result = registerAccount(payload);
        break;
      case 'verifyEmail':
        result = verifyEmail(payload.token);
        break;
      case 'resendVerification':
        result = resendVerification(payload.email);
        break;
      case 'requestPasswordReset':
        result = requestPasswordReset(payload.email);
        break;
      case 'checkPasswordResetToken':
        result = checkPasswordResetToken(payload.token);
        break;
      case 'resetPassword':
        result = resetPassword(payload.token, payload.password);
        break;
      case 'approveUser':
        result = approveUser(token, payload.userId, payload.role);
        break;
      case 'createUser':
        result = createUser(token, payload);
        break;
      case 'updateUser':
        result = updateUser(token, payload.userId, payload);
        break;
      case 'deleteUser':
        result = deleteUser(token, payload.userId);
        break;
      case 'insert':
        result = { id: insertRowSecure(token, payload.table, payload.record) };
        break;
      case 'createProject':
        result = createProject(token, payload);
        break;
      case 'updateProject':
        result = updateProject(token, payload.projectId, payload);
        break;
      case 'deleteProject':
        result = deleteProject(token, payload.projectId);
        break;
      case 'updateSite':
        result = updateSite(token, payload.siteId, payload);
        break;
      case 'deleteSite':
        result = deleteSite(token, payload.siteId);
        break;
      case 'updateClient':
        result = updateClient(token, payload.clientId, payload);
        break;
      case 'deleteClient':
        result = deleteClient(token, payload.clientId);
        break;
      case 'updateProjectProgress':
        result = updateProjectProgress(token, payload.projectId, payload.progressPercent);
        break;
      case 'approveProject':
        result = approveProject(token, payload.projectId);
        break;
      case 'assignProject':
        result = assignProject(token, payload.projectId, payload.supervisorId);
        break;
      case 'flagCompletion':
        result = flagCompletion(token, payload.projectId, payload.notes);
        break;
      case 'reviewCompletionNotice':
        result = reviewCompletionNotice(token, payload.noticeId);
        break;
      case 'completeProject':
        result = completeProject(token, payload.projectId);
        break;
      case 'raiseTicket':
        result = raiseTicket(token, payload);
        break;
      case 'resolveTicket':
        result = resolveTicket(token, payload.ticketId, payload.resolutionNotes);
        break;
      case 'deleteTicket':
        result = deleteTicket(token, payload.ticketId);
        break;
      case 'submitWorkPlan':
        result = submitWorkPlan(token, payload);
        break;
      case 'getWorkPlanDetail':
        result = getWorkPlanDetail(token, payload.planId);
        break;
      case 'submitDailyReport':
        result = submitDailyReport(token, payload);
        break;
      case 'getDailyReportDetail':
        result = getDailyReportDetail(token, payload.reportId);
        break;
      case 'uploadDailyReportPhoto':
        result = uploadDailyReportPhoto(token, payload);
        break;
      case 'getProjectOverview':
        result = getProjectOverview(token, payload.projectId);
        break;
      case 'listUsersByRole':
        result = listUsersByRole(token, payload.role);
        break;
      case 'listMyAssignments':
        result = listMyAssignments(token);
        break;
      case 'getUserProfile':
        result = getUserProfile(token, payload.userId);
        break;
      case 'getSiteOverview':
        result = getSiteOverview(token, payload.siteId);
        break;
      case 'getMonthlyReviewDetail':
        result = getMonthlyReviewDetail(token, payload.reviewId);
        break;
      case 'getAuditLog':
        result = getAuditLog(token);
        break;
      case 'uploadTicketScreenshot':
        result = uploadTicketScreenshot(token, payload);
        break;
      case 'getById':
        // USERS gets the same gate as listTable()/USERS_READ_ROLES, plus the
        // password fields are stripped regardless of role — nothing on the
        // frontend ever needs them, and this is a generic by-id lookup, not
        // the login path.
        if (payload.table === 'USERS') {
          authorize_(token, USERS_READ_ROLES);
          result = getById(payload.table, payload.id);
          if (result) {
            result = Object.assign({}, result);
            delete result.password_hash;
            delete result.password_salt;
            delete result.verification_token;
            delete result.password_reset_token;
          }
        } else {
          authorize_(token, null);
          result = getById(payload.table, payload.id);
        }
        break;
      case 'list':
        result = listTable(token, payload.table);
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }

    return jsonResponse_({ ok: true, data: result });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
