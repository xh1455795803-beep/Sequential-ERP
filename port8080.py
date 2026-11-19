#!/usr/bin/env python3
"""Check thalvior.fun nginx + find best way to expose wms."""
import socket, paramiko, time, json, base64, hmac, hashlib

def ssh_exec(cmd, timeout=120, retries=3):
    last_err = None
    for _ in range(retries):
        try:
            s = socket.socket(); s.settimeout(15)
            s.connect(('127.0.0.1', 18080))
            s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
            t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')
            chan = t.open_session(); chan.settimeout(timeout); chan.exec_command(cmd)
            out = chan.recv(131072).decode(errors='replace')
            err = chan.recv_stderr(65535).decode(errors='replace')
            t.close(); s.close()
            return out.strip(), err.strip()
        except Exception as ex:
            last_err = ex; time.sleep(2)
    raise last_err

def run(c, t=120): return ssh_exec(c, t)

# 1. What does thalvior.fun config look like?
print("=== 1. thalvior.fun nginx config ===")
o, e = run("cat /etc/nginx/sites-available/thalvior.fun")
print(o[:2000])

# 2. What's the root + locations?
print("\n=== 2. thalvior.fun summary ===")
o, e = run("""grep -E 'listen|server_name|root|location|proxy_pass' /etc/nginx/sites-available/thalvior.fun | head -30""")
print(o)

# 3. What ports are free?
print("\n=== 3. Free ports ===")
o, e = run("ss -tlnp 2>/dev/null | head -20; echo '---'; sudo netstat -tlnp 2>/dev/null | head -20")
print(o[:2000])

# 4. Plan: put wms on port 8080 (no default_server conflict)
print("\n=== 4. WMS on port 8080 ===")
nginx8080 = """server {
    listen 8080;
    listen [::]:8080;
    server_name wms.thalvior.icu _;

    root /var/www/wms;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
    location /rest/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:8000;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /auth/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:8000;
    }
    location /storage/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:8000;
    }
}
"""
b64 = base64.b64encode(nginx8080.encode()).decode()
# Remove old wms site, create new on 8080
run("sudo rm -f /etc/nginx/sites-enabled/wms")
run(f"echo '{b64}' | base64 -d | sudo tee /etc/nginx/sites-available/wms > /dev/null")
run("sudo ln -sf /etc/nginx/sites-available/wms /etc/nginx/sites-enabled/wms")
o, e = run("sudo nginx -t 2>&1 | tail -5; sudo nginx -s reload 2>&1 | tail -5")
print(f"nginx: {o} {e}")

# 5. Test port 8080
print("\n=== 5. Test 8080 ===")
import urllib.request
def test(url, headers=None):
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read()[:300].decode(errors='replace')
    except urllib.error.HTTPError as ex:
        return f"HTTP {ex.code}", ex.read()[:300].decode(errors='replace')
    except Exception as ex:
        return f"ERR: {ex}", ""

o, _ = run("grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2")
ANON = o.strip()

s, b = test("http://43.133.232.81:8080/")
print(f"  :8080 Frontend: {s}")
if 'root' in b: print("    ✅ React root found")

s, b = test(f"http://43.133.232.81:8080/rest/v1/wms_orders?limit=3", {"apikey": ANON})
print(f"  :8080 API: {s} → {b[:200]}")
