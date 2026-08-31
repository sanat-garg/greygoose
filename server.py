#!/usr/bin/env python3
"""
GREYGOOSE dev server.

Serves the site, gives the admin panel somewhere to save to, and can enforce
the access gate.

    python3 server.py                # http://127.0.0.1:8777
    python3 server.py 9000           # a different port
    python3 server.py --gate         # also enforce the question gate
    python3 server.py --host 0.0.0.0 # listen on the network (use with --gate)

Endpoints:
    GET  /api/questions              questions, with the answer hashes removed
    POST /api/unlock  {id, answer}   check an answer, set the access cookie
    GET  /api/party?id=&k=           one party only, for share links
    POST /api/save    {...}          rewrite data.json
    POST /api/upload  {name,dataUrl} write photos/<name>
    POST /api/delete  {path}         delete photos/<name>

Without --gate this is a local editing tool with no auth: keep it on
localhost. With --gate, data.json and the write endpoints require a cookie
that is only issued after a correct answer. Share links stay open by design —
they expose exactly one party and nothing else.
"""

import base64
import hashlib
import hmac
import json
import os
import re
import shutil
import sys
import time
import unicodedata
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
PHOTOS = os.path.join(ROOT, "photos")
DATA = os.path.join(ROOT, "data.json")
BACKUPS = os.path.join(ROOT, ".backups")
SECRET_FILE = os.path.join(ROOT, ".secret")
ADMIN_FILE = os.path.join(ROOT, ".adminpass")   # salted hash, never committed

MAX_BODY = 25 * 1024 * 1024  # 25 MB per request
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg"}
COOKIE = "gg_access"
ADMIN_COOKIE = "gg_admin"

GATE = False  # set from the command line


# ---------------------------------------------------------------- helpers ----

def secret():
    """A stable per-install key so unlock cookies survive a restart."""
    if not os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "wb") as fh:
            fh.write(os.urandom(32))
        os.chmod(SECRET_FILE, 0o600)
    with open(SECRET_FILE, "rb") as fh:
        return fh.read()


def token():
    return hmac.new(secret(), b"greygoose-access-v1", hashlib.sha256).hexdigest()


# ---- admin password ---------------------------------------------------------
# Kept in its own dotfile rather than data.json, because data.json is meant to
# be publishable and this must never be.

def admin_configured():
    return os.path.exists(ADMIN_FILE)


def set_admin_password(pw):
    salt = os.urandom(16).hex()
    digest = hashlib.sha256((salt + pw).encode()).hexdigest()
    with open(ADMIN_FILE, "w") as fh:
        fh.write(salt + "$" + digest)
    os.chmod(ADMIN_FILE, 0o600)


def check_admin_password(pw):
    if not admin_configured():
        return False
    with open(ADMIN_FILE) as fh:
        salt, _, digest = fh.read().strip().partition("$")
    return hmac.compare_digest(
        digest, hashlib.sha256((salt + pw).encode()).hexdigest()
    )


def admin_token():
    """Bound to the stored password, so changing it logs everyone out."""
    with open(ADMIN_FILE, "rb") as fh:
        return hmac.new(secret(), b"admin:" + fh.read(), hashlib.sha256).hexdigest()


