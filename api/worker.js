// entra-errors-worker.js — v4 (Service Worker format)
// KV binding variable name: ENTRA_ERRORS
// Secret variable: SEED_SECRET
// Route: api.aboutcloud.io/entra-errors* (also blog.aboutcloud.io)
// Cron: 0 */6 * * *

const ALLOWED_ORIGINS = [
  "https://blog.aboutcloud.io",
    "https://aboutcloud.io",
  "https://entraerrors.aboutcloud.io",
  "https://tracker.aboutcloud.io"
];

const KV_CODES         = "entra_errors_codes_v1";
const KV_CHANGELOG     = "entra_errors_changelog_v1";
const KV_LAST_SYNC     = "entra_errors_last_sync_v1";
const KV_PARSER_HEALTH = "entra_errors_parser_health_v1";
const LEARN_URL        = "https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes";

// ── HELPERS ───────────────────────────────────────────────────────────────────

function getCorsHeaders(origin, isAdmin) {
  const allowOrigin = isAdmin
    ? "*"
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function respond(data, status, origin, isAdmin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      ...getCorsHeaders(origin, isAdmin)
    }
  });
}

// ── RULE ENGINE ───────────────────────────────────────────────────────────────

function classifySeverity(desc) {
  const d = desc.toLowerCase();
  if (d.includes("transient") || d.includes("temporarily") || d.includes("internal server") || d.includes("retry")) return "microsoft-side";
  if (d.includes("password") || d.includes("account locked") || d.includes("account disabled") || d.includes("mfa") || d.includes("enroll") || d.includes("user declined")) return "user-error";
  if (d.includes("redirect uri") || d.includes("client id") || d.includes("client secret") || d.includes("pkce") || d.includes("jwt") || d.includes("grant type") || d.includes("scope")) return "developer";
  if (d.includes("conditional access") || d.includes("policy") || d.includes("device") || d.includes("certificate") || d.includes("tenant") || d.includes("not assigned")) return "admin-config";
  return "developer";
}

function classifyScenario(code, desc) {
  const d = desc.toLowerCase();
  const n = parseInt(code.replace("AADSTS", ""), 10);
  const s = new Set();
  if (d.includes("conditional access") || (n >= 53000 && n <= 53020)) s.add("conditional-access");
  if (d.includes("mfa") || d.includes("multi-factor") || d.includes("strong auth")) s.add("mfa");
  if (d.includes("device") || d.includes("workplace join") || d.includes("domain join")) s.add("device-compliance");
  if (d.includes("saml") || d.includes("federation") || (n >= 75000 && n <= 75020)) s.add("federation");
  if (d.includes("token") || d.includes("jwt") || d.includes("assertion")) s.add("token");
  if (d.includes("password") || d.includes("locked") || d.includes("disabled")) s.add("user-account");
  if (d.includes("consent") || d.includes("permission") || (n >= 65000 && n <= 65020)) s.add("consent");
  if (d.includes("redirect uri") || d.includes("client secret") || d.includes("client id")) s.add("app-registration");
  if (d.includes("pass-through") || d.includes("kerberos") || (n >= 80000 && n <= 81020)) s.add("hybrid");
  if (d.includes("guest") || d.includes("b2b") || d.includes("external identity")) s.add("b2b");
  if (d.includes("risk") || d.includes("identity protection")) s.add("identity-protection");
  if (d.includes("pim") || d.includes("privileged")) s.add("pim");
  if (d.includes("transient") || d.includes("retry")) s.add("transient");
  if (d.includes("session") || d.includes("sign-in frequency")) s.add("session");
  if (d.includes("global secure access") || d.includes("compliant network")) s.add("global-secure-access");
  if (s.size === 0) s.add("authentication-flow");
  return Array.from(s);
}

function autoClassify(code, description) {
  const severity  = classifySeverity(description);
  const scenario  = classifyScenario(code, description);
  const whoFixes  = { "user-error": "user", "admin-config": "admin", "developer": "developer", "microsoft-side": "nobody" }[severity] || "developer";
  const ca_trigger = scenario.includes("conditional-access");
  const now = new Date().toISOString();
  return {
    short: description.slice(0, 120),
    plain_english: description,
    scenario, severity,
    who_fixes: whoFixes,
    ca_trigger,
    fix_hint: "Refer to the Microsoft documentation for this error code.",
    tags: Array.from(new Set([...scenario, severity])),
    auto_classified: true,
    needs_review: false,
    source_description: description,
    first_seen: now,
    last_updated: now
  };
}

// ── SCRAPER ───────────────────────────────────────────────────────────────────

