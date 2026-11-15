# Wallet sign-in — step-up design (R-021 prevention)

**Status: DESIGN ONLY — nothing here is built.** No code, no migration, no config change is included.
**Register:** R-021 · **Threat model:** `wallet-signin-threat-model.md`
**Scope:** `/api/auth/wallet/challenge` → `/api/auth/wallet/verify`, the wallet *linking* flow, and a new
step-up surface.

R-021's detection half shipped 2026-11-15 and is verified end to end. This document is the other half: how a
relayed signature stops being enough to obtain a session.

---

## 1. The one principle that decides every other choice

> **The step-up factor must be presented by the browser that is signing in, and must never be something the
> member can hand over.**

Everything below follows from that sentence, and the two obvious designs both violate it:

- **An "approve this sign-in" link in the email is dangerous.** The attacker's browser is the one waiting for
  a session. If approval is delivered out of band, the *victim* can click it — and approve the **attacker's**
  pending attempt. A control that a victim can trip on the attacker's behalf is worse than none.
- **A code that can be read aloud is only as strong as the con.** The attacker already has the victim's
  attention: that conversation is *how they got the signature*. Asking the same victim for the code that
  arrives moments later is a well-worn second act, not a new problem for them.

So the design is judged by **what a cooperative victim can still be tricked into relaying** — not by what an
attacker can forge. That single question produces the whole ladder below, and it is why the fix is a
**device-bound key** rather than an emailed code. The emailed code is the on-ramp, not the lock.

A second principle, from the R-021 alert's own lesson:

> **A gate must fail closed; an observation must fail soft.** The alert must never break a sign-in. The
> step-up must never mint one it could not verify.

---

## 2. What the gate is, in one table

| Situation | Wallet signature | Device trusted? | Extra factor | Session |
|---|---|---|---|---|
| Member, own browser, second visit | valid | yes | — | **minted** |
| Member, new phone or browser | valid | no | emailed code | minted *after* the code |
| Attacker relays a signature; victim never reads the email | valid (relayed) | no | emailed code | **not minted** |
| Attacker relays a signature *and* talks the victim into reading out the code | valid (relayed) | no | emailed code, **spoken** | minted — **residual, see §8** |
| Any device without the registered device key (Part 2) | valid (relayed) | n/a | **device key** | **not minted — the factor cannot be spoken** |

**The gate is: a session is minted only when the wallet signature verifies AND the presenting device is
trusted. An untrusted device must first complete the step-up.** The relay stops at row 3 for every attacker
whose victim signs and walks away — which is the ordinary case.

---

## 3. Part 1 — the gate, with an emailed code as the on-ramp

### 3.1 Device trust

A browser becomes trusted by **completing a step-up once**. There is no other way to earn it, and no way to
inherit it.

- Cookie `bx_wallet_device`: opaque 32 random bytes (base64url), `httpOnly`, `Secure`, `SameSite=Lax`,
  `Path=/`, 90-day TTL. It carries **no** identity — just a browser id.
- Server-side, `wallet_trusted_devices` stores `sha256(cookie_value)` — the raw value is never stored, so a
  database read cannot be replayed as a device.
- **Trust is per (browser, account).** A shared machine signed into two members' wallets yields two rows;
  one member's trust never authorises the other.

*Why a lookup, not a signed cookie:* the R-020 marker is HMAC-signed because it carries the user id and needs
*integrity*. Here the cookie is a random handle and the binding lives in the row — a signature would add
nothing, and it would make revocation impossible, which §3.4 needs.

### 3.2 The flow

```
POST /api/auth/wallet/verify          (existing endpoint, one new branch)
  ├─ rate limit                        (existing)
  ├─ verifyWalletSignIn(...)           (existing — signature + wallet_verified)
  │    └─ failure → one generic message (existing, unchanged)
  ├─ resolve account email             (existing — already required: the endpoint 500s without one)
  │
  ├─ device hash present AND trust row live for (device, user)?
  │    └─ YES ─ trusted ─────────────► mint session (existing plumbing, unchanged)
  │                                     ├─ update last_seen_at
  │                                     ├─ audit wallet.signed_in { device: "recognised" }
  │                                     └─ send the R-021 alert (existing)
  │
  └─ NO ─ untrusted ──────────────────► DO NOT MINT. Instead:
        ├─ begin_wallet_stepup(...)     → pending row + code (supersedes any earlier pending for
        │                                 this account+device, so an old code can never be used later)
        ├─ send the code email          → if the send FAILS: no session, clear message (fail closed)
        ├─ set bx_wallet_stepup         → signed, httpOnly, 10-minute pending cookie
        └─ audit wallet.step_up_required

POST /api/auth/wallet/step-up         (new)
  ├─ rate limit per pending, per device, and per account
  ├─ complete_wallet_stepup(...)        (atomic: consume + attempt count + resolve user)
  │    └─ failure → one generic message; reason audited as a REFUSAL (wallet.step_up_failed)
  ├─ mint session                       (existing plumbing, unchanged)
  ├─ trust this device                  → insert trust row + set bx_wallet_device cookie
  └─ audit wallet.step_up_completed, wallet.signed_in { device: "stepped_up" }, and the alert
```

