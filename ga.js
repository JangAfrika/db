// ga.js — Google Analytics 4 (GA4) loader, shared by every page.
//
// This is the ONE place the Measurement ID lives — every page just has
// <script src="ga.js"></script> in its <head>, so turning tracking on (or
// swapping the ID) is a single edit here instead of touching 18 files.
//
// How to turn this on:
//   1. Create a free GA4 property at https://analytics.google.com
//      (Admin → Create property) and give it a name like "Dynamic
//      Builders". You don't need a linked website/app, just the property.
//   2. Under that property, add a "Web" data stream — any placeholder URL
//      is fine, GA doesn't actually need to be able to reach the Apps
//      Script Web App. The stream gives you a Measurement ID that looks
//      like "G-XXXXXXXXXX".
//   3. Paste that ID in GA_MEASUREMENT_ID below, replacing the empty
//      string. Redeploy the static files (same as any other frontend
//      change — see README "do I need to deploy" notes).
//   4. Give it a few minutes, then Google Analytics → Reports → Realtime
//      will show visits as people use the system; the standard reports
//      (Reports → Engagement → Pages and screens, Reports → User →
//      Demographics, etc.) fill in day by day after that — GA needs a day
//      or two of data before "daily active users" trends look meaningful.
//
// Until GA_MEASUREMENT_ID is filled in, this file does nothing — no
// script is loaded, nothing is sent anywhere. That's deliberate: a
// construction company's internal tool tracking staff activity is worth
// deciding on, not something that should start silently.
//
// What this sends: GA4's own automatic page_view events (which page, when,
// browser/device, rough location from IP — standard GA4 behavior) plus one
// user property, "app_role" (e.g. "SITE_SUPERVISOR"), set right after
// login via gaTrackRole() below, so GA's reports can be broken down by
// role. It deliberately does NOT send the person's name, email, or user
// ID to Google — if you want GA to recognize "this person" across
// sessions/devices rather than just "this browser", that's Google's
// User-ID feature and is a separate decision (it means sending a stable
// identifier to Google), not something this file does on its own.
//
// For "who did what" at the level of individual records (who created this
// project, who edited that site) — not something GA is built for anyway —
// the app's own Audit Log (IT Admin → Audit log tab) and the Analytics
// tab's new "System usage" section already cover that from data that
// never leaves the system.

const GA_MEASUREMENT_ID = 'G-X3DC07312T';

(function () {
  if (!GA_MEASUREMENT_ID) return;

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID, {
    // Dashboard page titles are already descriptive ("Manager — Dynamic
    // Builders" etc.) so the default page_title/page_location are enough
    // to tell pages apart in GA's reports without any extra config here.
    anonymize_ip: true
  });
})();

// Call right after a page gets its session (requireSession()/requireRole())
// so GA can break reports down by role, without ever sending who the
// person actually is. A no-op until GA_MEASUREMENT_ID is set above.
function gaTrackRole(role) {
  if (typeof window.gtag === 'function' && role) {
    window.gtag('set', 'user_properties', { app_role: role });
  }
}
