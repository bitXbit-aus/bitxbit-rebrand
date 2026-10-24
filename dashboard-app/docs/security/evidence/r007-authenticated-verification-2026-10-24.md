# R-007 — authenticated authorisation matrix and session verification (2026-10-24)

All results below were measured against deployed preview `deploy-preview-49`, built from terminal
candidate `294a1dc5d59e5873647696a2ba6449518466e0a7` (application tree byte-identical to
`ba0c765a26054c4004d223c457b58002b958b0e3`) and scoped to staging Supabase plus Solana devnet.
Production was not targeted or changed.

**Gate:** `scripts/authz-matrix-verify.py`
**Result:** **21/21 passed**, exit 0, verified clean teardown.

The gate contains an explicit refusal for the known production app host and production Supabase
project.

## Method

1. Create a unique ephemeral staging auth user. Creation failure is fatal; there is no user-list
   fallback.
2. Mint sessions through Supabase Admin `generate_link` without handling a password or OTP.
3. Encode cookies using the installed `@supabase/ssr@0.12.7` helpers.
4. Mutate only the fixture's `user_authorizations` row between phases.
5. Exercise the deployed middleware and rendered pages.
6. Delete the fixture in `finally`; cleanup failure changes the process exit status.

## Authorisation and routing results

| Scenario | Result |
|---|---|
| no cookie → `/dashboard` | 307 → `/auth/login` |
| active member → `/dashboard` | 200 |
| active member → `/admin` | 307 → `/dashboard` |
| active member → `/auth/login` | 307 → `/dashboard` |
| suspended → `/dashboard` | 307 → `/auth/login?error=account_inactive` |
| suspended → `/auth/login` | 200 |
| deactivated → `/dashboard` | 307 → `/auth/login?error=account_inactive` |
| active admin → `/admin` | 200 |
| admin search with repeated query keys | complete page rendered, no global Next error shell |

The middleware re-read authorisation state on each request. The admin page also performs
`requireActiveAdmin()` before constructing the privileged service-role client.

**Added after the terminal review:** every authorisation `PATCH` is now asserted to affect **exactly
one row** with the expected values. Previously the "deactivated" phase could pass against an account
that was still merely suspended, because both states redirect to `error=account_inactive`.

## Session refresh — 200 response path

A session cookie was rebuilt with its access-token expiry in the past while retaining a genuine refresh
token.

- `/dashboard` returned 200.
- The response contained the expected auth `Set-Cookie`.
- The access token changed.
- The refresh token rotated.
- The expiry moved into the future.
- User identity remained stable.
- Replaying the returned cookie reached `/dashboard` successfully.
- The rendered page contained the fixture display name and no global Next.js error shell.

**Precision limit from the final GPT review:** the page-level result proves that the downstream page
received a usable authenticated session. Inside Supabase's token reuse window it does not uniquely
prove whether middleware forwarded the last refresh or the downstream page independently performed
it. No session-loss defect was reproduced.

## Session refresh — redirect path

The historical defect was measured before the fix: an expired session plus suspended user produced a
307 redirect with no `Set-Cookie`. The separate narrow correction in PR #51 routes all four redirect
branches through `redirectWithCookies(...)`; the byte-identical correction is also carried in PR #49.

On the final preview the same class of request produced:

- 307 to `/auth/login?error=account_inactive`;
- the expected auth-cookie name in `Set-Cookie`;
- cookie attributes retained;
- the focused helper tests fail if cookie copying or attributes are removed.
- **added after the terminal review:** the redirect response's auth cookie is now **decoded** and
  required to be a **usable same-user session** (`[decoded, same user]`), and a **second redirect
  branch** — an expired session on a denied route (`/admin` → `/dashboard`) — is exercised and also
  carries the refreshed cookie.

**Precision limit from the final GPT review:** the manual redirect check confirms presence and helper
semantics but does not yet merge deletion/chunk transitions into the original jar, decode that exact
redirect result, and replay it. It is therefore weaker than the 200-response replay assertion.

## Legacy-cookie compatibility

A cookie encoded with legacy `@supabase/ssr@0.1.0` semantics authenticated against the migrated
`0.12.7` preview and was rewritten in the current format on refresh. The migration does not imply a
fleet-wide logout for existing sessions.

## Cleanup

The gate confirmed all fixture surfaces were removed:

- `user_authorizations`: 0 fixture rows;
- `users`: 0 fixture rows;
- auth user: absent.

Session material remained in-process and was not retained as evidence.

## Known verification limits

- Browser magic-link/PKCE sign-in and browser-owned cookie writing were not exercised end to end.
- The redirect probe does not replay the exact merged redirected cookie jar through deletion/chunk
  transitions.
- State PATCHes are not independently asserted for exact affected-row count and returned values;
  later route behaviour detects most, but not every, stale-state case.
- Page success is now content-sensitive, but does not uniquely identify which Supabase layer performed
  the last refresh inside the provider's token reuse window.

This closes the planned deployed authentication/session gate. It does **not** satisfy independent human
review: that M8 condition remains **waived, not satisfied, under owner decision D5**. Explicit owner
release approval remains outstanding.
