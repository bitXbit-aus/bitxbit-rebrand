#!/usr/bin/env python3
"""
Authenticated authorisation-matrix gate for the dashboard-app (R-007 / plan §5.3).

A middleware regression CANNOT fail a build, so this is the executable gate for it:
it signs a real session against a DEPLOYED preview and asserts the full matrix,
including the session-refresh path that is otherwise invisible until users report
random logouts.

Why a session is minted rather than typed in:
  * deploy previews are staging-scoped (D4), so no production account exists there;
  * it avoids handling any password or one-time code.

What it does, against a staging-scoped preview:
  1. creates an ephemeral staging test user (admin API),
  2. mints a session by following a magic-link action link (no password, no OTP),
  3. builds the SSR auth cookie with the app's OWN encoder
     (@supabase/ssr createChunks + stringToBase64URL) so the format cannot drift,
  4. runs the matrix: unauthenticated / suspended / deactivated / member / admin
     across /dashboard, /admin and /auth/login,
  5. forces the token-refresh path with an expired-access cookie and asserts the
     response carries a NEW usable cookie (the `setAll` adapter),
  6. deletes the test user and shreds all session material.

Prerequisites: `dashboard-app/.env.staging.local` with STAGING_SUPABASE_URL and
STAGING_SUPABASE_SERVICE_ROLE_KEY; `node`; a deployed preview URL.

Usage:  python3 scripts/authz-matrix-verify.py https://<preview-host>
Exit code 0 only if every check passes.
"""
import argparse, base64, hashlib, json, os, subprocess, sys, tempfile, time
import urllib.parse, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(HERE, "..", ".env.staging.local")
PRODUCTION_SUPABASE_REF = "flasgvendiiasuixeqzu"
PRODUCTION_APP_HOST = "app.bitxbit.com.au"
# A UNIQUE address per run. Reusing one address would need an "already exists" path, and
# the only way to find an existing user is the admin list endpoint — which IGNORES its
# ?email= filter (measured 2026-10-24: a bogus address returned all 19 users). Selecting
# from that list by index would target an UNRELATED real user and then mutate and delete
# them. So: create a fresh user, and never look one up by list position.
EMAIL = f"authz-matrix-probe-{os.urandom(4).hex()}@example.invalid"
# /dashboard renders this (the email local part) when its own getUser() succeeds.
PROBE_LOCALPART = EMAIL.split("@")[0]


def load_staging():
    env = {}
    with open(ENV_FILE) as fh:
        for line in fh:
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env["STAGING_SUPABASE_URL"].rstrip("/"), env["STAGING_SUPABASE_SERVICE_ROLE_KEY"]


def decode_session(cookies):
    """Decode a Supabase SSR auth cookie back into its session dict (both encodings)."""
    val = "".join(c["value"] for c in cookies if c["name"].startswith("sb-"))
    if not val:
        return None
    try:
        if val.startswith("base64-"):
            raw = val[len("base64-"):]
            raw += "=" * (-len(raw) % 4)
            return json.loads(base64.urlsafe_b64decode(raw))
        return json.loads(urllib.parse.unquote(val))
    except Exception:
        return None


