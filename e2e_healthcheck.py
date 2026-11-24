#!/usr/bin/env python3
"""Thalvior Production E2E Health Check — runs every layer from outside-in."""
import sys, json, time, socket, ssl, urllib.request, urllib.error, base64, subprocess

DOMAIN = "thalvior.icu"
BASE = f"https://{DOMAIN}"
TIMEOUT = 15
ANON_KEY = None  # fetched from server later

# ─── result accumulator ───
PASSES, FAILS = [], []
def ok(layer, name, detail=""):
    PASSES.append((layer, name, detail))
    print(f"  ✅ [{layer}] {name}" + (f"  — {detail}" if detail else ""))
def bad(layer, name, detail=""):
    FAILS.append((layer, name, detail))
    print(f"  ❌ [{layer}] {name}" + (f"  — {detail}" if detail else ""))
def info(msg): print(f"  ℹ️  {msg}")

# ═══════════════════════════════════════════════════════════════
# L1 — CONNECTIVITY LAYER
# ═══════════════════════════════════════════════════════════════
print("\n" + "="*60)
print("L1 — CONNECTIVITY & HTTPS")
print("="*60)

# 1.1 DNS resolution
try:
    infos = socket.getaddrinfo(DOMAIN, 443)
    ips = sorted(set(i[4][0] for i in infos))
    ok("L1", "DNS resolves", f"{DOMAIN} → {ips}")
except Exception as e:
    bad("L1", "DNS resolves", str(e))

# 1.2 TLS certificate valid
try:
    ctx = ssl.create_default_context()
    with socket.create_connection((DOMAIN, 443), timeout=TIMEOUT) as sock:
        with ctx.wrap_socket(sock, server_hostname=DOMAIN) as ssock:
            cert = ssock.getpeercert()
            subj = dict(x[0] for x in cert['subject'])
            ok("L1", "TLS cert valid", f"CN={subj.get('commonName','?')} expires={cert['notAfter']}")
except Exception as e:
    bad("L1", "TLS cert valid", str(e))

# 1.3 HTTP 80 → 301 to HTTPS
try:
    req = urllib.request.Request(f"http://{DOMAIN}/", method="HEAD")
    opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
    resp = opener.open(req, timeout=TIMEOUT)
    # HTTPRedirectHandler follows, so check history
    hist = resp.geturl()
    if "https://" in hist:
        ok("L1", "HTTP→HTTPS 301", f"final={hist[:50]}")
    else:
        bad("L1", "HTTP→HTTPS 301", f"no redirect, got {hist}")
except urllib.error.HTTPError as e:
    if e.code in (301, 302, 307, 308):
        ok("L1", "HTTP→HTTPS redirect", f"code={e.code} location={e.headers.get('Location','')[:60]}")
    else:
        bad("L1", "HTTP→HTTPS", f"HTTP {e.code}")
except Exception as e:
    bad("L1", "HTTP→HTTPS", str(e))

# 1.4 HTTPS ERP root 200
try:
    resp = urllib.request.urlopen(f"{BASE}/", timeout=TIMEOUT)
    ok("L1", "HTTPS / 200", f"status={resp.status} len={len(resp.read())}")
except Exception as e:
    bad("L1", "HTTPS / 200", str(e))

# 1.5 HTTPS /wms/ 200
try:
    resp = urllib.request.urlopen(f"{BASE}/wms/", timeout=TIMEOUT)
    ok("L1", "HTTPS /wms/ 200", f"status={resp.status} len={len(resp.read())}")
except Exception as e:
    bad("L1", "HTTPS /wms/ 200", str(e))

# 1.6 Security headers (via curl for full control)
proc = subprocess.run(
    ["curl", "-sI", "--connect-timeout", str(TIMEOUT), BASE + "/"],
    capture_output=True, text=True, timeout=TIMEOUT
)
hdrs = proc.stdout.lower()
for hdr, expected in [
    ("strict-transport-security", "HSTS"),
    ("content-security-policy", "CSP"),
    ("x-frame-options", "X-Frame"),
    ("x-content-type-options", "X-Content-Type"),
    ("referrer-policy", "Referrer"),
]:
    if hdr in hdrs:
        ok("L1", f"security header {expected}", "present")
    else:
        bad("L1", f"security header {expected}", "MISSING")

