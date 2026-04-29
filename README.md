# AADSTS Entra Errors — Community Error Code Reference

> Free community AADSTS error code lookup for Microsoft Entra ID.  
> Search by code, scenario or plain English. Severity classification, Conditional Access trigger detection, fix hints — auto-updated from Microsoft Learn.

**Live:** [entraerrors.aboutcloud.io](https://entraerrors.aboutcloud.io)  
**API:** `https://api.aboutcloud.io/entra-errors`

---

## What It Does

A fully automated, €0/month reference tool that scrapes the [Microsoft Entra ID authentication & authorization error codes](https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes) page, classifies every error by severity and responsible party, adds plain-English descriptions and fix hints, and serves them through a searchable web UI.

**349 error codes** currently tracked, updated every 6 hours.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Microsoft Learn                                  │
│  learn.microsoft.com/.../reference-error-codes   │
└──────────────┬──────────────────────────────────┘
               │ cron: 0 */6 * * *
               ▼
┌──────────────────────────────────────┐
│  Cloudflare Worker: entra-errors     │
│  • Fetches + parses MS Learn page    │
│  • Classifies severity, who_fixes    │
│  • Detects Conditional Access triggers│
│  • Writes to KV                      │
│  • Serves JSON API                   │
│                                      │
│  Handler: fetch + scheduled          │
│  Bindings: KV, SEED_SECRET           │
│  Route: api.aboutcloud.io/entra-errors*│
└──────┬──────────────┬────────────────┘
       │              │
       ▼              ▼
┌──────────────┐  ┌──────────────────────────┐
│  KV: ENTRA-  │  │  Cloudflare Pages         │
│  ERRORS      │  │  entra-errors.pages.dev   │
│              │  │  entraerrors.aboutcloud.io │
│  • codes_v1  │  │                            │
│  • changelog │  │  Static SPA:               │
│  • last_sync │  │  • Fuse.js search          │
│  • health    │  │  • Dark theme              │
│              │  │  • Severity filters        │
└──────────────┘  │  • Conditional Access badge │
                  │  • Copy-friendly error codes│
                  │  • Structured Data (JSON-LD)│
                  └──────────────────────────────┘
```

---

## Cloudflare Infrastructure

### Worker: `entra-errors`

| Property | Value |
|---|---|
| **ID** | `entra-errors` |
| **Route** | `api.aboutcloud.io/entra-errors*` |
| **Handlers** | `fetch`, `scheduled` |
| **Compatibility date** | 2026-04-01 |
| **Usage model** | Standard |
| **Versions** | 15 (latest: April 2, 2026) |
| **Deployed via** | Quick Editor (dashboard) |
| **Author** | russo.antonio76@gmail.com |

**Bindings:**

| Name | Type | Details |
|---|---|---|
| `ENTRA_ERRORS` | KV Namespace | ID: `45cfec03ab864558b853e5395ac3d903` |
| `SEED_SECRET` | Secret | Plain text |

**Cron Trigger:** `0 */6 * * *` (every 6 hours) — scrapes Microsoft Learn and refreshes KV.

### Pages: `entra-errors`

| Property | Value |
|---|---|
| **Project name** | `entra-errors` |
| **Domains** | `entra-errors.pages.dev`, `entraerrors.aboutcloud.io` |
| **Deployment type** | Direct upload (not git-based) |
| **Latest deployment** | April 1, 2026 |
| **Tech** | Static HTML + Fuse.js 7.0 + custom CSS |

### KV: `ENTRA-ERRORS`

**Namespace ID:** `45cfec03ab864558b853e5395ac3d903`

**Keys:**

| Key | Content | Size |
|---|---|---|
| `entra_errors_codes_v1` | All 349 classified error codes (JSON) | ~240 KB |
| `entra_errors_changelog_v1` | Change log (currently empty array) | — |
| `entra_errors_last_sync_v1` | Last sync timestamp and stats | < 1 KB |
| `entra_errors_parser_health_v1` | Parser health check result | < 1 KB |

**Last sync (as of 2026-04-29):** 349 total codes, 6 scraped per run, 0 new/changed.

---

## API

**Base URL:** `https://api.aboutcloud.io/entra-errors`

### `GET /`
Returns full error code catalog.

```json
{
  "meta": {
    "total": 349,
    "last_sync": { "timestamp": "...", "total_codes": 349, ... },
    "source": "https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes"
  },
  "codes": {
    "AADSTS50076": { ... },
    ...
  }
}
```

### `GET /stats`
Returns aggregate statistics.

### `GET /changelog`
Returns change log (currently empty).

### Query Parameters
Supports search/filter — exact params determined by worker logic.

---

## Data Model (per error code)

```json
{
  "AADSTS50126": {
    "short": "InvalidUserNameOrPassword - Error validating credentials...",
    "plain_english": "InvalidUserNameOrPassword - Error validating credentials due to invalid username or password.",
    "scenario": ["user-account"],
    "severity": "user-error",
    "who_fixes": "user",
    "ca_trigger": false,
    "fix_hint": "User must verify credentials. Admin can reset password in Microsoft Entra admin center.",
    "tags": ["user-error", "user-account"],
    "auto_classified": false,
    "needs_review": false,
    "source_description": "InvalidUserNameOrPassword - Error validating credentials...",
    "first_seen": "2026-04-01T22:47:39.272Z",
    "last_updated": "2026-04-01T22:47:39.272Z"
  }
}
```

### Severity Levels

| Severity | Badge | Meaning |
|---|---|---|
| `user-error` | 🟢 User Action | User needs to act (wrong password, MFA required, etc.) |
| `admin-config` | 🟠 Admin Config | Admin needs to fix configuration or policy |
| `developer` | 🟣 App / Dev | Developer needs to fix code or app registration |
| `microsoft-side` | ⚪ Microsoft Side | Transient Microsoft-side error — retry |

### `who_fixes`
- `user` — end user action
- `admin` — tenant/Entra admin configuration
- `developer` — application code/registration fix
- `nobody` — Microsoft-side, not fixable by customer

### `ca_trigger`
Boolean — `true` if this error can be triggered by a Conditional Access policy.
Currently 23 codes flagged.

---

## Frontend Features

- 🔍 **Fuse.js full-text search** — weighted across code, description, tags, scenarios
- 🏷️ **Severity filters** — user-error, admin-config, developer, microsoft-side
- 🔴 **Conditional Access badge** — highlights CA-triggered errors
- 📋 **Click-to-copy error codes**
- 🌙 **Dark theme** (Entra-inspired)
- 📊 **Live stats bar** — total codes, breakdown by severity, CA triggers
- 🔗 **Structured data** (JSON-LD) for SEO
- 📈 **Analytics** via aboutcloud.io analytics (Plausible/Umami-style)

---

## Source Data

Scraped from:  
`https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes`

The cron job (`0 */6 * * *`) fetches the page, parses error code sections, and updates KV. The parser typically finds ~6 codes per run (already mostly classified). Classification metadata (severity, who_fixes, fix_hints, tags) is auto-generated with manual overrides available via the `needs_review` flag.

---

## GitHub Repo

**Repo:** `arusso-aboutcloud/AADSTS-Entra-Errors` (private)

> ⚠️ The application code (Worker script + Pages HTML/JS) currently lives **only in Cloudflare** and was deployed via dashboard direct upload / Quick Editor. This repo will be the canonical source once the code is extracted from Cloudflare and committed here.

### Planned Structure (to be populated)

```
├── api/                  # Worker script
│   ├── worker.js
│   └── wrangler.toml
├── web/                  # Pages frontend
│   ├── index.html
│   └── wrangler.toml
├── scripts/              # Utilities
│   └── scrape_errors.py # Reference scraper
└── README.md
```

---

## Status

- ✅ **Worker** — live, cron active, serving API
- ✅ **Pages** — live, serving frontend
- ✅ **KV** — populated with 349 codes
- ✅ **Cron** — running every 6 hours
- ✅ **Parser health** — OK
- ⏳ **GitHub sync** — code not yet in repo (dashboard-deployed)

---

*Last reconciled: 2026-04-29*
