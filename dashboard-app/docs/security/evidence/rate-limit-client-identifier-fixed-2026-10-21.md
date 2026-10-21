# R-004 client identifier — fixed and verified in production (2026-10-21)

**Status:** **FIXED AND VERIFIED.** The rate limiter now keys on the real client address, the key
cannot be chosen by the caller, and enforcement blocks at the configured limit.

Chain: [`rate-limit-client-identifier-2026-10-20.md`](rate-limit-client-identifier-2026-10-20.md)
(§7: the falsified first attempt) →
[`rate-limit-client-identifier-instrument-2026-10-21.md`](rate-limit-client-identifier-instrument-2026-10-21.md)
(the instrument) → this record.

| | |
|---|---|
| Code | PR #15, merged as `00c174baa8b8139eaf32774122e975879a30c3e0` |
| Deploy | `6ad9387263ab3f63dccf8edd` (ready, current) |
| Instrument | removed; `DIAG_HEADERS_TOKEN` deleted and its absence verified by re-listing |

## 1. What the instrument showed

At an **origin serverless function**, for a request whose real client is `206.83.119.2`:

```
x-forwarded-for:            206.83.119.2, 3.107.102.194, 13.55.15.16
x-nf-client-connection-ip:  3.107.102.194
```

Three things were tested rather than assumed:

| Probe | Result |
|---|---|
| Forge `X-Forwarded-For: 1.2.3.4` | `1.2.3.4, 206.83.119.2, 3.107.102.194, 16.176.74.16` — **preserved and prepended** |
| Forge `X-Nf-Client-Connection-Ip: 9.9.9.9` | `3.107.102.194` — **overwritten**, not spoofable |
| Forge `x-bitxbit-client-ip: 9.9.9.9` | no effect — the header is **absent at the origin** |

**`x-nf-client-connection-ip` is trustworthy but wrong:** it is not client-controllable, yet it holds
an **edge-node** address that varies per edge node. That is exactly why limits were per-edge-node.

**The leftmost `x-forwarded-for` entry is attacker-controlled.** Keying on it — the obvious "fix" —
would have handed every caller its own bucket: a rate-limit bypass, strictly worse than the defect.

Independent confirmation that the resolved address is the client's: `x-nf-geo` for those requests
decodes to `{"city":"Quirindi","country":{"code":"AU"},...}` — the client's actual location,
derivable only from `206.83.119.2`, never from the Sydney edge address.

## 2. The rule

The client is the hop **immediately left of the Netlify anchor** in the forwarded chain. It survives
forgery because a client's injected entries always sit *left* of the chain Netlify appends, so the
anchor is located **from the right** — and a forged copy of the anchor value cannot displace the
real one (it is found from the right, and the copy sits to its left).

Resolution happens **at the origin**, because the middleware's forwarded header provably does not
survive to a serverless function — so `getClientIdentifier` no longer reads that header at all.

When nothing trustworthy resolves, the key is `anonymous`: one shared bucket, coarse but never
caller-chosen.

## 3. Verification — live, not local

**Keying.** Five requests from the client, then four with a forged chain:

```
before:  (keys carried 3.107.102.194 / 13.236.191.253 — edge nodes)
after:   api:token-stats:206.83.119.2   count=5   ← the five requests
```

**Spoof-resistance.** The four forged requests (`X-Forwarded-For: 9.9.9.9`, `X-Real-IP: 8.8.8.8`,
`x-bitxbit-client-ip: 7.7.7.7`) produced **no new keys at all** — the existing key simply advanced
`5 → 9`, exactly +4.

**Enforcement.** `/api/token-stats` allows 30 per 60 s. Thirty-eight requests:

```
non-429 = 30   429s = 8   first 429 at request #31
retry-after: 29    cache-status: fwd=bypass    body: {"error":"Too many requests..."}
```

Blocked at exactly the 31st request — the configured limit, per client.

**Unit layer.** 109/109 tests (6 new); **4/4 mutations detected**: take the leftmost entry instead of
the hop left of the anchor; reinstate the client-supplied header; return the anchor ignoring the
chain; search the chain from the left (this one fails *only* the anchor-copy forgery case).

## 4. Caveat worth carrying forward

`/api/public/resolve-referral` **caches responses despite `export const dynamic = "force-dynamic"`**:
36 requests with varied `_rsc` values produced **no counter change** and no 429s, while
`/api/token-stats` incremented 1:1 on the same technique. Rate-limit accounting therefore depends on
the request actually reaching the handler, and on that route it often does not.

This is a real, separate issue: a rate limit is only as good as the route's cache behaviour, and a
cached response bypasses both the limiter and any per-request accounting. It is **not** part of
R-004 (the identifier is correct, and enforcement is proven on a route that reaches the handler), but
it deserves its own risk entry.