**The session-minting code does not change.** `generateLink({ type: "magiclink" })` →
`verifyOtp({ token_hash })` is reused verbatim; the gate only decides *whether* and *when* it runs. That keeps
the change away from the one part of the flow that is already measured and working.

### 3.3 The email

Sent through the transport built for the R-021 alert (`lib/security-notification.ts`), but treated
**oppositely**: the alert is fail-soft, the step-up is **fail-closed**. If the code cannot be delivered, no
session is minted — the mailer is part of the security boundary here, not an observation.

Contents: the code; the wallet; the time; the source IP; and a warning that leads:

> Someone is signing in to your bitXbit account from a new device. If this is you, enter the code below in the
> browser you are using. **If it is not you, do not share this code with anyone** — not even someone claiming
> to be bitXbit. Change your password and unlink your wallet.

No approval link (see §1). A link to `/dashboard/wallet` is fine — informational, not authorising.

**This email is also the prompt-clarity mitigation (option 3 in the threat model) delivered at the exact
moment of risk**, which is better than any wording we could add to the signing message.

### 3.4 Revocation and visibility

`/dashboard/wallet` gains a **Recognised devices** list: label from the user agent, first seen, last seen,
"this device" marker, and a Remove action (Server Action, guarded like the rest of the dashboard). Removing a
device sets `revoked_at`; the next sign-in from it steps up again.

This is what makes an alert actionable. R-021's alert currently says "unlink the wallet" — a blunt remedy for
a narrow problem. With device management it can say *"remove that device"*, which is proportional and
reversible.

### 3.5 Limits

| Limit | Value | Why |
|---|---|---|
| Code length | 6 digits, stored as **HMAC**, never plaintext | a bare hash of 10⁶ values is a lookup table; HMAC is not |
| Code TTL | 10 minutes | matches the existing 5-minute challenge order of magnitude |
| Attempts per pending | 5, then the pending row is consumed | removes the "sit and guess" path |
| Step-up requests | 3 per account per 15 min | bounds inbox spam; also self-defeating for an attacker, since **each code email is a warning** |
| Verify attempts | 10 per pending | — |
| Concurrent pendings | 1 per (account, device) | a new request invalidates the previous code |

---

## 4. Part 2 — the device key (the actual lock)

Part 1 still has the spoken-code hole. Part 2 closes it by giving the device a factor **that has no
expressible form**.

**On enrolment** (the moment a step-up succeeds) the browser:

1. generates an **ECDSA P-256 keypair via WebCrypto with `extractable: false`** — the private key can be
   *used* by our origin's JavaScript but cannot be *read* by any script, ours included;
2. stores the private key handle in IndexedDB;
3. registers the public key against the trust row (`wallet_trusted_devices.public_key`).

**On every subsequent sign-in from that device**, a trusted device must additionally present a signature
over a fresh server nonce:

```
POST /api/auth/wallet/device-challenge   → { nonce, expiresAt }   (rate limited)
   browser: crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, deviceKey, nonce)
POST /api/auth/wallet/verify             → { ..., deviceNonce, deviceSignature }
   server: verify against the registered public key, consume the nonce
```

Trust then means *this device proved possession of its key*, not merely *a cookie was present*. A trusted
device with no device key (or a revoked one) steps up instead.

**Why this is the fix:** the private key never leaves the device and cannot be exported, so there is nothing
for the victim to read out, paste, or type anywhere. The relay's second act disappears — not because the
victim is more careful, but because **there is no second thing they can give away.** A member signing in from
a new device still uses the emailed code (that is enrolment); every later sign-in on that device needs no
email at all.

**Two honest implementation notes:**

