# Dynamic Builders — dashboards

Plain HTML/JS, no build step, no framework — meant to be pushed straight into
a GitHub repo and served with GitHub Pages (or any static host).

## Folder layout

```
index.html, register.html, verify.html, pending.html,
forgot-password.html, reset-password.html   login & account pages (site root)
dashboards/   it-admin, manager, admin-secretary, site-supervisor
projects/     project, daily-plan, report, weekly-review, monthly-review
sites/        site, map, clients, client
resources/    materials, equipment, productivity-targets
people/       user, kpi
css/          style.css
js/           config, dialog, charts, analytics, ga, pwa
icons/        logo.png (add your own; it isn't in this copy)
apps-script/  Code.gs, Auth.gs, Views.gs (backend, pasted into Apps Script, not uploaded to Pages)
sw.js, manifest.json   must stay at the site root
```

Every page inside a subfolder starts with `<base href="../">`, so all its
links, scripts and styles are written relative to the site root
(`css/style.css`, `projects/project.html?id=...`), exactly like the pages
at the root. That's why `config.js` and the email links in `Auth.gs` can use
the same paths from anywhere. Keep that tag if you add a new page to a
subfolder. Upload the whole folder structure as-is (GitHub Pages serves the
subfolders automatically); the file list below still describes each page
by its file name.

## Files

