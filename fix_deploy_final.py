#!/usr/bin/env python3
"""Fix remaining /wms/ paths and deploy."""
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

# === 1. Source index.html ===
print("=== 1. Source index.html ===")
with open("/workspace/wms-app/index.html") as f:
    html = f.read()
print(html[:1000])
print(f"\nAll /wms/ refs: {html.count('/wms/')}")

# Replace /wms/ with /
html_fixed = html.replace('/wms/', '/')
with open("/workspace/wms-app/index.html", 'w') as f:
    f.write(html_fixed)
print(f"After fix, /wms/ count: {html_fixed.count('/wms/')}")

# === 2. Check sw.js, manifest ===
print("\n=== 2. Check PWA files ===")
for fname in ["sw.js", "manifest.webmanifest"]:
    fpath = f"/workspace/wms-app/public/{fname}"
    if os.path.exists(fpath):
        with open(fpath) as f:
            content = f.read()
        if '/wms/' in content:
            print(f"  {fname} has /wms/ — fixing")
            with open(fpath, 'w') as f:
                f.write(content.replace('/wms/', '/'))
        else:
            print(f"  {fname}: OK")
    else:
        print(f"  {fname}: not in public/")

# === 3. Rebuild ===
print("\n=== 3. Rebuild ===")
os.chdir("/workspace/wms-app")
result = subprocess.run(["npm", "run", "build"], capture_output=True, text=True, timeout=180)
print(result.stdout[-1000:])

# === 4. Check built index.html ===
print("\n=== 4. Built index.html ===")
with open("/workspace/wms-app/dist/index.html") as f:
    html = f.read()
print(html[:600])
print(f"\n/wms/ count in built: {html.count('/wms/')}")

# === 5. Deploy ===
print("\n=== 5. Deploy ===")
tar_path = "/tmp/wms-dist3.tar.gz"
subprocess.run(["tar", "-czf", tar_path, "-C", "/workspace/wms-app/dist", "."], check=True)

s = socket.socket(); s.settimeout(15)
s.connect(('127.0.0.1', 18080))
s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')
sftp = paramiko.SFTPClient.from_transport(t)
sftp.put(tar_path, '/tmp/wms-dist3.tar.gz')
sftp.close(); t.close(); s.close()

o, e = run("""sudo rm -rf /var/www/wms/* && \
  sudo tar -xzf /tmp/wms-dist3.tar.gz -C /var/www/wms && \
  sudo chown -R www-data:www-data /var/www/wms && \
  sudo nginx -s reload 2>/dev/null; sleep 1 && \
  echo '---' && \
  curl -sS -H 'Host: wms.thalvior.icu' http://localhost/ | head -10""")
print(o)