async function scrapeLearnPage() {
  try {
    const res = await fetch(LEARN_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; aboutcloud-entra-errors/4.0)" }
    });
    if (!res.ok) return { ok: false, error: "HTTP " + res.status, codes: {} };
    const html = await res.text();
    const parsed = {};
    const re = /\|\s*(AADSTS\d+)\s*\|\s*([^|]{10,300})\|/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const code = m[1].trim().toUpperCase();
      const desc = m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      if (code && desc.length > 5) parsed[code] = desc;
    }
    if (Object.keys(parsed).length < 10) {
      const re2 = /AADSTS(\d{4,6})[^\w]([^\n\r]{10,250})/g;
      while ((m = re2.exec(html)) !== null) {
        const code = "AADSTS" + m[1];
        const desc = m[2].replace(/<[^>]+>/g, "").trim();
        if (!parsed[code] && desc.length > 10) parsed[code] = desc;
      }
    }
    return { ok: Object.keys(parsed).length > 5, codes: parsed, count: Object.keys(parsed).length };
  } catch (e) {
    return { ok: false, error: e.message, codes: {} };
  }
}

// ── SYNC ──────────────────────────────────────────────────────────────────────

async function syncCodes() {
  const scraped = await scrapeLearnPage();
  await ENTRA_ERRORS.put(KV_PARSER_HEALTH, JSON.stringify({
    last_attempt: new Date().toISOString(),
    ok: scraped.ok,
    codes_found: scraped.count || 0,
    error: scraped.error || null
  }));
  if (!scraped.ok) return { ok: false, error: scraped.error };

  const existing  = JSON.parse(await ENTRA_ERRORS.get(KV_CODES) || "{}");
  const changelog = JSON.parse(await ENTRA_ERRORS.get(KV_CHANGELOG) || "[]");
  const changes   = [];
  let newCount = 0, changedCount = 0;

  for (const [code, description] of Object.entries(scraped.codes)) {
    if (!existing[code]) {
      existing[code] = autoClassify(code, description);
      changes.push({ type: "new", code, date: new Date().toISOString(), description });
      newCount++;
    } else if (existing[code].source_description && existing[code].source_description !== description) {
      changes.push({ type: "changed", code, date: new Date().toISOString(), old: existing[code].source_description, new: description });
      existing[code].source_description = description;
      existing[code].last_updated = new Date().toISOString();
      existing[code].needs_review = true;
      changedCount++;
    }
  }

  await ENTRA_ERRORS.put(KV_CODES, JSON.stringify(existing));
  await ENTRA_ERRORS.put(KV_CHANGELOG, JSON.stringify([...changes, ...changelog].slice(0, 200)));
  await ENTRA_ERRORS.put(KV_LAST_SYNC, JSON.stringify({
    timestamp: new Date().toISOString(),
    total_codes: Object.keys(existing).length,
    scraped_codes: scraped.count,
    new: newCount,
    changed: changedCount
  }));
  return { ok: true, newCount, changedCount, total: Object.keys(existing).length };
}