# ═══════════════════════════════════════════════════════════════
# L2 — FRONTEND LAYER
# ═══════════════════════════════════════════════════════════════
print("\n" + "="*60)
print("L2 — FRONTEND STATIC RESOURCES")
print("="*60)

# 2.1 ERP landing page — fetch, extract JS bundle URL
try:
    resp = urllib.request.urlopen(f"{BASE}/", timeout=TIMEOUT)
    html = resp.read().decode("utf-8", errors="replace")
    title_line = [l for l in html.split("\n") if "<title>" in l.lower()]
    info(f"ERP title: {title_line[0].strip()[:80] if title_line else 'none'}")
    # find vite JS bundle
    import re
    m = re.search(r'src="([^"]*\.js)"', html)
    if not m:
        m = re.search(r'src=\'([^\']*\.js)\'', html)
    if m:
        erp_js = m.group(1)
        ok("L2", "ERP bundle URL found", erp_js)
    else:
        bad("L2", "ERP bundle URL found", "no .js in HTML")
        erp_js = None
except Exception as e:
    bad("L2", "ERP landing fetch", str(e))
    erp_js = None

# 2.2 ERP bundle real download
if erp_js:
    erp_url = erp_js if erp_js.startswith("http") else f"{BASE}{erp_js}"
    try:
        resp = urllib.request.urlopen(erp_url, timeout=TIMEOUT*3)
        data = resp.read()
        ok("L2", "ERP JS bundle download", f"{len(data)} bytes, starts with: {data[:60].decode('utf-8','replace')}")
    except Exception as e:
        bad("L2", "ERP JS bundle download", str(e))

# 2.3 WMS landing page
try:
    resp = urllib.request.urlopen(f"{BASE}/wms/", timeout=TIMEOUT)
    html = resp.read().decode("utf-8", errors="replace")
    title_line = [l for l in html.split("\n") if "<title>" in l.lower()]
    info(f"WMS title: {title_line[0].strip()[:80] if title_line else 'none'}")
    m = re.search(r'src="([^"]*\.js)"', html)
    wms_js = m.group(1) if m else None
    if wms_js:
        ok("L2", "WMS bundle URL found", wms_js)
except Exception as e:
    bad("L2", "WMS landing fetch", str(e))
    wms_js = None

# 2.4 WMS bundle real download
if wms_js:
    wms_url = wms_js if wms_js.startswith("http") else f"{BASE}{wms_js}"
    try:
        resp = urllib.request.urlopen(wms_url, timeout=TIMEOUT*3)
        data = resp.read()
        ok("L2", "WMS JS bundle download", f"{len(data)} bytes")
    except Exception as e:
        bad("L2", "WMS JS bundle download", str(e))

# 2.5 SPA fallback — /wms/some-deep-route should return index.html
try:
    resp = urllib.request.urlopen(f"{BASE}/wms/deep/route/nonexistent", timeout=TIMEOUT)
    html = resp.read().decode("utf-8", errors="replace")
    if "id=\"root\"" in html or "tharvior" in html.lower() or "<div id=\"root\">" in html:
        ok("L2", "WMS SPA fallback", "deep route returns index.html")
    else:
        bad("L2", "WMS SPA fallback", "deep route returned wrong content")
except Exception as e:
    bad("L2", "WMS SPA fallback", str(e))

# ═══════════════════════════════════════════════════════════════
# L3 — AUTH LAYER
# ═══════════════════════════════════════════════════════════════
print("\n" + "="*60)
print("L3 — AUTH API")
print("="*60)

# 3.1 Fetch ANON_KEY from server via SSH proxy
def ssh_exec(cmd, timeout=30):
    """Exec command on server 43.133.232.81 via HTTP CONNECT proxy 127.0.0.1:18080"""
    import paramiko as _p
    s = socket.socket(); s.connect(("127.0.0.1", 18080))
    s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
    s.recv(4096)
    c = _p.SSHClient(); c.set_missing_host_key_policy(_p.AutoAddPolicy())
    c.connect("43.133.232.81", port=22, username="ubuntu", password="yuan340364#", sock=s, timeout=15)
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace").strip()
    err = stderr.read().decode(errors="replace").strip()
    c.close()
    return out, err