- **Safari's storage eviction is a real constraint.** ITP clears scripted storage (including IndexedDB) after
  ~7 days of no interaction with the site, so a Safari member returning after a fortnight finds the key gone —
  and steps up again. That is a UX cost, not a security one, and it is the reason the cookie and the emailed
  code stay in place rather than being replaced.
- **Node can verify P-256** (`crypto.verify`) with no new dependency, so the server half adds no package.

---

## 5. Data model — migration `029_wallet_step_up.sql`, forward-only

Following `028_wallet_signin.sql` exactly: RLS enabled, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`,
`GRANT ... TO service_role`, functions `SECURITY DEFINER` with `search_path = pg_catalog, public`, owner
`postgres`, and revoked from every non-service role.

```
wallet_trusted_devices
  device_hash   TEXT      -- sha256 of the cookie value; the raw value is never stored
  user_id       UUID      REFERENCES users(id) ON DELETE CASCADE
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  last_ip       TEXT
  label         TEXT      -- derived from the user agent at enrolment
  public_key    TEXT      -- Part 2; NULL until a device key is registered
  revoked_at    TIMESTAMPTZ
  PRIMARY KEY (device_hash, user_id)

wallet_signin_stepups
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  device_hash    TEXT NOT NULL
  wallet_address TEXT NOT NULL
  code_hmac      TEXT NOT NULL
  attempts       INTEGER NOT NULL DEFAULT 0
  max_attempts   INTEGER NOT NULL DEFAULT 5
  expires_at     TIMESTAMPTZ NOT NULL
  consumed_at    TIMESTAMPTZ
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

RPCs (atomic where a race matters, advisory lock on the account as `verify_wallet_signin` does):

- `begin_wallet_stepup(p_user, p_device_hash, p_wallet, p_code_hmac, p_ttl)` — consumes any existing pending
  for the pair, then inserts. **One live code per (account, device), always.**
- `complete_wallet_stepup(p_id, p_code_hmac)` — `FOR UPDATE`, verifies TTL and attempt count, **consumes on
  every outcome**, increments `attempts` on mismatch, raises when exhausted or expired, returns `user_id` on
  success. Raising (not returning NULL) keeps "no such pending" distinguishable to the server while the
  caller keeps returning one generic message.
- `trust_wallet_device(...)` / `revoke_wallet_device(...)` — small state transitions; RPCs for consistency
  with the rest of the schema.
- `prune_wallet_stepups(p_older_than INTERVAL)` — mirrors `prune_wallet_signin_challenges`.

**Migration ordering (project rule 6):** apply to production *before* merging the code that uses it. The gate
can only be switched on once the tables exist, and the branch that reads them must not be reachable in
production first.

---

## 6. What changes for members

| | Today | After Part 1 | After Part 2 |
|---|---|---|---|
| Sign-in on a known browser | wallet → in | wallet → in | wallet → in |
| Sign-in on a new phone | wallet → in | wallet → code → in (~20 s) | once: wallet → code → in; thereafter wallet → in |
| Safari member returning after 2 weeks | wallet → in | one code | one code |
| Forgot email access | password sign-in | password sign-in | password sign-in |

**The escape hatch that makes fail-closed acceptable:** wallet sign-in is an *alternative* to password and
OAuth sign-in, never the only way in. A member who cannot receive the code can still sign in with their
email, so a mail outage degrades convenience rather than locking anyone out. That is what allows §3.3 to fail
closed without a support incident.

---

## 7. Blast radius — why this needs no reduced-privilege wallet session

An earlier draft of this design considered issuing a *lesser* session for wallet sign-in. **That is now
unnecessary, and worth recording as rejected:** the step-up gates session *issuance*, so there is no session
to contain. By the time cookies exist, the device has either been trusted before or completed the code.
R-020 already removed the wallet's ability to set an email password, and high-value actions are behind
`requireActiveAdmin` / `requireCapability`.

---

## 8. Residual risk, stated plainly

- **Part 1 alone does not close the relay.** An attacker who has the victim's attention for long enough to get
  a signature can ask for the code from the next email, and it works. Part 1 removes the *walk-away* case —
  the common one — and forces the attacker into a second, explicitly warned deception. It is a large
  improvement and it is **not** a closure.
- **R-021 is closed only by Part 2**, and only in this sense: a factor that cannot be exported cannot be
  relayed, so a cooperative victim stops being sufficient. Endpoint compromise, malware driving a real
  browser, or a member voluntarily handing over an unlocked device remain outside any control here.
