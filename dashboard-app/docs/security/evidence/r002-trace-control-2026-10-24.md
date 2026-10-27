# R-002 — discriminating control for the `bigint-buffer` tracing exclusion (2026-10-24)

**Status: the control is now DISCRIMINATING and the exclusion is PROVEN EFFECTIVE.**

This closes the top structural finding raised by *both* independent reviewers against the R-007
release: that the previously recorded evidence for R-002's exclusion was configuration acceptance,
not a control.

---

## 1. The defect in the previous evidence

The recorded check was "**0 `.node` files under `.next`**", described as proof that
`outputFileTracingExcludes` keeps `bigint-buffer`'s vulnerable native addon out of the deployment.

**That check cannot fail.** Measured 2026-10-24, removing the exclusion entirely and rebuilding
produced the *identical* result, because nothing in the default traced server graph reaches the
addon. A check that returns the same value whether the control is present or absent is not a control.

Independent review said so explicitly:

> *"Configuration acceptance does not establish that the route pattern, package path, or Netlify
> packaging process excludes the vulnerable addon. The current checks pass even when the control is
> removed."* — GPT-6.1 Sol Pro

> *"The control named as a 'must-not-weaken' invariant is currently unfalsifiable."* — Gemini 3 Flash

---

## 2. The control

`dashboard-app/scripts/r002-trace-control.py` — two builds of the same code with **one synthetic
traceable import** of `bigint-buffer`, so the addon genuinely enters the traced graph:

- a temporary `app/__r002probe/route.ts` that imports `bigint-buffer` at runtime;
- `serverExternalPackages: ['bigint-buffer']` so the import stays a real runtime require;
- the exclusion made switchable so a single config serves both builds;
- the repository restored on every exit path (verified clean).

The discriminator is the **content of the `.nft.json` traces**, never a physical count of `.node`
files.

### Measured result

| Build | `.nft.json` files mentioning `bigint-buffer` | trace entries naming `bigint_buffer.node` | trace entries naming `bigint-buffer/build` | `.node` files under `.next` |
|---|---|---|---|---|
| exclusion **ON** | 10 | **0** | **0** | **0** |
| exclusion **OFF** | 10 | **10** | **10** (`build/Release/bigint_buffer.node`) | **0** |

**Interpretation.**

1. The addon **is** traced when the exclusion is off → the fixture reaches the tracer, so the
   control is not vacuous.
2. The addon is **absent** when the exclusion is on → the exclusion genuinely works.
3. The old `.node`-file count is **0 in both rows** → confirming in the same experiment that the
   previous evidence could not distinguish "excluded" from "never included".

Exit code 0 only on that combination. An inconclusive run (the addon not traced even with the
exclusion off) exits **2** and is explicitly *not* recorded as a pass; an ineffective exclusion
exits **1**.

### Reproduce

```bash
cd dashboard-app
python3 scripts/r002-trace-control.py     # 0 = effective and discriminating
```

---

## 3. What also changed

- `lib/dependency-exposure.test.ts` no longer merely asserts that the config *mentions* an
  exclusion. It now asserts that the configured pattern **covers the real addon path present in the
  installed tree**, and that the option sits at the **top level** rather than nested under
  `experimental` (where Next 15 silently ignores it). The test fails if the glob or the package
  layout drifts.
- `next.config.mjs` is **unchanged** by this work — the control instruments it temporarily and
  restores it.

## 4. Honest scope

- The control proves the **tracing** exclusion works on a local production build. It does not by
  itself prove Netlify's packaging honours it; that is a separate artifact-inspection step and is
  recorded as remaining.
- The addon remains present in the installed tree and is reachable in principle; the live
  protection is still the `Buffer.from` argument guard at the only caller
  (`@solana/buffer-layout-utils`), asserted separately in the same test file.

**R-002 is now backed by a falsifiable measurement rather than a configuration assertion.**
