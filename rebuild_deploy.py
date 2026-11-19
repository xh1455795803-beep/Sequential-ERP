#!/usr/bin/env python3
"""Final fixes: check vite base, fix API proxy, rebuild & deploy."""
import socket, paramiko, time, json, base64, subprocess, os, glob

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

# === 1. Check vite.config.ts base setting ===
print("=== 1. Vite config ===")
vite_path = "/workspace/wms-app/vite.config.ts"
print(f"Exists: {os.path.exists(vite_path)}")
if os.path.exists(vite_path):
    with open(vite_path) as f:
        print(f.read())

# === 2. Why "Upgrade Required" from envoy? ===
print("\n=== 2. Envoy direct vs nginx ===")
o, e = run("""curl -sS -v 'http://localhost:8000/rest/v1/' 2>&1 | head -30
echo '---'
curl -sS -H 'Host: wms.thalvior.icu' -v 'http://localhost/rest/v1/' 2>&1 | head -30
echo '---'
# "Upgrade Required" is envoy WebSocket filter — check what path we hit
curl -sS -H 'Host: wms.thalvior.icu' 'http://localhost/rest/v1/rpc/get_current_tenant_id' -X POST 2>&1""")
print(o)

# === 3. Fix vite base to "/" (not "/wms/") ===
print("\n=== 3. Fix vite config base path ===")
import re
if os.path.exists(vite_path):
    with open(vite_path) as f:
        content = f.read()
    print("Before:")
    print(content[:500])
    # Change base to "/" if it's "/wms/"
    content = re.sub(r"base:\s*['\"]/wms/?['\"]", 'base: "/"', content)
    content = re.sub(r"base:\s*['\"]/['\"]", 'base: "/"', content)
    with open(vite_path, 'w') as f:
        f.write(content)
    print("\nAfter:")
    print(content[:500])

# === 4. Rebuild ===
print("\n=== 4. Rebuild ===")
os.chdir("/workspace/wms-app")
result = subprocess.run(["npm", "run", "build"], capture_output=True, text=True, timeout=180)
print(result.stdout[-1500:])
if result.returncode != 0:
    print("STDERR:", result.stderr[-500:])
    exit(1)

# === 5. Check built index.html ===
print("\n=== 5. Check built index.html paths ===")
with open("/workspace/wms-app/dist/index.html") as f:
    html = f.read()
print(html[:500])

# === 6. Deploy ===
print("\n=== 6. Deploy ===")
tar_path = "/tmp/wms-dist2.tar.gz"
subprocess.run(["tar", "-czf", tar_path, "-C", "/workspace/wms-app/dist", "."], check=True)
print(f"Tarball: {os.path.getsize(tar_path)} bytes")

s = socket.socket(); s.settimeout(15)
s.connect(('127.0.0.1', 18080))
s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')
sftp = paramiko.SFTPClient.from_transport(t)
sftp.put(tar_path, '/tmp/wms-dist2.tar.gz')
sftp.close(); t.close(); s.close()
print("Uploaded")

o, e = run("""sudo rm -rf /var/www/wms/* && \
  sudo tar -xzf /tmp/wms-dist2.tar.gz -C /var/www/wms && \
  sudo chown -R www-data:www-data /var/www/wms && \
  ls -la /var/www/wms/""")
print(o)

# === 7. Full end-to-end test ===
print("\n=== 7. Full test ===")
o, e = run("""curl -sS -H 'Host: wms.thalvior.icu' -o /dev/null -w 'Frontend: HTTP %{http_code}\\n' http://localhost/
curl -sS -H 'Host: wms.thalvior.icu' http://localhost/index.html | head -5
echo '---'
curl -sS -H 'Host: wms.thalvior.icu' -o /dev/null -w 'API /rest/v1/: HTTP %{http_code}\\n' http://localhost/rest/v1/
echo '---'
# Direct envoy comparison
curl -sS -o /dev/null -w 'Direct :8000: HTTP %{http_code}\\n' http://localhost:8000/rest/v1/""")
print(o)