class Probe:
    def __init__(self, base, surl, skey, workdir):
        self.base, self.surl, self.skey, self.work = base, surl, skey, workdir
        self.uid = None
        self.results = []

    # ---- staging admin API -------------------------------------------------
    def sb(self, method, path, body=None):
        h = {"apikey": self.skey, "Authorization": f"Bearer {self.skey}",
             "Content-Type": "application/json", "Prefer": "return=representation"}
        req = urllib.request.Request(self.surl + path,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     method=method, headers=h)
        try:
            r = urllib.request.urlopen(req)
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()[:200]

    def setup_user(self):
        """Create this run's own user. There is deliberately NO lookup fallback.

        `GET /auth/v1/admin/users?email=...` ignores the filter (verified 2026-10-24), so a
        "find the existing user" path would select an arbitrary real account and the run
        would then change its authorisation and delete it. Failing loudly is the safe
        behaviour; a stale run's leftovers are recoverable, a deleted user is not.
        """
        st, res = self.sb("POST", "/auth/v1/admin/users", {"email": EMAIL, "email_confirm": True})
        if st != 200 or not isinstance(res, dict) or not res.get("id"):
            raise RuntimeError(
                f"refusing to continue: could not create test user ({st}): {str(res)[:200]}. "
                "Not falling back to a list lookup — that endpoint ignores ?email= and would "
                "select an unrelated account."
            )
        self.uid = res["id"]
        print(f"  staging test user: {self.uid} ({EMAIL})")
        return self.uid

    def set_authz(self, role=None, status=None):
        patch = {}
        if role: patch["role"] = role
        if status: patch["status"] = status
        return self.sb("PATCH", f"/rest/v1/user_authorizations?user_id=eq.{self.uid}", patch)

    def teardown(self):
        """Delete the test user and PROVE it is gone. Returns True only if all three
        surfaces are empty — a cleanup failure must not be reported as success."""
        for p in (f"/rest/v1/user_authorizations?user_id=eq.{self.uid}",
                  f"/rest/v1/users?id=eq.{self.uid}",
                  f"/auth/v1/admin/users/{self.uid}"):
            self.sb("DELETE", p)
        st_a, rows_a = self.sb("GET", f"/rest/v1/user_authorizations?select=user_id&user_id=eq.{self.uid}")
        st_u, rows_u = self.sb("GET", f"/rest/v1/users?select=id&id=eq.{self.uid}")
        st_b, body_b = self.sb("GET", f"/auth/v1/admin/users/{self.uid}")
        rows_a = rows_a if isinstance(rows_a, list) else ["<error>"]
        rows_u = rows_u if isinstance(rows_u, list) else ["<error>"]
        auth_gone = st_b in (400, 404)          # a deleted auth user is no longer retrievable
        clean = (len(rows_a) == 0) and (len(rows_u) == 0) and auth_gone
        print(f"  teardown: user_authorizations={len(rows_a)} rows, users={len(rows_u)} rows, "
              f"auth user={'gone' if auth_gone else f'STILL PRESENT ({st_b})'} -> {'clean' if clean else 'DIRTY'}")
        if not clean:
            print(f"  ⚠️  TEST USER NOT FULLY REMOVED: {self.uid} ({EMAIL}) — remove it manually")
        return clean

    # ---- session ----------------------------------------------------------
    def mint_session(self):
        st, link = self.sb("POST", "/auth/v1/admin/generate_link", {"type": "magiclink", "email": EMAIL})
        assert isinstance(link, dict), f"generate_link failed: {st} {link}"
        assert st == 200 and link.get("hashed_token"), f"generate_link failed: {st} {link}"

        class NoRedir(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k): return None
        op = urllib.request.build_opener(NoRedir)
        try:
            r = op.open(urllib.request.Request(link["action_link"], method="GET"))
            loc = r.headers.get("Location")
        except urllib.error.HTTPError as e:
            loc = e.headers.get("Location")
        assert loc and "#" in loc, "action link produced no fragment"
        kv = dict(p.split("=", 1) for p in loc.split("#", 1)[1].split("&") if "=" in p)
        assert "access_token" in kv, f"no access_token in redirect: {list(kv)}"
        payload = kv["access_token"].split(".")[1]
        payload += "=" * (-len(payload) % 4)
        sess = {"access_token": kv["access_token"], "token_type": kv.get("token_type", "bearer"),
                "expires_in": int(kv.get("expires_in", 3600)),
                "expires_at": int(kv.get("expires_at") or json.loads(base64.urlsafe_b64decode(payload))["exp"]),
                "refresh_token": kv["refresh_token"]}
        _, user = self.sb("GET", f"/auth/v1/admin/users/{self.uid}")
        sess["user"] = user
        return sess

    def build_cookies(self, sess, expired=False):
        """Use the app's own encoder so the cookie format cannot drift from @supabase/ssr."""
        s = dict(sess)
        if expired:
            s["expires_at"] = int(time.time()) - 600
        path = os.path.join(self.work, "session.json")
        with open(path, "w") as fh:
            json.dump(s, fh)
        os.chmod(path, 0o600)
        key = "sb-" + self.surl.split("//")[1].split(".")[0] + "-auth-token"
        js = (
            'const fs=require("fs");'
            'const {createChunks,stringToBase64URL}=require("@supabase/ssr/dist/main/utils");'
            f'const k={json.dumps(key)};'
            'const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));'
            'process.stdout.write(JSON.stringify(createChunks(k,"base64-"+stringToBase64URL(JSON.stringify(s)))))'
        )
        out = subprocess.run(["node", "-e", js, path], cwd=HERE, capture_output=True, text=True)
        assert out.returncode == 0, out.stderr
        return json.loads(out.stdout)

    # ---- HTTP -------------------------------------------------------------
    def get(self, path, cookies=None):
        h = {"Accept": "text/html"}
        if cookies:
            h["Cookie"] = "; ".join(f"{c['name']}={c['value']}" for c in cookies)

        class NoRedir(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k): return None
        op = urllib.request.build_opener(NoRedir)
        try:
            r = op.open(urllib.request.Request(self.base + path, headers=h, method="GET"))
            return r.status, r.headers.get("Location"), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("Location"), e.headers

    def get_body(self, path, cookies=None):
        h = {"Accept": "text/html"}
        if cookies:
            h["Cookie"] = "; ".join(f"{c['name']}={c['value']}" for c in cookies)

        class NoRedir(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k): return None
        op = urllib.request.build_opener(NoRedir)
        try:
            r = op.open(urllib.request.Request(self.base + path, headers=h, method="GET"))
            return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")

    @staticmethod
    def rendered_page(body, marker):
        """Reject Next's global error shell and require complete, page-specific HTML.

        A streamed Server Component can send HTTP 200 before rendering fails, so status
        alone is not a regression check. Requiring the marker catches failures before
        the page returns its JSX (including the repeated-searchParams crash), while the
        closing tag rejects a truncated stream.
        """
        lower = body.lower()
        return (
            marker in body
            and "</html>" in lower
            and 'id="__next_error__"' not in lower
            and "application error:" not in lower
        )

    def check(self, label, pred, code, loc, note=""):
        ok = bool(pred(code, loc))
        self.results.append(ok)
        shown = (loc or "").replace(self.base, "") or "-"
        print(f"  {'✅' if ok else '❌'} {label:52} {code}  -> {shown[:44]:44} {note}")

    # ---- the gate ----------------------------------------------------------
    def run(self):
        self.setup_user()
        try:
            return self._run_checks()
        finally:
            # Always attempt removal, including after an exception: an abandoned account
            # left promoted to admin with a live session is worse than a failed test run.
            try:
                clean = self.teardown()
            except Exception as exc:                       # noqa: BLE001 - must never mask
                print(f"  ⚠️  teardown raised: {exc}")
                clean = False
            self.results.append(clean)
            self.cleanup_ok = clean

    def _run_checks(self):
        sess = self.mint_session()
        valid = self.build_cookies(sess)
        expired = self.build_cookies(sess, expired=True)
        print(f"  session minted; cookie chunks: {[c['name'] for c in valid]}")

        self.set_authz(role="member", status="active")
        print("\n  active member")
        self.check("no cookie -> /dashboard  [control]", lambda c, l: c == 307 and l and l.endswith("/auth/login"),
                   *self.get("/dashboard")[:2])
        self.check("session -> /dashboard  [allowed]", lambda c, l: c == 200, *self.get("/dashboard", valid)[:2])
        self.check("session -> /admin      [denied]", lambda c, l: c == 307 and l and l.endswith("/dashboard"),
                   *self.get("/admin", valid)[:2])
        self.check("session -> /auth/login [bounced]", lambda c, l: c == 307 and l and l.endswith("/dashboard"),
                   *self.get("/auth/login", valid)[:2])

        self.set_authz(status="suspended")
        print("\n  suspended")
        self.check("session -> /dashboard [denied]", lambda c, l: c == 307 and l and "error=account_inactive" in l,
                   *self.get("/dashboard", valid)[:2])
        self.check("session -> /auth/login [not bounced]", lambda c, l: c == 200, *self.get("/auth/login", valid)[:2])

        self.set_authz(status="deactivated")
        print("\n  deactivated")
        self.check("session -> /dashboard [denied]", lambda c, l: c == 307 and l and "error=account_inactive" in l,
                   *self.get("/dashboard", valid)[:2])

        self.set_authz(role="admin", status="active")
        print("\n  admin")
        self.check("session -> /admin [allowed]", lambda c, l: c == 200, *self.get("/admin", valid)[:2])
        # A repeated query key (?search=a&search=b) delivers searchParams values as an ARRAY.
        # Before the guard in app/admin/users/page.tsx this threw on `.trim()` and 500'd.
        repeated_code, repeated_body = self.get_body("/admin/users?search=a&search=b", valid)
        repeated_rendered = self.rendered_page(repeated_body, ">Users<")
        self.check("repeated query key renders /admin/users",
                   lambda c, l: c == 200 and repeated_rendered, repeated_code, None,
                   note="[complete Users page]" if repeated_rendered else "[error/truncated page]")
        self.set_authz(role="member", status="active")

        print("\n  session refresh (setAll adapter — silent-session-loss path)")
        # Each refresh check gets its OWN session: a refresh ROTATES the refresh token, so
        # reusing one cookie across checks would depend on the library's reuse window and be
        # intermittently flaky — the worst kind of gate.
        expired_redirect = self.build_cookies(self.mint_session(), expired=True)
        expired_page = self.build_cookies(self.mint_session(), expired=True)

        code, loc, headers = self.get("/dashboard", expired)
        setc = headers.get_all("Set-Cookie") or []
        self.check("expired access still serves /dashboard", lambda c, l: c == 200, code, loc)
        self.check("response carries refreshed cookie", lambda c, l: bool(setc), code, loc,
                   note=f"[{len(setc)} Set-Cookie]")
        if setc:
            refreshed = [{"name": s.split(";", 1)[0].split("=", 1)[0], "value": s.split(";", 1)[0].split("=", 1)[1]}
                         for s in setc]
            c2, l2, _ = self.get("/dashboard", refreshed)
            self.check("refreshed cookie usable (2nd request)", lambda c, l: c == 200, c2, l2)
            # Compare the TOKENS, not a serialisation hash: a hash of the whole cookie set
            # differs for key ordering or an extra cookie, so it can "pass" without any
            # token having changed. Decode both and look at the values that matter.
            before, after = decode_session(valid), decode_session(refreshed)
            if before and after:
                self.check("access token actually changed",
                           lambda c, l: before.get("access_token") != after.get("access_token"), 0, None)
                self.check("refresh token actually rotated",
                           lambda c, l: before.get("refresh_token") != after.get("refresh_token"), 0, None)
                self.check("refreshed expiry is in the future",
                           lambda c, l: (after.get("expires_at") or 0) > time.time(), 0, None)
                self.check("refreshed session is the same user",
                           lambda c, l: (before.get("user") or {}).get("id") == (after.get("user") or {}).get("id"),
                           0, None)
            else:
                self.check("refreshed cookie decodes to a session", lambda c, l: False, 0, None,
                           note="[could not decode — cannot claim a refresh]")
        else:
            self.check("refreshed cookie usable (2nd request)", lambda c, l: False, 0, None)

        # (a) The refresh must ALSO reach the client on a REDIRECT branch — the defect fixed
        #     in PR #51. Without the fix this returns the redirect with no Set-Cookie.
        self.set_authz(status="suspended")
        c_r, l_r, h_r = self.get("/dashboard", expired_redirect)
        setc_r = h_r.get_all("Set-Cookie") or []
        self.check("redirect branch carries the refreshed cookie",
                   lambda c, l: c == 307 and bool(setc_r), c_r, l_r, note=f"[{len(setc_r)} Set-Cookie]")
        self.set_authz(role="member", status="active")

        # (b) Did the refreshed session reach the PAGE, or only middleware? /dashboard renders
        #     the user's display name and falls back to the literal "there" when its own
        #     getUser() sees nothing — so the body discriminates the two.
        c_p, body = self.get_body("/dashboard", expired_page)
        saw_user = self.rendered_page(body, PROBE_LOCALPART)
        self.check("refreshed session reaches the PAGE (not just middleware)",
                   lambda c, l: c_p == 200 and saw_user, c_p, None,
                   note="[display name present]" if saw_user else "[page fell back to 'there']")

        return all(self.results), len(self.results)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", help="deployed preview base URL")
    a = ap.parse_args()
    surl, skey = load_staging()
    target_host = urllib.parse.urlparse(a.base).hostname
    staging_ref = surl.split("//")[1].split(".")[0]
    if staging_ref == PRODUCTION_SUPABASE_REF or target_host == PRODUCTION_APP_HOST:
        print("REFUSING: the authenticated verification gate must never target production")
        return 2
    print(f"target: {a.base}\nstaging: {surl.split('//')[1].split('.')[0]}\n")
    work = tempfile.mkdtemp(prefix="authzmatrix-")
    os.chmod(work, 0o700)
    p = Probe(a.base.rstrip("/"), surl, skey, work)
    try:
        ok, n = p.run()
    finally:
        # shred session material regardless of outcome
        for f in os.listdir(work):
            path = os.path.join(work, f)
            size = os.path.getsize(path)
            with open(path, "r+b") as fh:
                for _ in range(4):
                    fh.seek(0); fh.write(os.urandom(size)); fh.flush(); os.fsync(fh.fileno())
            os.remove(path)
        os.rmdir(work)
    # The exit code must include the teardown result appended in run()'s finally block,
    # so a run that left a test account behind cannot report success.
    passed = sum(p.results)
    total = len(p.results)
    ok = ok and all(p.results)
    print(f"\n{passed}/{total} checks passed" + ("" if p.results[-1] else "  ⚠️ CLEANUP FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