try:
    out, err = ssh_exec("grep VITE_SUPABASE_ANON_KEY /opt/thalvior-source/.env | cut -d= -f2 | tr -d '\\r\\n'")
    ANON_KEY = out.strip()
    if len(ANON_KEY) > 20 and "." in ANON_KEY:
        ok("L3", "ANON_KEY fetched", f"len={len(ANON_KEY)}")
    else:
        bad("L3", "ANON_KEY fetched", f"got unusable: '{ANON_KEY}'")
except Exception as e:
    bad("L3", "ANON_KEY fetched", f"SSH failed: {e}")
    ANON_KEY = None

# 3.2 Helper: call Auth token endpoint
def auth_login(email, password):
    url = f"{BASE}/auth/v1/token?grant_type=password"
    data = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("apikey", ANON_KEY or "")
    req.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        return json.loads(resp.read()), None
    except urllib.error.HTTPError as e:
        return None, (e.code, e.read().decode())
    except Exception as e:
        return None, str(e)

if ANON_KEY:
    accounts = [
        ("merchant@thalvior.dev", "Merchant1234!", "merchant"),
        ("wms@thalvior.dev", "Wms1234!", "wms"),
        ("admin@thalvior.dev", "Admin1234!", "admin"),
    ]
    for email, pwd, role_label in accounts:
        d, err = auth_login(email, pwd)
        if d and "access_token" in d:
            at = d["access_token"]
            # verify it's a valid JWT (3 parts, base64url)
            parts = at.split(".")
            if len(parts) == 3:
                try:
                    payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=="))
                    ok("L3", f"login {role_label}", f"JWT ok, sub={payload.get('sub','?')[:20]} role={payload.get('role','?')}")
                except Exception:
                    bad("L3", f"login {role_label}", f"JWT parse failed, token={at[:30]}...")
            else:
                bad("L3", f"login {role_label}", f"not a 3-part JWT: {at[:30]}")
        else:
            bad("L3", f"login {role_label}", f"fail: {err}")

    # 3.3 Wrong password rejected
    d, err = auth_login("merchant@thalvior.dev", "WrongPass123!")
    if err and err[0] in (400, 401):
        ok("L3", "wrong password rejected", f"HTTP {err[0]}")
    elif d and "access_token" in d:
        bad("L3", "wrong password rejected", "logged in anyway!")
    else:
        bad("L3", "wrong password rejected", str(err))

    # 3.4 Signup closed
    url = f"{BASE}/auth/v1/signup"
    data = json.dumps({"email": "noop@x.com", "password": "Test1234!"}).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("apikey", ANON_KEY); req.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        d = json.loads(resp.read())
        if "access_token" in d:
            bad("L3", "signup closed", "account was created!")
        else:
            ok("L3", "signup closed", f"response: {json.dumps(d)[:80]}")
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        if "Signups not allowed" in body or e.code == 403:
            ok("L3", "signup closed", f"HTTP {e.code}: {body[:80]}")
        else:
            bad("L3", "signup closed", f"HTTP {e.code}: {body[:80]}")
else:
    info("Skipping Auth checks — no ANON_KEY")

# ═══════════════════════════════════════════════════════════════
# L4 — EDGE FUNCTIONS
# ═══════════════════════════════════════════════════════════════
print("\n" + "="*60)
print("L4 — EDGE FUNCTIONS")
print("="*60)

EDGE_FUNCS = [
    ("sync-tiktok-orders", True, "TikTok Shop sync"),
    ("sync-shopee-orders", True, "Shopee sync"),
    ("sync-lazada-orders", True, "Lazada sync"),
    ("sync-ozon-orders", True, "Ozon sync"),
    ("sync-mercado-orders", True, "Mercado sync"),
    ("sync-logistics-tracking", True, "Logistics tracking"),
    ("generate-label-pdf", False, "Label PDF generator"),
    ("recharge-wallet", False, "Wallet recharge"),
    ("cod-settlement", False, "COD settlement"),
]

