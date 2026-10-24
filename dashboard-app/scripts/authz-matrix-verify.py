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
import urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(HERE, "..", ".env.staging.local")
EMAIL = "authz-matrix-probe@example.invalid"


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
        st, res = self.sb("POST", "/auth/v1/admin/users", {"email": EMAIL, "email_confirm": True})
        if st == 200 and isinstance(res, dict):
            self.uid = res["id"]
        else:                                     # already exists
            st, res = self.sb("GET", f"/auth/v1/admin/users?email={EMAIL}")
            users = (res.get("users") or []) if isinstance(res, dict) else []
            assert users, f"cannot create or find test user: {st} {res}"
            self.uid = users[0]["id"]
        print(f"  staging test user: {self.uid}")
        return self.uid

    def set_authz(self, role=None, status=None):
        patch = {}
        if role: patch["role"] = role
        if status: patch["status"] = status
        return self.sb("PATCH", f"/rest/v1/user_authorizations?user_id=eq.{self.uid}", patch)

    def teardown(self):
        for p in (f"/rest/v1/user_authorizations?user_id=eq.{self.uid}",
                  f"/rest/v1/users?id=eq.{self.uid}",
                  f"/auth/v1/admin/users/{self.uid}"):
            self.sb("DELETE", p)
        st, res = self.sb("GET", f"/rest/v1/user_authorizations?select=user_id&user_id=eq.{self.uid}")
        gone_rows = isinstance(res, list) and len(res) == 0
        print(f"  teardown: user_authorizations rows={len(res) if isinstance(res,list) else res} "
              f"-> {'clean' if gone_rows else 'DIRTY'}")

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

    def check(self, label, pred, code, loc, note=""):
        ok = bool(pred(code, loc))
        self.results.append(ok)
        shown = (loc or "").replace(self.base, "") or "-"
        print(f"  {'✅' if ok else '❌'} {label:52} {code}  -> {shown[:44]:44} {note}")

    # ---- the gate ----------------------------------------------------------
    def run(self):
        self.setup_user()
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
        self.set_authz(role="member", status="active")

        print("\n  session refresh (setAll adapter — silent-session-loss path)")
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
            hb = hashlib.sha256(json.dumps(valid).encode()).hexdigest()[:10]
            ha = hashlib.sha256(json.dumps(refreshed).encode()).hexdigest()[:10]
            self.check("refreshed token differs", lambda c, l: hb != ha, 0, None, note=f"[{hb} != {ha}]")
        else:
            self.check("refreshed cookie usable (2nd request)", lambda c, l: False, 0, None)

        self.teardown()
        return all(self.results), len(self.results)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", help="deployed preview base URL")
    a = ap.parse_args()
    surl, skey = load_staging()
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
    passed = sum(p.results)
    print(f"\n{passed}/{n} checks passed")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