- `index.html` — email + password login, routes each role to its own dashboard (or to `pending.html` for a verified-but-not-yet-approved account); links to `register.html`.
- `register.html` — public sign-up form (name, email, phone, password, and which role you're applying for). No login needed to reach it. See "Self-service account registration" below.
- `verify.html` — the page the emailed verification link opens (`?token=...`); confirms the email and offers "Resend verification email" if the link is invalid/expired.
- `forgot-password.html` — reached from the **Reset password** link on the login page; asks for the account's email and sends a password reset link. See "Forgot password / password reset" below.
- `reset-password.html` — the page the emailed reset link opens (`?token=...`); lets the person choose a new password, or tells them the link is expired/used and offers to send a new one.
- `pending.html` — where a verified-but-not-yet-approved account lands after logging in: their own profile info only, an "awaiting approval" status, Refresh and Log out. No dashboard, no other data.
- `it-admin.html` — add, edit, suspend/reactivate, and delete user accounts; **approve** self-registered applicants and assign their role; work the support-ticket queue (receive, resolve, **delete**); review the system-wide **Audit log**; print a user's details or a new/reset password as a credentials slip (see "Audit log" and "Printable user details & credentials" below). Every dashboard now opens on an **Overview** tab with its summary stat cards, kept out of every other tab; "Add a user" is a **+ Add user** popup (`uiForm`) on the Users tab instead of its own tab.
- `manager.html` — register sites, record projects and approve plans, manage the materials/equipment/productivity-target catalogs, review site supervisors' daily plans, approve completion notices flagged by the admin secretary, record monthly site reviews and supervisor evaluations, and a **Tickets** tab for the issues this Manager has personally raised. Every "add/record" form (project, site, material, equipment, productivity target, monthly review, evaluation, ticket) is now a **+ button → popup dialog** on the relevant list tab, rather than a separate tab with an always-open form. Projects and sites also get an **Edit** button, capped at 3 uses each (see "Editing limits on sites & projects" below).
- `admin-secretary.html` — has every ability Manager has (recording projects, registering sites, approving projects, managing the resource catalogue, monthly reviews, supervisor evaluations) in addition to its own job: assign approved projects to supervisors, review supervisors' daily reports, record weekly site reviews, flag completions for the manager to approve, then mark manager-approved projects completed; also has its own **Tickets** tab. Admin Secretary is the Manager's assistant, so the two dashboards are intentionally close to each other, including the same + button/popup pattern for every add form, and the same 3-edit cap on projects and sites.
- `site-supervisor.html` — submit a full daily report (crew count, weather, % complete, plus expenses/materials/equipment/safety/productivity rows, with real photo attachments) in one action, browse past reports, and a **Tickets** tab for issues raised. A read-only **My projects** tab lists the projects they supervise with progress bars. Work plan and daily report submission are **+ WORK PLAN** / **+ REPORT** popups now (see "Forms are popups, not tabs" below) rather than their own tabs.
- `project.html` — a project's own interactive page (`?id=...`): details, assigned supervisors, work plans, daily reports, completion notices, printable plan/report documents, a progress bar (see "Project progress" below), a clickable **Site** link, and **Edit**/**Delete** buttons (see "Editing limits on sites & projects" below).
- `site.html` — a site's own interactive page (`?id=...`): full site detail (address, a clickable **client/consultant** link, site type, a clickable **GPS coordinates** link to the Map page, start date, site manager, notes), every project recorded at that site, its productivity targets, its weekly/monthly reviews, and **Edit**/**Delete** buttons (see "Editing limits on sites & projects" below).
- `daily-plan.html` — one Daily Work Plan's own page (`?id=...`), printable.
- `report.html` — one Daily Site Report's own page (`?id=...`), printable, with its photo evidence.
- `weekly-review.html` — one Weekly Review's own page (`?id=...`), printable.
- `monthly-review.html` — one Monthly Review's own page (`?id=...`), printable, with the supervisor evaluations recorded against it.
- `materials.html` 🧱 / `equipment.html` 🛠️ / `productivity-targets.html` 🎯 — the three resource catalogues, each its own page (replacing the old combined `catalogue.html`), viewable by any logged-in role. Each has a single switchable **+ RESOURCES** popup for adding to any of the three catalogues — see "Resource catalogues, split into their own pages" below. The Materials/Equipment/Productivity targets buttons on Manager's and Admin Secretary's Resources tab, and each page's own heading, now carry a matching icon so the three are easy to tell apart at a glance.
- `clients.html` — every client/consultant on file, with a **+ Add client/consultant** popup. `client.html` (`?id=...`) is one client/consultant's own page: contact details and every site linked to them. See "Clients & consultants" below.
- `map.html` — every site with GPS coordinates recorded, pinned on a real **satellite map** by default (Esri World Imagery via Leaflet, with a switcher to an OpenStreetMap street view — no API key needed for either); accepts plain "lat, lng" or a Google Plus Code like "56RV+P62, Gunjur". `?site=...` centers and opens that one site's pin. See "Site map & clickable GPS coordinates" below.
- `user.html` — one user's own profile page (`?id=...`): account details, assigned projects, activity, supervisor evaluations; IT Admin can edit/suspend/delete from here too, and can print the account's details or, right after a password reset, a credentials slip.
- `kpi.html` — one user's individual KPI dashboard (`?userId=...`): plans/reports submitted, follow-through, compliance donuts, weekly activity, evaluation history. Open to every role now, not just Site Supervisors (see "KPI for every role" below); IT Admin gets a **Print** button to print whichever user's KPI is on screen.
- `config.js` — shared API client, session handling, small DOM helpers (including the `xLink()` family that turns a project/site/client/user/plan/report/review id into a link to its own page, and remembers which dashboard tab it was clicked from — see "Back button returns to the right tab" below), the shared `setupResourceForm()` behind every "+ RESOURCES" popup, and `addClientFlow()`/`gpsLink()` behind the client-adding and map-opening flows. Loaded by every page.
- `dialog.js` — themed alert/confirm/prompt/form popups (`uiForm` supports a `type: 'file'` field for photo/screenshot attachments), plus `uiHostDialog()` for turning an existing page section into a popup without rewriting it (see "Forms are popups, not tabs" below).
- `charts.js` / `analytics.js` — the shared Analytics tab (donut/column/line/bar charts, per-supervisor KPI rollup) used by IT Admin, Manager and Admin Secretary; IT Admin also gets a **System usage** section built from the Audit log (see "Tracking usage & activity" below).
- `style.css` — shared visual style, including the printable-document and photo-grid layouts.
- `ga.js` — optional Google Analytics 4 loader, one `<script>` tag on every page. Does nothing until you fill in a Measurement ID (see "Tracking usage & activity" below).

## Project progress

`PROJECTS` picked up a `progress_percent` column (0-100, manually set — not
derived from anything). It shows as a small progress bar wherever a project
is listed (Manager and Admin Secretary's project tables, `project.html`'s
stat grid). Clicking the bar opens a number prompt and saves the new value
via `updateProjectProgress` — allowed for IT Admin, Manager, Admin Secretary,
and the Site Supervisor actually assigned to that project (they're the one
who knows how far along the work really is day to day).

## Sidebar now scrolls

`.sidebar` gained `overflow-y: auto` so a dashboard with a long nav list
(more tabs than fit the viewport) scrolls the sidebar itself instead of
pushing Logout off-screen with no way to reach it. `Report an issue` /
`Log out` stay pinned at the bottom of whatever room is left.

## Forms are popups, not tabs

Every "add a record" form in the app opens as a popup now — there are no
more always-visible tabs or always-open inline forms anywhere.

Simple forms (add user, record project, register site, add
material/equipment/productivity target, record a monthly/weekly review,
evaluate a supervisor) use the themed `uiForm` popup from `dialog.js`,
triggered by a **+ button** that sits directly on the tab that lists those
records (e.g. "+ Record project" on the Projects tab).

The Daily Work Plan and Daily Site Report forms are long, multi-section
forms — photo pickers, repeating task/material/equipment rows — that don't
fit `uiForm`'s simple one-field-at-a-time layout, so they used to be kept
as their own standalone tabs. They're popups too now, via a new
`uiHostDialog()` helper in `dialog.js`: instead of describing the form as
data (like `uiForm` does), it picks up the *actual* `#submitplan` /
`#submit` section — repeaters, photo previews, validation and all — moves
it into the same modal chrome the other dialogs use, and puts it back
exactly where it was when the dialog closes. Nothing about how those forms
work changed, only where they're shown: a **+ WORK PLAN** button on the
"My work plans" tab and a **+ REPORT** button on "My reports" (Site
Supervisor dashboard) open them, and each one auto-closes a couple of
seconds after a successful submit so you can see the "submitted" message
before the popup goes away. `uiHostDialog(el, { title, onClose })` returns
`{ close() }` and is reusable anywhere else a big existing section needs to
become a popup without being rewritten.

Inside that popup, every repeating row (planned activities, tasks,
materials, equipment, safety, photo evidence) now stacks **one field per
line, full width**, rather than trying to fit several short fields side by
side — the popup is narrower than the full page, so fitting many fields in
a row left each one too small to read while typing. Text and number inputs
inside the popup are also a touch larger (bigger padding and font-size).
This applies everywhere the Work Plan / Daily Report popups are used, since
they're the same shared `#submitplan` / `#submit` sections either way.

Manager and Admin Secretary's **Resource catalogs** tab is now a plain
summary (counts of materials / equipment / productivity targets) with
buttons linking to the three catalogue pages, instead of showing the full
tables and add-forms inline — see "Resource catalogues, split into their
own pages" below for how adding to them now works.

## Overview tab

Every dashboard (IT Admin, Manager, Admin Secretary, Site Supervisor) now
opens on its own **Overview** tab holding the summary stat cards. Previously
those cards sat outside the tab system entirely and showed on every tab at
once; now they're scoped to Overview only, and each dashboard is the
default tab a person lands on after logging in.

Site Supervisor has its own **My projects** tab — the projects they
supervise, with site, status and a progress bar — read-only (no click to
edit, since updating progress is a Manager/Admin Secretary/IT Admin
action). Supervisors could already open any of their projects via "My work
plans"/"My reports" links, but this gives them the at-a-glance view without
drilling in. (It used to be folded into Overview; it's a tab of its own now.)

## KPI for every role

`kpi.html` was previously reachable only for Site Supervisors. It's now
open to any role — every dashboard has a **My KPI** link in its sidebar
(pointing at your own `?userId=...`). This link is deliberately set up
*before* `setupSidebarTabs()` runs on each dashboard, since that function
only takes over nav items whose `href` starts with `#` — giving it the
real `kpi.html?userId=...` URL first keeps it a normal link instead of a
tab, so clicking it navigates to your KPI page rather than switching tabs.
If it ever seems to land back on Overview instead, a hard refresh
(or clearing the site's cache) should rule out an old cached copy of
`config.js`/the dashboard page being the cause.

`user.html`'s "View KPI" button now shows for every account, not just
supervisors'. Work-plan/report-based
figures (follow-through, workforce, compliance donuts) read as zero or
"—" for a role that doesn't submit those, which is accurate rather than
broken — projects held and supervisor evaluations still show normally for
anyone who has them. IT Admin additionally gets a **Print** button on this
page (see "Printable user details & credentials" below) to print whichever
user's KPI summary is currently on screen, for the currently selected week
range.

## Tickets, everywhere

Every dashboard (Manager, Admin Secretary, Site Supervisor) now has its own
**Tickets** tab — a **+ TICKET ⚠** button to raise one (the same popup
"Report an issue" already used, description plus an optional screenshot),
and a list of every ticket *you've* raised with its status and, once
resolved, IT's resolution notes. The sidebar's "Report an issue" quick
action still works exactly as before, for raising one without switching
tabs. IT Admin's own Tickets tab is unchanged — it already shows every
ticket from everyone, including IT Admin's own.

IT Admin can now also **delete** a ticket outright (`deleteTicket`, IT
Admin only) — for spam, duplicates, or a ticket raised by mistake — logged
to the Audit log below like any other IT Admin action.

## Editing limits on sites & projects

Manager and Admin Secretary can now edit a site's or a project's own
details — not just add new ones. Both `SITES` and `PROJECTS` picked up an
`edit_count` column, and each time Manager or Admin Secretary saves a
change via **Edit** (on the Projects/Sites tables in their own dashboards,
or on `project.html`/`site.html`), that count goes up by one — capped at
**3 edits per record**. Once a given project or site has used its 3 edits,
the Edit button says "Edit (limit reached)" and the server (`updateProject`
/`updateSite` in `Auth.gs`) refuses any further change from those two
roles, pointing them to IT Admin.

**IT Admin is exempt from this entirely** — IT Admin's own edits never
increment `edit_count` and are never blocked by it, so IT Admin can always
make further changes no matter how many edits Manager/Admin Secretary have
already used. IT Admin reaches project editing from `project.html` (an
**Edit** button next to the project name, with no edit limit shown) and
site editing from `site.html` the same way.

**IT Admin can also permanently delete a project or a site** (`deleteProject`
/`deleteSite`, both IT Admin only) — from the **Delete** button on
`project.html`/`site.html`. Manager and Admin Secretary never get a delete
button for either — editing (within their cap) is as far as their access
goes; deleting is IT Admin's call alone. Deleting a project **does
cascade**: its assignments, completion notices, work plans (and their
tasks), and daily reports (and everything recorded against them — tasks,
photos, expenses, material/equipment usage, safety incidents, productivity
actuals, and any open issue raised from one of those reports) are deleted
along with it (`deleteRowsWhere_()` in Code.gs). Drive files referenced by
deleted photo/receipt rows are left in Drive untouched — only the Dynamic
Builders records are removed. Deleting a site does NOT cascade — its
projects are left in place (they just no longer resolve to a live site).

## Resource catalogues, split into their own pages

Materials, Equipment and Productivity Targets used to share one page
(`catalogue.html`) with three separate add-forms. That page is gone —
replaced by three focused pages, `materials.html`, `equipment.html` and
`productivity-targets.html` — each just its own table, readable by any
logged-in role.

Manager and Admin Secretary's **Resource catalogs** tab is now purely a
summary (the three counts) with **Materials** / **Equipment** /
**Productivity targets** buttons linking to those pages — it no longer
shows any table or add-form inline.

Adding to any of the three catalogues happens through a single switchable
**+ RESOURCES** popup, present on all three pages: it opens with a Type
dropdown (Material / Equipment / Productivity target) defaulted to whichever
catalogue you're on, and picking a different type swaps the fields shown
without closing the popup — so from, say, `materials.html` you can still
add a piece of equipment without navigating away. One shared function,
`setupResourceForm()` in `config.js`, drives the type-switching and submit
logic on all three pages so it isn't tripled.

## Clients & consultants

`SITES` used to record a client/consultant as a single free-text
`client_name` field. There's now a real `CLIENTS` table (name, type —
client or consultant — contact person, phone, email, address, notes) and
`SITES.client_id` links to it; `client_name` is kept only so sites recorded
before this change still show the old text until someone edits them onto a
real client record.

The site add/edit form's "Client / consultant" field is a dropdown of
existing clients plus a **+ Add new client/consultant…** option — picking
it opens a small popup to create the client right there (`addClientFlow()`
in `config.js`), and the new client is selected automatically once saved,
no need to reopen the site form. Wherever a site shows its client, the name
is a clickable link (`client.html?id=...`) to that client's own page: full
contact details and every site linked to them. `clients.html` lists every
client/consultant on file with its own **+ Add client/consultant** button,
linked from the Sites tab on Manager/Admin Secretary's dashboards.

Editing a client (`updateClient`) is open to IT Admin, Manager and Admin
Secretary with no edit cap (unlike sites/projects — a contact record isn't
something worth rate-limiting changes to); deleting one (`updateClient`'s
counterpart `deleteClient`) is IT Admin only, and doesn't cascade — a site
that referenced a deleted client just stops resolving to a live record,
same as a deleted site's projects above.

## Site map & clickable GPS coordinates

A site's GPS coordinates are a clickable value wherever they're shown —
clicking asks "Open this location on the map?" and, on confirming, opens
`map.html?site=<id>`. `map.html` plots every site that has a recognisable
GPS value as a pin, opens with a **real satellite view** by default (Esri
World Imagery, no API key needed), and has a layer switcher (top right of
the map) to flip to an OpenStreetMap street map instead. Each pin's popup
names the site, its client, its recorded GPS value, and links back to
`site.html`. Opened with `?site=...` it centers and opens that one site's
pin; opened plain (there's also a **Map** link in every dashboard's
sidebar) it fits all of them in view.

**`SITES.gps_coords` accepts two formats:**
1. A plain `"lat, lng"` pair, e.g. `"13.2167, -16.7500"`.
2. A **Google Plus Code**, either a full code on its own, or a *short* code
   plus a locality to disambiguate it — exactly the format Google Maps
   shows for an address, e.g. `"56RV+P62, Gunjur"`. An extra label is fine
   anywhere in the value too (e.g. `"JangAfrika, 56RV+P62, Gunjur"`) — the
   parser checks every comma-separated part for one that's actually a valid
   Plus Code, rather than assuming it's always the first part, and treats
   everything else as locality text. Decoding is done
   entirely client-side with Google's own open-source `open-location-code`
   library (loaded from a CDN, no API key): a full code decodes straight
   to coordinates; a short code's locality text is first looked up with
   OpenStreetMap's free Nominatim geocoder to get a rough reference point,
   then the short code is widened to a full one and decoded from there.
   `map.html` shows a small notice when it had to fall back to this
   locality lookup for any pin, since that pin's position is only as
   precise as the locality (widen the stored code to a full Plus Code, or
   switch it to a plain "lat, lng" pair, for a pinpoint-accurate location).

A GPS value that's blank, or doesn't parse as either format, simply gets no
pin — nothing breaks, it's just not on the map.

**A search box above the map** lets you type a site's name or location to
find it — a dropdown lists matches as you type, and clicking one (or
pressing Enter) pans/zooms the map to that site's pin and opens its popup,
the same place clicking the pin itself takes you. It only searches sites
that actually have a pin (ones without a resolvable GPS value aren't on the
map to jump to).

**Opening a single site (`?site=...`) also shows a real embedded Google
Map** above the satellite/street map, in a small panel titled "This site on
Google Maps" with its own **Open in Google Maps ↗** and **Get directions
↗** links. This uses Google's classic no-API-key embed URL
(`https://maps.google.com/maps?q=<lat>,<lng>&z=17&output=embed` in an
`<iframe>`) — the same trick countless sites use to drop a Google Map onto
a page without signing up for billing. It's shown only for the one focused
site, not the full multi-site overview, since Google's embed takes a single
point, not a list of pins. The Esri/Leaflet map below it still shows every
site and still has the satellite/street switcher either way.

Every pin's popup, and now this embed panel too, link straight out to
Google Maps for an actual **View**/**Get directions** — those are plain
Google Maps navigation URLs (`google.com/maps/search/...` and
`google.com/maps/dir/...`), not the paid JS API, so they've never needed a
key.

**No API key is needed for any of this** — satellite imagery, street tiles,
Plus Code decoding, and locality geocoding are all free public services.
The one thing that would improve on it is a Google Maps API key: Google's
own satellite tiles are sharper in many areas than Esri's free imagery, and
Google's geocoder is more accurate than Nominatim for short Plus Codes in
places Nominatim covers thinly. If a key becomes available, the `satellite`
`L.tileLayer(...)` call in `map.html` is the one line to swap for Google's
tile endpoint (or the Google Maps JavaScript API's own satellite layer),
and `geocodeLocality()` in the same file is the one function to point at
the Geocoding API instead of Nominatim — everything else (the Plus Code
math, the click-to-open flow, the layer switcher) stays as it is.

## Site names are clickable from project lists

Wherever a project's site used to show as plain text — Manager and Admin
Secretary's Projects/Monthly reviews/Weekly reviews tables, and the "Site"
field on `project.html` — it's now a link to that site's own `site.html`
page, the same `siteLink()` helper the Sites table and Site Supervisor's
dashboard already used.

## Self-service account registration

People can now create their own account instead of IT Admin having to add
every one by hand — `register.html` is public, no login needed. The flow:

1. **Register** (`register.html`) — name, email, phone (optional), the
   password they choose themselves, and which role they're applying for
   (optional — "let IT admin decide" is a valid answer). This creates the
   account with `status: pending_verification` and **no role yet**, and
   emails a verification link (`sendVerificationEmail_()` in `Auth.gs`, via
   `MailApp` — see below). They can't log in yet.
2. **Verify** — clicking the emailed link opens `verify.html?token=...`,
   which calls `verifyEmail()`. That moves the account to
   `pending_approval` and marks `email_verified: true`. The token is a
   single-use UUID that expires after 48 hours; `verify.html` offers
   **Resend verification email** (`resendVerification()`) if it's expired
   or never arrived — without that, a lost email would strand the account
   permanently.
3. **Log in, profile-only** — once verified, they *can* log in
   (`login()` now allows `pending_approval` through), but `index.html`
   sends a role-less session to `pending.html` instead of a dashboard —
   their own name/email/phone/requested-role and an "awaiting approval"
   status, nothing else. Every other page's `requireSession()`/
   `requireRole()` does the same redirect if a role-less session ever
   lands on it directly.
4. **IT Admin approves** — the Users tab lists `pending_verification` and
   `pending_approval` accounts right alongside everyone else (status pill
   makes them obvious), with a grey "Applying: Site supervisor"-style role
   cell instead of a blank one. A `pending_approval` row gets an
   **Approve** button (`approveUserFlow()`) in place of Edit — pick the
   role (defaults to whatever they applied for) and confirm; that's
   `approveUser()`, which sets the role, flips `status` to `active`, and
   emails the approval notice. IT Admin can also **Reject** (same Delete
   action, relabeled) a pending account at either stage instead of
   approving it.
5. **Approval email** — they're told their role and that they can log in
   now; no password is included (they already set one at step 1).

A few deliberate choices worth knowing:
- `updateUser()` refuses to set `status: active` directly on an account
  that has no role — that path is reserved for `approveUser()`, which sets
  both together, so there's no way to end up with an "active" account that
  can't land on a dashboard.
- The verification token is stripped from every `list`/`USERS` read and
  from `getUserProfile()` (same treatment as the password fields) — it's
  effectively a login bypass while valid, so it never leaves the server
  except inside the one email it's sent in.
- `resendVerification()` always returns the same generic "if that email is
  pending, we've sent it" response whether or not the address is
  registered, so it can't be used to check which emails have accounts.
- Accounts IT Admin creates directly from the **+ Add user** button
  (`createUser()`) skip all of this — IT Admin is vouching for them
  personally, so they're active immediately with no email verification
  step. Self-service registration is the path for everyone else.

**Email setup** — both emails send via `MailApp.sendEmail()` from whichever
Google account owns this Apps Script project. No API key, no extra service
to configure, but subject to that account's daily send quota (roughly
100/day on a plain Gmail account, ~1500/day on Google Workspace — fine for
staff onboarding at normal pace). A send failure never blocks the action
it's attached to (the account still gets created/approved either way); for
the verification email specifically, that's exactly what
`resendVerification()` is for. One thing worth setting: `FRONTEND_BASE_URL`
near the top of `Code.gs` (empty by default) — fill it in with wherever the
static files are hosted so the emails contain real clickable links
(`https://.../verify.html?token=...`); left empty, the emails still send,
just with a plain-text instruction instead of a link.

## Forgot password / password reset

Anyone who can log in (an active account, or a verified one still awaiting
approval) can reset their own password without going through IT Admin:

1. **Reset password** link on `index.html`, under the password field. It
   opens `forgot-password.html`, pre-filled with whatever email was already
   typed on the login page.
2. They enter the email they registered with and press **Send reset link**.
   That calls `requestPasswordReset()` in `Auth.gs`, which emails a link to
   `reset-password.html?token=...` (`sendPasswordResetEmail_()`, same
   `MailApp` setup as the verification email).
3. Clicking the link opens `reset-password.html`, which checks the link
   first (`checkPasswordResetToken()`) and then asks for the new password
   twice. Saving it calls `resetPassword()`, which sets the new password,
   kills the link, and sends a short "your password was changed" email.
4. They log in with the new password as normal.

A few deliberate choices worth knowing:
- The page always says "if an account exists for that email, we've sent a
  link", whether or not it does, so it can't be used to find out which
  emails have accounts. Suspended and not-yet-verified accounts silently
  get no email.
- Each link works **once** and expires after **1 hour**
  (`PASSWORD_RESET_TTL_MINUTES_` in `Auth.gs`). Requesting a new link
  cancels the previous one, and so does IT Admin setting a password via
  **Edit user**.
- Only a SHA-256 hash of the token is stored in `USERS.password_reset_token`,
  never the link itself, and that column is stripped from every USERS read
  the same way the password fields are.
- To stop the public form being used to flood someone's inbox, one account
  gets at most one reset email every 2 minutes
  (`PASSWORD_RESET_COOLDOWN_SECONDS_`).
- Requests and completed resets are written to the Audit log
  ("Request password reset" / "Reset password").
- Sessions that were already logged in elsewhere aren't forced out by a
  reset; they still expire on their own within 8 hours.

## Audit log

Every login and every significant action — creating/editing/deleting a
user, recording/approving/assigning a project, flagging or reviewing a
completion notice, completing a project, raising or resolving a support
ticket — is now written to a new `AUDIT_LOG` table (`id`, `user_id`,
`user_name`, `role`, `action`, `details`, `created_at`), via a
`logActivity_()` helper in `Auth.gs` that every one of those actions calls
right after it succeeds. Logging is best-effort: if it ever fails for any
reason, the action it's recording still completes — a logging hiccup never
blocks real work. IT Admin has a dedicated **Audit log** tab (its own
`getAuditLog` endpoint, IT Admin only) listing who did what and when,
newest first.

## Tracking usage & activity

There are two separate ways to see how the system is being used day to
day, answering two different questions:

**"Who did what, down to the record" → the Audit log + Analytics "System
usage" (built in, no setup).** Every login and significant action already
writes to `AUDIT_LOG` with the real user's identity (see "Audit log"
above). IT Admin's **Analytics** tab now has a **System usage** section
built entirely from that log: "Active today" / "Logins today" / "Active in
last 14 days" / "Actions in last 14 days" stat cards, a 14-day line chart
of logins and total actions, and a "Most active users" bar chart. It needs
no setup and nothing leaves the system — it's the same spreadsheet data
the Audit log tab already shows, just summarized.

**"How many people are using it, from where, on what device" → Google
Analytics 4, opt-in.** `ga.js` is a single shared file, loaded by every
page, that can report standard web-analytics data (daily/weekly active
users, page views per dashboard, device and browser breakdown, time on
page) into Google's own Analytics dashboard at analytics.google.com. It
does nothing — no script loaded, nothing sent anywhere — until you fill in
a Measurement ID:

1. Create a free GA4 property at [analytics.google.com](https://analytics.google.com)
   (Admin → Create property), then add a **Web** data stream under it (any
   placeholder URL is fine — GA never needs to reach the Apps Script Web
   App itself). The stream gives you a Measurement ID like `G-XXXXXXXXXX`.
2. Open `ga.js` and set `GA_MEASUREMENT_ID` to that value.
3. Redeploy the static files, same as any other frontend-only change.
4. Give it a few minutes — **Reports → Realtime** in GA shows activity
   immediately; the day-over-day reports need a day or two of data before
   trends look meaningful.

It intentionally never sends a person's name, email, or a stable user ID
to Google — only GA4's own automatic page-view events plus one user
property, `app_role` (e.g. `SITE_SUPERVISOR`), set right after login via
`gaTrackRole(session.role)`, so GA's reports can be broken down by role
without identifying who specifically. If you want GA to track the same
person across devices/sessions, that's Google's separate User-ID feature —
deliberately not wired up here, since it means deciding to send Google a
stable per-person identifier for staff activity, which is worth doing on
purpose rather than by default.

## Printable user details & credentials

IT Admin can print any user's account details — from the **Print** button
next to each row on the Users tab, or from that user's own `user.html`
page — as a simple letterhead-style sheet (name, role, email, phone, title,
address, emergency contact, status, user id, account-created date). No
password ever appears on this sheet, because by the time you're printing
it, the plaintext password doesn't exist anywhere to show.

The one moment it does exist is right when it's set: immediately after
**+ Add user** creates an account, or after **Edit user** resets someone's
password, IT Admin is asked whether to print a one-off credentials slip —
name, role, email (as the username), phone, and the temporary password —
so it can be handed straight to the new user instead of read aloud or
typed into a message. The slip reminds them to change the password after
first login and to destroy the slip once they have.

## Back button returns to the right tab

Every link into a standalone page (`project.html`, `site.html`, `user.html`,
`daily-plan.html`, `report.html`, `weekly-review.html`, `monthly-review.html`,
`kpi.html`) now tags its own href with `&from=<tabId>` at the moment it's
clicked, based on which dashboard `.panel` it was rendered inside of. The
standalone page reads that `from` param and points its "Back" link at
`<dashboard>.html#<tabId>` instead of just the dashboard's default tab — so
clicking a user from the Users tab, then Back, lands back on Users, not on
whatever tab happens to load first. This chains through nested links too
(e.g. a supervisor's name clicked from inside `kpi.html` still remembers the
tab you started from, via `window.CURRENT_ORIGIN_TAB`).

## Connect it to your backend

1. Deploy `Code.gs` + `Auth.gs` + `Views.gs` as a Web App (Apps Script editor
   → Deploy → New deployment → Web app → Execute as **Me** → Who has access
   **Anyone**). All three live in the same Apps Script project — paste each
   in as its own file (Apps Script merges them into one shared scope).
2. Copy the `.../exec` URL it gives you.
3. Open `config.js` and paste it in as `WEB_APP_URL`.
4. Commit and push. If you're using GitHub Pages, turn it on for this repo
   (Settings → Pages → deploy from the branch/folder these files live in).

## First login

Run `bootstrapFirstAdmin()` once from the Apps Script editor (see Auth.gs),
then log in with those credentials at `index.html`. From the IT admin
dashboard, create the Manager, Admin Secretary, and Site Supervisor
accounts — there's no self-service sign-up by design.

## If you're updating from an earlier version of this project

`DAILY_REPORTS` picked up three new columns (`crew_headcount`, `weather`,
`completion_percent`). Re-run `setupDatabase()` from the Apps Script editor
once — it never touches existing data, it only adds the missing columns in
the right position. No other schema changes were needed: `MATERIALS`,
`EQUIPMENT`, `PRODUCTIVITY_TARGETS`, `WEEKLY_REVIEWS`, `MONTHLY_REVIEWS`,
and `SUPERVISOR_EVALUATIONS` already existed in the schema — they just
didn't have a dashboard form to write to them until now.

## If you're updating to this version

- **Faster `setupDatabase()` (newest change).** It used to re-format every
  table and re-apply every dropdown rule on each run, which could pass Apps
  Script's 6-minute limit ("Exceeded maximum execution time"). Now it only
  touches tables that are new or missing columns, and if it's ever close to
  the limit it stops cleanly and tells you to run it again to finish. Run it
  with **Run**, not **Debug** — the debugger is much slower and times out
  on its own.
- **New folder layout.** Pages, CSS and JS moved into
  subfolders (see "Folder layout" at the top). On GitHub, delete the old
  loose files at the repo root (except `index.html`, `register.html`,
  `verify.html`, `pending.html`, `sw.js`, `manifest.json`) and upload the new
  folders, and move `logo.png` into `icons/`. Paste the `apps-script/`
  files into Apps Script and deploy a new version too, since the links in
  notification emails now point at the new paths. Old bookmarks such as
  `manager.html` stop working; logging in from `index.html` goes to the
  right place.
- **Password reset.** `USERS` picked up two new columns
  (`password_reset_token`, `password_reset_expires`). Paste in the updated
  `Code.gs`, `Auth.gs` and `Views.gs`, re-run `setupDatabase()` once (safe,
  additive), then **Deploy → Manage deployments → edit → New version** so
  the live Web App picks up the new actions. Upload the two new pages,
  `forgot-password.html` and `reset-password.html`, along with the updated
  `index.html`. Make sure `FRONTEND_BASE_URL` in `Code.gs` points at where
  those pages are hosted, or the reset email will have no clickable link.
  See "Forgot password / password reset" above.
- `USERS` picked up six new columns (`email_verified`, `verification_token`,
  `verification_token_expires`, `requested_role`, `approved_by`,
  `approved_at`) for self-service registration. Re-run `setupDatabase()`
  once after pulling this update (safe, additive, same as every other
  schema change here) — existing accounts are unaffected, those columns
  just start out blank for them. Three new frontend files too:
  `register.html`, `verify.html`, `pending.html`. See "Self-service account
  registration" below, including the one setting worth filling in
  (`FRONTEND_BASE_URL` in `Code.gs`) so the verification/approval emails
  contain real links.
- New file `ga.js`, and every page's `<head>` now loads it — make sure it's
  uploaded alongside the rest (no `.gs`/schema change, and it does nothing
  until you set `GA_MEASUREMENT_ID` — see "Tracking usage & activity").
- `TICKETS` picked up one new column (`screenshot_path`), for the optional
  screenshot attachment on "Report an issue".
- `SITES` picked up seven new columns (`address`, `client_name`, `site_type`,
  `gps_coords`, `start_date`, `site_manager_id`, `notes`) so a site's own page
  has real detail to show. Existing sites keep their `name`/`location`/`status`
  exactly as they were — the new columns just start out blank until you fill
  them in from the "Register a site" form (now showing the extra fields) or
  directly in the sheet.
- Re-run `setupDatabase()` from the Apps Script editor once after pulling
  this update — it never touches existing data, it only adds the missing
  columns in the right position. The first time a screenshot or Daily Report
  photo is uploaded after redeploying, Google may prompt you to re-authorize
  Drive access (the new `file.setSharing(...)` call needs it) — just approve it.
- Admin Secretary's write permissions were widened to match Manager's:
  registering sites, recording and approving projects, adding to the
  materials/equipment/productivity-target catalogue, and recording monthly
  reviews/supervisor evaluations are now all allowed for `ADMIN_SECRETARY`
  too (`WRITE_PERMISSIONS` and the role gates on `createProject`,
  `approveProject`, and `reviewCompletionNotice` in `Auth.gs`). No deploy
  step beyond redeploying the Web App is needed for this — it's a
  server-side permission change, not a schema change.
- `PROJECTS` picked up one new column (`progress_percent`) for the progress
  bar described above. Re-run `setupDatabase()` once more after pulling this
  update (safe, additive, same as the `SITES` columns above).
- A brand-new `AUDIT_LOG` table was added for the audit log described above.
  Re-run `setupDatabase()` once more after pulling this update — it creates
  the new sheet with its headers; nothing else is touched. No action is
  logged retroactively — the audit trail starts from whenever you redeploy
  this version onward.
- `SITES` and `PROJECTS` each picked up one new column (`edit_count`) for
  the Manager/Admin Secretary 3-edit cap described above. Re-run
  `setupDatabase()` once more after pulling this update (safe, additive).
  Every existing site and project starts at an empty `edit_count` (treated
  as 0), so nothing that was already editable suddenly becomes locked.
- A brand-new `CLIENTS` table was added (see "Clients & consultants" above),
  and `SITES` picked up one new column (`client_id`) linking to it. Re-run
  `setupDatabase()` once more after pulling this update — it creates the new
  sheet and column; existing sites' old `client_name` text is left exactly
  as it was (nothing is migrated automatically into a `CLIENTS` row) and
  keeps showing until you edit that site onto a real client record.
  `catalogue.html` no longer exists — it's replaced by `materials.html`,
  `equipment.html` and `productivity-targets.html` (same data, same
  `MATERIALS`/`EQUIPMENT`/`PRODUCTIVITY_TARGETS` tables, no schema change for
  those three); update any bookmarks or links that pointed at the old page.
- `map.html` loads Leaflet, Google's `open-location-code` library, satellite
  tiles, street tiles, and the Nominatim geocoder from public services
  (`cdnjs.cloudflare.com`, `server.arcgisonline.com`, `tile.openstreetmap.org`,
  `nominatim.openstreetmap.org`) — no API key or account needed for any of
  them, but the device it's viewed on does need to be able to reach those
  hosts. See "Site map & clickable GPS coordinates" above for what each one
  is used for and how to swap in a Google Maps API key later if you get one.

## Known limitations of this pass

- No pagination — every list pulls the whole table. Fine at the data volumes
  this system is built for now; worth revisiting if any table grows into the
  thousands of rows.
- Session tokens live in `sessionStorage`, so logging in again is needed
  after closing the tab — a deliberate trade-off for not persisting a login
  token longer than a browser session.
- Site Supervisors only see projects assigned to them; there's no
  supervisor-facing view of unassigned projects (by design — assignment is
  the Admin Secretary's job).
- Materials, equipment, productivity targets, weekly/monthly reviews, and
  supervisor evaluations are add-and-list only for now — no edit or delete
  from the dashboard (fix a mistake directly in the sheet, or delete the row
  and re-add it). Clients/consultants are the exception — those do have a
  full edit (any of IT Admin/Manager/Admin Secretary) and delete (IT Admin)
  from `client.html`.
- `EXPENSES.approved_by`/`.status` are still recorded but nothing in any
  dashboard acts on them yet — expenses log against a report but don't go
  through an approval step.
- Safety Incidents and Expense Receipts still use a text-only photo/receipt
  URL field and the old flat Drive folder — only Daily Report photos and
  ticket screenshots got the real upload treatment in this pass.