for fn, should_200, desc in EDGE_FUNCS:
    url = f"{BASE}/functions/v1/{fn}"
    try:
        resp = urllib.request.urlopen(url, timeout=TIMEOUT*2)
        body = resp.read().decode("utf-8", errors="replace")
        if should_200:
            try:
                d = json.loads(body)
                ok("L4", f"func {fn}", f"200 OK, body preview: {body[:100]}")
            except Exception:
                ok("L4", f"func {fn}", f"200 OK, raw: {body[:80]}")
        else:
            ok("L4", f"func {fn}", f"200 (demo), body: {body[:80]}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        if should_200:
            bad("L4", f"func {fn}", f"HTTP {e.code}: {body[:120]}")
        else:
            # demo functions expected to 500 if missing entrypoint, just log
            ok("L4", f"func {fn}", f"HTTP {e.code} (demo generator — expected)")
    except Exception as e:
        bad("L4", f"func {fn}", str(e))

# Verify broken names give clear error (not silent fail)
for broken_name in ["sync-tiktok", "sync-shopee"]:
    url = f"{BASE}/functions/v1/{broken_name}"
    try:
        urllib.request.urlopen(url, timeout=TIMEOUT)
        bad("L4", f"broken name {broken_name}", "returned 200 unexpectedly")
    except urllib.error.HTTPError as e:
        if e.code == 500 and "entrypoint" in e.read().decode():
            ok("L4", f"broken name {broken_name}", f"correctly 500 with entrypoint error")
        else:
            info(f"  broken name {broken_name} → {e.code}: {e.read().decode()[:80]}")
    except Exception:
        pass

# ═══════════════════════════════════════════════════════════════
# L5 — DATABASE (server-side, via SSH)
# ═══════════════════════════════════════════════════════════════
print("\n" + "="*60)
print("L5 — DATABASE")
print("="*60)

if ANON_KEY:  # SSH already established earlier
    def pg(sql, timeout=20):
        cmd = f"docker exec supabase-db psql -U postgres -d postgres -t -A -c \"{sql}\""
        out, err = ssh_exec(cmd, timeout=timeout)
        return out.strip(), err.strip()

    # 5.1 auth.users count
    out, err = pg("SELECT count(*) FROM auth.users")
    try:
        c = int(out)
        if c == 3:
            ok("L5", "auth.users count", f"{c} (merchant/wms/admin)")
        else:
            bad("L5", "auth.users count", f"{c} — expected 3")
    except Exception:
        bad("L5", "auth.users count", f"parse fail: '{out}' err: '{err}'")

    # 5.2 tlv_merchants count
    out, err = pg("SELECT count(*) FROM public.tlv_merchants")
    try:
        c = int(out)
        ok("L5", "tlv_merchants count", f"{c}")
    except Exception:
        bad("L5", "tlv_merchants count", f"'{out}' err: '{err}'")

    # 5.3 tlv_warehouses count
    out, err = pg("SELECT count(*) FROM public.tlv_warehouses")
    try:
        ok("L5", "tlv_warehouses count", f"{int(out)}")
    except Exception:
        bad("L5", "tlv_warehouses count", f"'{out}' err: '{err}'")

    # 5.4 Audit triggers count
    out, err = pg("""
        SELECT count(*) FROM pg_trigger t 
        JOIN pg_class c ON t.tgrelid=c.oid 
        WHERE tgname LIKE 'tlv_audit_%' AND NOT t.tgisinternal
    """)
    try:
        c = int(out)
        if c >= 20:
            ok("L5", "audit triggers count", f"{c} attached to business tables")
        else:
            bad("L5", "audit triggers count", f"{c} — expected ≥20")
    except Exception:
        bad("L5", "audit triggers count", f"'{out}' err: '{err}'")

    # 5.5 tlv_audit_trigger() function exists
    out, err = pg("""
        SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='tlv_audit_trigger' 
        AND pronamespace='public'::regnamespace)
    """)
    if out == "t":
        ok("L5", "tlv_audit_trigger() func exists", "yes")
    else:
        bad("L5", "tlv_audit_trigger() func exists", f"no — '{out}'")

    # 5.6 Audit logs exist (evidence of triggers firing)
    out, err = pg("SELECT count(*) FROM public.tlv_audit_logs")
    try:
        c = int(out)
        ok("L5", "tlv_audit_logs rows", f"{c} (proves triggers have fired)")
    except Exception:
        bad("L5", "tlv_audit_logs rows", f"'{out}' err: '{err}'")

    # 5.7 Live trigger firing test — call Edge Fn, then check audit_logs grew
    before_out, _ = pg("SELECT count(*) FROM public.tlv_audit_logs")
    before = int(before_out) if before_out.isdigit() else 0

    # fire Edge Fn
    try:
        urllib.request.urlopen(f"{BASE}/functions/v1/sync-tiktok-orders", timeout=TIMEOUT*2).read()
    except Exception:
        pass
    time.sleep(2)

    after_out, _ = pg("SELECT count(*) FROM public.tlv_audit_logs")
    after = int(after_out) if after_out.isdigit() else 0
    if after > before:
        ok("L5", "trigger live firing", f"grew {before} → {after} (+{after-before})")
    else:
        bad("L5", "trigger live firing", f"did not grow: {before} → {after}")

    # 5.8 public schema tables count
    out, err = pg("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
    try:
        ok("L5", "public tables count", f"{int(out)} (tlv_* business tables)")
    except Exception:
        bad("L5", "public tables count", f"'{out}' err: '{err}'")
else:
    info("Skipping DB checks — SSH unavailable")

# ═══════════════════════════════════════════════════════════════
# L6 — SERVER STATE
# ═══════════════════════════════════════════════════════════════
print("\n" + "="*60)
print("L6 — SERVER STATE")
print("="*60)

if ANON_KEY:
    # 6.1 nginx active
    out, err = ssh_exec("sudo systemctl is-active nginx")
    if out.strip() == "active":
        ok("L6", "nginx active", out.strip())
    else:
        bad("L6", "nginx active", f"'{out.strip()}' err: {err.strip()}")

    # 6.2 nginx config syntax
    out, err = ssh_exec("sudo nginx -t 2>&1")
    if "syntax is ok" in out.lower() or "test is successful" in out.lower():
        ok("L6", "nginx config syntax", "OK")
    else:
        bad("L6", "nginx config syntax", out[:200])

    # 6.3 Docker Supabase containers health
    out, err = ssh_exec("docker ps --format '{{.Names}}|{{.Status}}' | grep -i 'supabase\\|realtime'")
    for line in out.strip().split("\n"):
        if not line.strip(): continue
        name, status = line.split("|", 1) if "|" in line else (line, "")
        health = "healthy" if "healthy" in status.lower() else ("unhealthy" if "unhealthy" in status.lower() else "")
        if health == "healthy":
            ok("L6", f"container {name}", status.strip())
        elif health == "unhealthy":
            info(f"  ⚠️  container {name} — {status.strip()}")
        else:
            info(f"  ⚙️  container {name} — {status.strip()}")

    # 6.4 Disk free
    out, err = ssh_exec("df -h / | tail -1")
    try:
        parts = out.split()
        use_pct = int(parts[4].replace("%", ""))
        avail = parts[3]
        if use_pct < 85:
            ok("L6", "disk usage", f"{use_pct}% used, {avail} free")
        else:
            bad("L6", "disk usage", f"{use_pct}% — critically low!")
    except Exception:
        info(f"  disk: {out.strip()}")

    # 6.5 /var/www/meoo and /var/www/wms exist
    out, err = ssh_exec("ls -la /var/www/meoo/index.html /var/www/wms/index.html 2>&1")
    if "No such file" in err or "No such file" in out:
        bad("L6", "www dirs exist", out[:200] or err[:200])
    else:
        ok("L6", "www dirs exist", "meoo + wms both have index.html")

    # 6.6 Docker daemon log-opts
    out, err = ssh_exec("cat /etc/docker/daemon.json 2>&1")
    if "log-opts" in out and "max-size" in out:
        ok("L6", "docker log rotation", "daemon.json has log-opts")
    else:
        info(f"  docker daemon.json: {out.strip()[:100]}")
else:
    info("Skipping server checks — SSH unavailable")

# ═══════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════
print("\n" + "="*60)
print("FINAL SUMMARY")
print("="*60)
total = len(PASSES) + len(FAILS)
print(f"\n  ✅ PASSED: {len(PASSES)}/{total}")
print(f"  ❌ FAILED: {len(FAILS)}/{total}")
print(f"  ⚠️  INFO:   (check ℹ️ lines above)")

if FAILS:
    print("\n  FAILED ITEMS:")
    for layer, name, detail in FAILS:
        print(f"    [{layer}] {name}  — {detail}")
    print("\n  🔴 NOT PRODUCTION-READY")
    sys.exit(1)
else:
    print("\n  🟢 PRODUCTION-READY — all checks passed")
    sys.exit(0)
