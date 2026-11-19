#!/usr/bin/env python3
"""Fix vite base back to /wms/ — frontend is under thalvior.fun/wms/"""
import socket, paramiko, time, subprocess, os, json

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

# 1. Fix vite config — base: '/wms/'
print("=== 1. Fix vite config ===")
import re
with open("/workspace/wms-app/vite.config.ts") as f:
    content = f.read()
content = re.sub(r'base:\s*["\'].+?["\']', "base: '/wms/'", content)
with open("/workspace/wms-app/vite.config.ts", 'w') as f:
    f.write(content)
with open("/workspace/wms-app/vite.config.ts") as f:
    print([l for l in f if 'base:' in l])

# 2. Fix index.html — paths with /wms/
print("\n=== 2. Fix index.html paths ===")
with open("/workspace/wms-app/index.html") as f:
    html = f.read()
print(f"  Before /wms/ count: {html.count('/wms/')}")
# Add /wms/ prefix to root-relative paths
html = re.sub(r'href="/favicon', 'href="/wms/favicon', html)
html = re.sub(r'href="/manifest', 'href="/wms/manifest', html)
html = re.sub(r'href="/icon', 'href="/wms/icon', html)
with open("/workspace/wms-app/index.html", 'w') as f:
    f.write(html)
print(f"  After /wms/ count: {html.count('/wms/')}")

# 3. Also fix sw.js and manifest if needed
for fname in ["sw.js", "manifest.webmanifest"]:
    for fpath in [f"/workspace/wms-app/public/{fname}", f"/workspace/wms-app/{fname}"]:
        if os.path.exists(fpath):
            with open(fpath) as f:
                c = f.read()
            # Add /wms/ prefix if paths don't have it
            c = re.sub(r'(url\(|href|src)"/', r'\1"/wms/', c)
            c = re.sub(r'"name":', '"name":', c)  # manifest
            with open(fpath, 'w') as f:
                f.write(c)

# 4. Build
print("\n=== 3. Build ===")
os.chdir("/workspace/wms-app")
result = subprocess.run(["npm", "run", "build"], capture_output=True, text=True, timeout=180)
print(result.stdout[-800:])

# 5. Check built index.html
print("\n=== 4. Check built ===")
with open("/workspace/wms-app/dist/index.html") as f:
    html = f.read()
print(html[:600])

# 6. Deploy
print("\n=== 5. Deploy ===")
import base64
tar_path = "/tmp/wms-wpath.tar.gz"
subprocess.run(["tar", "-czf", tar_path, "-C", "/workspace/wms-app/dist", "."], check=True)
print(f"Tar: {os.path.getsize(tar_path)} bytes")

s = socket.socket(); s.settimeout(15)
s.connect(('127.0.0.1', 18080))
s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')
sftp = paramiko.SFTPClient.from_transport(t)
sftp.put(tar_path, '/tmp/wms-wpath.tar.gz')
sftp.close(); t.close(); s.close()

o, e = run("""sudo rm -rf /var/www/wms/* && \
  sudo tar -xzf /tmp/wms-wpath.tar.gz -C /var/www/wms && \
  sudo chown -R www-data:www-data /var/www/wms && \
  echo 'DEPLOYED'""")
print(o)

# 7. Test from browser perspective
print("\n=== 6. Verify asset loading ===")
import urllib.request
def test(url, headers=None):
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read()[:200].decode(errors='replace')
    except urllib.error.HTTPError as ex:
        return f"HTTP {ex.code}", ""
    except Exception as ex:
        return f"ERR: {ex}", ""

s, b = test("http://thalvior.fun/wms/")
print(f"  /wms/: {s}")

# Check index.html references
with urllib.request.urlopen("http://thalvior.fun/wms/", timeout=15) as r:
    idx = r.read().decode()
# Find script src
import re
scripts = re.findall(r'src="([^"]+)"', idx)
print(f"  Scripts in index: {scripts}")

# Test each asset
for src in scripts:
    s, _ = test(f"http://thalvior.fun{src}")
    print(f"  Asset {src}: {s}")

# API test
o2, _ = run("grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2")
ANON = o2.strip()
s, b = test(f"http://thalvior.fun/rest/v1/wms_orders?limit=3", {"apikey": ANON})
print(f"\n  REST API: {s} → {b[:200]}")