- **Part 1's device cookie is a bearer handle.** Its theft lowers the bar from "signature + code" to
  "signature" — but signature forgery is the hard part, and stealing the cookie implies XSS or local
  compromise. Part 2 removes even this, since the key cannot be copied.
- **A relayed sign-in that completes the step-up still gets a session.** Detection (the shipped alert) remains
  the only signal that it happened, which is why it stays.
- These are **reasoning, not measurements** — nothing in this document has been executed.

---

## 9. Related vector not yet covered: wallet *linking*

`wallet_verification_challenges` drives a signature to **link** a wallet to the signed-in account. Relaying
that signature lets an attacker attach the *victim's* wallet to the *attacker's* account — and because
`users_wallet_address_unique` allows one account per address, the victim could then never link their own
wallet. That is griefing and impersonation, not account takeover, but it is the same handshake and the same
weakness.

**Recommendation:** put the linking flow behind the same device gate, so a relayed verification signature is
also insufficient. This is a small addition once §3 exists, and it should be decided deliberately rather than
inherited by accident.

---

## 10. Verification plan (how we would prove it, and what would fail)

Extend `scripts/wallet-signin-verify.ts` — the harness that already drives the real HTTP surface with real
keypairs. Assertions, each of which must be mutation-controlled by reintroducing the defect:

1. **The relay stops.** Challenge in context A, completed in context B with a valid signature, no device
   cookie → the response is step-up-required, **and `GET /dashboard` is not 200**. *This is the assertion the
   entire design exists for — today it returns 200. The mutation that removes the gate must fail this test;
   if any mutation does not, the fix is cosmetic.*
2. **No session without a code.** The pending row exists, no code submitted → `/dashboard` still not 200.
3. **Completion mints a session.** The harness seeds its own pending row through the service role with a code
   it chose (it cannot read the member's email, and should not be able to), submits it, and asserts
   `/dashboard` → 200. The email path itself is already proven by the shipped alert.
4. **The device is then trusted.** A second sign-in from the same cookie needs no code.
5. **Revocation works.** Remove the device → the next sign-in steps up again.
6. **A code cannot be reused**, cannot complete a different pending, and dies at TTL.
7. **Attempts exhaust** and the pending is consumed; a correct code afterwards is refused.
8. **Failures do not enumerate** — unknown, expired, wrong code and exhausted return byte-identical output.
9. **Fail-closed on an undeliverable code**: with no mail transport configured, no session is minted and the
   refusal is audited with its reason.

Plus the standing rule for this subsystem: **a browser-facing change is not done until it is exercised in a
real browser with a real wallet** (Phantom *and* Solflare — a permissive wallet signing a message proves
nothing about a strict one).

---

## 11. Decisions this needs from the owner

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Ship Part 1 (code on-ramp) alone, or Part 1 → Part 2 (device key)? | **Both, phased.** Part 1 is a prerequisite for Part 2's enrolment and stops the ordinary attack immediately; Part 2 is what closes R-021. |
| **D2** | Device trust: automatic on step-up, or an opt-in "remember this browser"? TTL? | **Automatic, 90 days**, with a checkbox to opt out for a shared machine. |
| **D3** | Fail closed when the code cannot be emailed? | **Yes.** The escape hatch is password sign-in, so nobody is locked out. |
| **D4** | Put wallet *linking* behind the same gate (§9)? | **Yes** — same handshake, real griefing vector. |
| **D5** | Member-visible device list with revocation in `/dashboard/wallet`? | **Yes** — it turns the R-021 alert from "unlink your wallet" into "remove that device". |
| **D6** | Accept the Safari eviction cost (extra step-up after ~7 idle days)? | **Yes**, with the code as the fallback. Part 2 cannot fix a browser that deletes its own storage. |

## 12. Explicitly not doing

- **Challenge binding** — rejected in the threat model, with reasoning. Repeated here so it is not
  re-proposed: the attacker asks for the challenge, so they receive whatever binding is issued.
- **An approve-by-link email** — §1. It would let the victim authorise the attacker's pending attempt.
- **SMS** — no phone factor is configured (`external_phone_enabled: false`), and SMS codes are the most
  phishable form of this control.
- **Supabase's native MFA step-up as the base** — TOTP is enabled in the project, but enrolment is zero and
  TOTP codes are read aloud exactly like emailed ones. It remains a legitimate *additional* factor a member
  may enrol; it is not the design.
