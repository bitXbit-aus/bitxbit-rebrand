# Staging redirect allowlist — deploy previews (2026-10-27)

**Objective:** let deploy previews exercise the emailed password-recovery link. R-015 recorded this as
the last owner action on that item; production needed nothing.

**Project:** staging `luqrwhgjtiyfmeawbtmp` (*bitXbit-Staging*), status `ACTIVE_HEALTHY` before the change.

## Before

| Setting | Value |
| --- | --- |
| `uri_allow_list` | **`""` (empty)** |
| `site_url` | `http://localhost:3000` |

Measured with the verify-endpoint probe (invalid token, no user created, no email sent) — **every**
external candidate was substituted to `site_url`, including the site's own Netlify host and
`app.bitxbit.com.au`. This is the config gap R-015 described, and it was worse than recorded: the
allowlist was not "only localhost", it was **empty**.

## Change

```
uri_allow_list = https://*--bitxbit-dashboard.netlify.app/**
```

One entry, scoped to this site's own Netlify subdomain. `site_url` was deliberately **left at
`http://localhost:3000`** — the app always passes an explicit `redirect_to`, so previews do not depend on
it, and changing it would alter local development behaviour. Nothing else was intended to change.

## After — measured

| `redirect_to` candidate | Result |
| --- | --- |
| `https://deploy-preview-75--bitxbit-dashboard.netlify.app/auth/callback?next=%2Fauth%2Freset-password` | **PRESERVED**, query string intact |
| `https://deploy-preview-75--bitxbit-dashboard.netlify.app/auth/callback` | **PRESERVED** |
| `https://security--bitxbit-dashboard.netlify.app/auth/callback` (branch deploy) | **PRESERVED** |
| `https://evil.example.com/auth/callback` | substituted → `localhost:3000` |
| `https://evil--bitxbit-dashboard.netlify.app.attacker.com/auth/callback` | substituted — **the glob anchors the host**, a lookalike suffix does not pass |
| `https://app.bitxbit.com.au/auth/callback` | substituted — staging grants nothing to the production host |

So the wildcard admits deploy previews and branch deploys, and nothing else.

## Collateral drift found — and mostly repaired

`UPDATE_PROJECT_AUTH_CONFIG` states that *"only provided fields are updated"*. **That is not true.** The
single-field update also reset five fields that were not sent to `null`:

| Field | Before | After the update | Repair |
| --- | --- | --- | --- |
| `security_captcha_provider` | `"hcaptcha"` | `null` | ✅ **restored** |
| `sessions_inactivity_timeout` | `0` | `null` | ✅ **restored** |
| `sessions_timebox` | `0` | `null` | ✅ **restored** |
| `sms_provider` | `"twilio"` | `null` | ⚠️ **not restorable** — reverts to `null` on write |
| `rate_limit_email_sent` | `2` | `null` | ⚠️ **not restorable** — API refuses without custom SMTP |

The two unrepaired fields:

- **`rate_limit_email_sent`** cannot be set at all on this project without custom SMTP — the Management
  API returns `PROVIDER_RATE_LIMITED`: *"Custom SMTP required to configure SMTP_SENDER_NAME or
  RATE_LIMIT_EMAIL_SENT"*. It is now unset, so staging falls back to the platform's default send limit.
  Setting up custom SMTP is a larger change than this task and is **not** made here.
- **`sms_provider`** reverts to `null` on every write while no SMS credentials exist. Phone auth is
  disabled (`external_phone_enabled: false`) and every `sms_twilio_*` field is null, so the value is
  **inert** — but it is recorded rather than glossed.

`uri_allow_list` and `site_url` were unaffected by the repair writes (re-read and confirmed).

**Lesson for the register:** a single-field Management-API update on this provider is not surgical.
Re-read the full config after any auth-config write and diff it against a snapshot taken beforehand.

## Not verified

- **A real recovery round trip on a preview was not exercised.** That would require creating a staging
  user and consuming a one-time token. What is proven here is that staging now **preserves** a
  preview-host redirect (with its `?next=`) instead of substituting it; the app-side consumption of that
  callback is proven separately on production (browser suite 7/7, plus the owner's own end-to-end reset).
  Nothing in this document proves a preview can complete a full reset end to end.
- The effect of `rate_limit_email_sent` reverting to the platform default on staging's actual email
  sending was not measured.
