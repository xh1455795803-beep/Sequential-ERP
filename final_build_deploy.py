#!/usr/bin/env python3
"""Final build + deploy via thalvior.fun/wms/."""
import socket, paramiko, time, json, base64, subprocess, os

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

# 1. Read ANON_KEY
o, _ = run("grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2")
ANON = o.strip()

# 2. Update .env.production — use thalvior.fun (it has proxy for /rest/v1/, /auth/v1/, etc.)
# BUT: the frontend runs under /wms/ and API is at /rest/v1/ (same origin)
# So VITE_SUPABASE_URL should be the same origin — "http://thalvior.fun"
# OR even simpler: "/.supabase" or just "http://thalvior.fun"

# Check what path the frontend constructs
# Supabase JS client takes url like "http://thalvior.fun" and appends "/rest/v1/", "/auth/v1/" etc.
# thalvior.fun has both proxies, so this should work perfectly

env_content = f"""# Production environment
# Frontend is at http://thalvior.fun/wms/
# API is proxied to http://thalvior.fun/rest/v1/, http://thalvior.fun/auth/v1/
VITE_SUPABASE_URL=http://thalvior.fun
VITE_SUPABASE_ANON_KEY={ANON}
"""
with open("/workspace/wms-app/.env.production", 'w') as f:
    f.write(env_content)
print("=== .env.production ===")
print(env_content[:200] + "...")

# 3. Build
print("\n=== Build ===")
os.chdir("/workspace/wms-app")
result = subprocess.run(["npm", "run", "build"], capture_output=True, text=True, timeout=180)
print(result.stdout[-1000:])
if result.returncode != 0:
    print("STDERR:", result.stderr[-500:])
    exit(1)

# 4. Check built index.html
print("\n=== Built index.html ===")
with open("/workspace/wms-app/dist/index.html") as f:
    html = f.read()
print(html[:400])

# 5. Deploy
print("\n=== Deploy ===")
tar_path = "/tmp/wms-final.tar.gz"
subprocess.run(["tar", "-czf", tar_path, "-C", "/workspace/wms-app/dist", "."], check=True)

s = socket.socket(); s.settimeout(15)
s.connect(('127.0.0.1', 18080))
s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')
sftp = paramiko.SFTPClient.from_transport(t)
sftp.put(tar_path, '/tmp/wms-final.tar.gz')
sftp.close(); t.close(); s.close()

o, e = run("""sudo rm -rf /var/www/wms/* && \
  sudo tar -xzf /tmp/wms-final.tar.gz -C /var/www/wms && \
  sudo chown -R www-data:www-data /var/www/wms && \
  ls -la /var/www/wms/ | head -10 && \
  echo '---' && \
  cat /var/www/wms/index.html | head -5""")
print(o)

# 6. Verify thalvior.fun/wms/ loads our new build
print("\n=== Verify ===")
import urllib.request
def test(url, headers=None):
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read()[:400].decode(errors='replace')
    except urllib.error.HTTPError as ex:
        return f"HTTP {ex.code}", ex.read()[:400].decode(errors='replace')
    except Exception as ex:
        return f"ERR: {ex}", ""

s, b = test("http://thalvior.fun/wms/")
print(f"  thalvior.fun/wms/: {s}")
if 'Thalvior' in b and 'index-ku3smrAj' in b:
    print("    ✅ New build confirmed")

s, b = test(f"http://thalvior.fun/rest/v1/wms_orders?limit=3", {"apikey": ANON})
print(f"  thalvior.fun/rest/v1/wms_orders: {s} → {b[:200]}")

s, b = test("http://thalvior.fun/auth/v1/health")
print(f"  thalvior.fun/auth/v1/health: {s}")