def normalise(s):
    """Must match gate.js and admin.js exactly, or answers will never match."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    # keep only letters and digits, so capitals, spaces, hyphens and
    # apostrophes all stop mattering: "Arnold-Palmer" == "arnold palmer"
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def answer_hash(answer):
    return "sha256:" + hashlib.sha256(normalise(answer).encode()).hexdigest()


def load_data():
    with open(DATA, encoding="utf-8") as fh:
        return json.load(fh)


def safe_name(name):
    """Reduce an arbitrary upload name to a harmless flat filename."""
    name = os.path.basename(name or "")
    stem, ext = os.path.splitext(name)
    ext = ext.lower()
    if ext not in ALLOWED_EXT:
        return None
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-").lower()[:60]
    return (stem or "photo") + ext


# ---------------------------------------------------------------- handler ----

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # -- plumbing -------------------------------------------------------------

    def send_json(self, obj, status=200, cookie=None):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("bad content length")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def unlocked(self):
        if not GATE:
            return True
        raw = self.headers.get("Cookie")
        if not raw:
            return False
        jar = SimpleCookie()
        jar.load(raw)
        got = jar.get(COOKIE)
        return bool(got) and hmac.compare_digest(got.value, token())

    def is_admin(self):
        if not admin_configured():
            return True          # nothing set yet, so nothing to enforce
        raw = self.headers.get("Cookie")
        if not raw:
            return False
        jar = SimpleCookie()
        jar.load(raw)
        got = jar.get(ADMIN_COOKIE)
        return bool(got) and hmac.compare_digest(got.value, admin_token())

    def deny_admin(self):
        self.send_json({"ok": False, "error": "admin"}, 401)

    def deny(self):
        self.send_json({"ok": False, "error": "locked"}, 403)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    # -- GET ------------------------------------------------------------------

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/ping":
                # admin.js uses this to tell you up front whether saving works
                return self.send_json({"ok": True, "gate": GATE})
            if path == "/api/admin-status":
                return self.send_json({
                    "configured": admin_configured(),
                    "authed": self.is_admin(),
                })
            if path == "/api/questions":
                return self.api_questions()
            if path == "/api/party":
                return self.api_party()
        except Exception as exc:
            return self.send_json({"ok": False, "error": str(exc)}, 400)

        # never hand out the signing key, the backups, or any other dotfile
        if any(seg.startswith(".") for seg in path.split("/") if seg):
            self.send_error(404, "Not Found")
            return

        # the archive itself is what the gate protects
        if path in ("/data.json", "/data.json/") and not self.unlocked():
            return self.deny()
        return super().do_GET()

    def api_questions(self):
        access = load_data().get("access") or {}
        self.send_json({
            "enabled": access.get("enabled", False),
            "title": access.get("title", ""),
            "intro": access.get("intro", ""),
            # hashes deliberately stripped — the server does the checking
            "questions": [
                {"id": q.get("id"), "question": q.get("question")}
                for q in access.get("questions", [])
                if q.get("question") and q.get("hash")
            ],
        })

    def api_party(self):
        q = parse_qs(urlparse(self.path).query)
        pid = (q.get("id") or [""])[0]
        key = (q.get("k") or [""])[0]
        for p in load_data().get("parties", []):
            if p.get("id") == pid and p.get("share") and \
                    hmac.compare_digest(str(p["share"]), key):
                out = dict(p)
                out.pop("share", None)  # don't echo the key back into the page
                return self.send_json(out)
        self.send_json({"ok": False, "error": "not found"}, 404)

    # -- POST -----------------------------------------------------------------

    def do_POST(self):
        try:
            if self.path == "/api/unlock":
                return self.api_unlock()
            if self.path == "/api/submit":
                return self.api_submit()
            if self.path == "/api/admin-login":
                return self.api_admin_login()
            if self.path == "/api/admin-password":
                return self.api_admin_password()
            if self.path in ("/api/save", "/api/upload", "/api/delete"):
                if not self.unlocked():
                    return self.deny()
                if not self.is_admin():
                    return self.deny_admin()
                return {
                    "/api/save": self.api_save,
                    "/api/upload": self.api_upload,
                    "/api/delete": self.api_delete,
                }[self.path]()
        except Exception as exc:
            return self.send_json({"ok": False, "error": str(exc)}, 400)
        self.send_json({"ok": False, "error": "unknown endpoint"}, 404)

    def api_unlock(self):
        payload = self.read_json()
        wanted = str(payload.get("id") or "")
        given = payload.get("answer") or ""
        time.sleep(0.25)  # take the shine off brute forcing

        for q in (load_data().get("access") or {}).get("questions", []):
            if not q.get("hash"):
                continue                      # incomplete: nothing can match it
            if q.get("id") == wanted:
                if hmac.compare_digest(str(q.get("hash", "")), answer_hash(given)):
                    cookie = (
                        "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax"
                        % (COOKIE, token(), 60 * 60 * 24 * 30)
                    )
                    return self.send_json({"ok": True}, cookie=cookie)
                break
        self.send_json({"ok": False, "error": "wrong answer"}, 401)

    def api_submit(self):
        """A friend filling in join.html. Deliberately unauthenticated, so it is
        written to a waiting list rather than straight into members."""
        p = self.read_json()
        name = (p.get("name") or "").strip()[:80]
        if not name:
            raise ValueError("a name is required")

        record = {}
        for k, v in (p.get("record") or {}).items():
            k = str(k).strip()[:60]
            v = str(v).strip()[:300]
            if k and v:
                record[k] = v

        entry = {
            "id": "sub-" + os.urandom(5).hex(),
            "at": time.strftime("%Y-%m-%d %H:%M"),
            "name": name,
            "crew": str(p.get("crew") or "")[:40],
            "blurb": (p.get("blurb") or "").strip()[:600],
            "instagram": re.sub(r"[^A-Za-z0-9._]", "", (p.get("instagram") or ""))[:40],
            "record": record,
            "photo": "",
        }

        blob = p.get("photoData") or ""
        if blob.startswith("data:") and "," in blob:
            fname = safe_name(p.get("photoName") or "photo.jpg")
            if fname:
                raw = base64.b64decode(blob.split(",", 1)[1])
                if len(raw) <= MAX_BODY:
                    os.makedirs(PHOTOS, exist_ok=True)
                    stem, ext = os.path.splitext(fname)
                    final, n = "join-" + stem + ext, 2
                    while os.path.exists(os.path.join(PHOTOS, final)):
                        final = "join-%s-%d%s" % (stem, n, ext); n += 1
                    with open(os.path.join(PHOTOS, final), "wb") as fh:
                        fh.write(raw)
                    entry["photo"] = "photos/" + final

        data = load_data()
        subs = data.setdefault("submissions", [])
        if len(subs) >= 200:
            raise ValueError("the waiting list is full")
        subs.append(entry)
        self.write_data(data)
        self.send_json({"ok": True})

    def api_admin_login(self):
        pw = (self.read_json().get("password") or "")
        time.sleep(0.3)                       # slow down guessing
        if not admin_configured():
            return self.send_json({"ok": False, "error": "not configured"}, 400)
        if not check_admin_password(pw):
            return self.send_json({"ok": False, "error": "wrong password"}, 401)
        cookie = ("%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax"
                  % (ADMIN_COOKIE, admin_token(), 60 * 60 * 12))
        self.send_json({"ok": True}, cookie=cookie)

    def api_admin_password(self):
        """Set it the first time, or change it when already signed in."""
        payload = self.read_json()
        new = (payload.get("new") or "").strip()
        if len(new) < 6:
            raise ValueError("use at least 6 characters")
        if admin_configured() and not check_admin_password(payload.get("current") or ""):
            return self.send_json({"ok": False, "error": "current password is wrong"}, 401)
        set_admin_password(new)
        cookie = ("%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax"
                  % (ADMIN_COOKIE, admin_token(), 60 * 60 * 12))
        self.send_json({"ok": True}, cookie=cookie)

    def write_data(self, data):
        os.makedirs(BACKUPS, exist_ok=True)
        if os.path.exists(DATA):
            stamp = time.strftime("%Y%m%d-%H%M%S")
            shutil.copy2(DATA, os.path.join(BACKUPS, "data-%s.json" % stamp))
            for old in sorted(os.listdir(BACKUPS))[:-20]:
                os.remove(os.path.join(BACKUPS, old))
        tmp = DATA + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp, DATA)

    def api_save(self):
        data = self.read_json()
        for key in ("crews", "members", "parties", "gallery"):
            if key not in data:
                raise ValueError("missing key: " + key)
        # never let the editor's copy clobber submissions that arrived meanwhile
        data["submissions"] = load_data().get("submissions", []) \
            if data.get("submissions") is None else data["submissions"]
        self.write_data(data)
        self.send_json({"ok": True})

    def api_upload(self):
        payload = self.read_json()
        name = safe_name(payload.get("name"))
        if not name:
            raise ValueError("unsupported file type")

        data_url = payload.get("dataUrl") or ""
        if "," not in data_url:
            raise ValueError("expected a data: URL")
        blob = base64.b64decode(data_url.split(",", 1)[1])
        if len(blob) > MAX_BODY:
            raise ValueError("file too large")

        os.makedirs(PHOTOS, exist_ok=True)
        stem, ext = os.path.splitext(name)
        final, n = name, 2
        while os.path.exists(os.path.join(PHOTOS, final)):
            final = "%s-%d%s" % (stem, n, ext)
            n += 1

        with open(os.path.join(PHOTOS, final), "wb") as fh:
            fh.write(blob)
        self.send_json({"ok": True, "path": "photos/" + final})

    def api_delete(self):
        rel = (self.read_json().get("path") or "").strip()
        if not rel.startswith("photos/"):
            raise ValueError("only files in photos/ can be deleted")
        target = os.path.join(PHOTOS, os.path.basename(rel))
        if os.path.dirname(os.path.abspath(target)) != os.path.abspath(PHOTOS):
            raise ValueError("path escapes photos/")
        if os.path.exists(target):
            os.remove(target)
        self.send_json({"ok": True})


def main():
    global GATE
    args = sys.argv[1:]
    GATE = "--gate" in args
    host = "127.0.0.1"
    if "--host" in args:
        host = args[args.index("--host") + 1]
    port = next((int(a) for a in args if a.isdigit()), 8777)

    if host != "127.0.0.1" and not GATE:
        print("refusing to listen on %s without --gate" % host)
        sys.exit(1)

    server = ThreadingHTTPServer((host, port), Handler)
    print("greygoose  →  http://%s:%d" % (host, port))
    print("admin      →  http://%s:%d/admin.html" % (host, port))
    print("gate       →  %s" % ("on" if GATE else "off (local editing)"))
    print("ctrl-c to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