// ── FETCH HANDLER ─────────────────────────────────────────────────────────────

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url    = new URL(request.url);
  const path   = url.pathname;
  const method = request.method;
  const origin = request.headers.get("Origin") || "";
  const isAdmin = path.startsWith("/entra-errors/admin/");

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(origin, isAdmin) });
  }

  try {
    // ── GET /entra-errors ───────────────────────────────────────────────────
    if (method === "GET" && (path === "/entra-errors" || path === "/entra-errors/")) {
      const codes    = JSON.parse(await ENTRA_ERRORS.get(KV_CODES) || "{}");
      const lastSync = JSON.parse(await ENTRA_ERRORS.get(KV_LAST_SYNC) || "null");
      return respond({ meta: { total: Object.keys(codes).length, last_sync: lastSync, source: LEARN_URL }, codes }, 200, origin, false);
    }

    // ── GET /entra-errors/code/:code ────────────────────────────────────────
    const codeMatch = path.match(/^\/entra-errors\/code\/(AADSTS\d+)$/i);
    if (method === "GET" && codeMatch) {
      const code  = codeMatch[1].toUpperCase();
      const codes = JSON.parse(await ENTRA_ERRORS.get(KV_CODES) || "{}");
      if (!codes[code]) return respond({ error: "Code not found", code }, 404, origin, false);
      return respond({ code, ...codes[code] }, 200, origin, false);
    }

    // ── GET /entra-errors/changelog ─────────────────────────────────────────
    if (method === "GET" && path === "/entra-errors/changelog") {
      const changelog = JSON.parse(await ENTRA_ERRORS.get(KV_CHANGELOG) || "[]");
      return respond({ changelog }, 200, origin, false);
    }

    // ── GET /entra-errors/stats ─────────────────────────────────────────────
    if (method === "GET" && path === "/entra-errors/stats") {
      const codes    = JSON.parse(await ENTRA_ERRORS.get(KV_CODES) || "{}");
      const lastSync = JSON.parse(await ENTRA_ERRORS.get(KV_LAST_SYNC) || "null");
      const health   = JSON.parse(await ENTRA_ERRORS.get(KV_PARSER_HEALTH) || "null");
      const stats    = { total: 0, by_severity: {}, by_scenario: {}, ca_triggers: 0, auto_classified: 0, needs_review: 0 };
      for (const c of Object.values(codes)) {
        stats.total++;
        stats.by_severity[c.severity] = (stats.by_severity[c.severity] || 0) + 1;
        if (c.ca_trigger)      stats.ca_triggers++;
        if (c.auto_classified) stats.auto_classified++;
        if (c.needs_review)    stats.needs_review++;
        for (const s of (c.scenario || [])) {
          stats.by_scenario[s] = (stats.by_scenario[s] || 0) + 1;
        }
      }
      return respond({ stats, last_sync: lastSync, parser_health: health }, 200, origin, false);
    }

    // ── POST /entra-errors/admin/push ───────────────────────────────────────
    if (method === "POST" && path === "/entra-errors/admin/push") {
      const secret = url.searchParams.get("secret");
      if (!secret || secret !== SEED_SECRET) {
        return respond({ error: "Unauthorized" }, 401, origin, true);
      }
      let body;
      try { body = await request.json(); }
      catch (e) { return respond({ error: "Invalid JSON" }, 400, origin, true); }
      if (!body.codes || typeof body.codes !== "object") {
        return respond({ error: "Missing codes object" }, 400, origin, true);
      }
      const replaceAll = body.replace_all === true;
      const existing = replaceAll ? {} : JSON.parse(await ENTRA_ERRORS.get(KV_CODES) || "{}");
      const now = new Date().toISOString();
      let seeded = 0;
      for (const [code, data] of Object.entries(body.codes)) {
        if (replaceAll || !existing[code] || existing[code].auto_classified) {
          existing[code] = { ...data, first_seen: existing[code]?.first_seen || now, last_updated: now, auto_classified: false, needs_review: false };
          seeded++;
        }
      }
      await ENTRA_ERRORS.put(KV_CODES, JSON.stringify(existing));
      await ENTRA_ERRORS.put(KV_LAST_SYNC, JSON.stringify({ timestamp: now, total_codes: Object.keys(existing).length, source: "manual-seed-full", replaced: replaceAll }));
      return respond({ ok: true, seeded, total: Object.keys(existing).length }, 200, origin, true);
    }

    // ── GET /entra-errors/export.csv ────────────────────────────────────────
    if (method === "GET" && path === "/entra-errors/export.csv") {
      const codes = JSON.parse(await ENTRA_ERRORS.get(KV_CODES) || "{}");
      const csvEscape = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
      const rows = [
        ["code", "short", "severity", "who_fixes", "ca_trigger", "scenario", "plain_english"].join(",")
      ];
      for (const [code, c] of Object.entries(codes).sort()) {
        rows.push([
          csvEscape(code),
          csvEscape(c.short),
          csvEscape(c.severity),
          csvEscape(c.who_fixes),
          csvEscape(c.ca_trigger ? "TRUE" : "FALSE"),
          csvEscape((c.scenario || []).join("|")),
          csvEscape(c.plain_english)
        ].join(","));
      }
      return new Response(rows.join("\r\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="aadsts-error-codes.csv"',
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // ── GET /entra-errors/admin/sync ────────────────────────────────────────
    if (method === "GET" && path === "/entra-errors/admin/sync") {
      const secret = url.searchParams.get("secret");
      if (!secret || secret !== SEED_SECRET) {
        return respond({ error: "Unauthorized" }, 401, origin, true);
      }
      const result = await syncCodes();
      return respond(result, result.ok ? 200 : 500, origin, true);
    }

    // ── GET /entra-errors/admin/clear-changelog ──────────────────────────────
    if (method === "GET" && path === "/entra-errors/admin/clear-changelog") {
      const secret = url.searchParams.get("secret");
      if (!secret || secret !== SEED_SECRET) {
        return respond({ error: "Unauthorized" }, 401, origin, true);
      }
      await ENTRA_ERRORS.put(KV_CHANGELOG, JSON.stringify([]));
      return respond({ ok: true, message: "Changelog cleared" }, 200, origin, true);
    }

    return respond({ error: "Not found" }, 404, origin, false);

  } catch (e) {
    return respond({ error: e.message }, 500, origin, false);
  }
}

// ── CRON HANDLER ──────────────────────────────────────────────────────────────

addEventListener("scheduled", event => {
  event.waitUntil(syncCodes());
});