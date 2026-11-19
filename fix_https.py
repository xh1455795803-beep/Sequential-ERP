#!/usr/bin/env python3
"""Fix https + rebuild + redeploy — quick."""
import socket, paramiko, subprocess, os

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

# Read ANON_KEY
o, _ = run("grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2")
ANON = o.strip()

# Fix URL to https
with open("/workspace/wms-app/.env.production", 'w') as f:
    f.write(f"""VITE_SUPABASE_URL=https://thalvior.fun
VITE_SUPABASE_ANON_KEY={ANON}
""")
print("=== .env.production ===")
with open("/workspace/wms-app/.env.production") as f:
    print(f.read()[:200])

# Build
os.chdir("/workspace/wms-app")
result = subprocess.run(["npm", "run", "build"], capture_output=True, text=True, timeout=180)
print(result.stdout[-500:])

# Deploy
tar_path = "/tmp/wms-https.tar.gz"
subprocess.run(["tar", "-czf", tar_path, "-C", "/workspace/wms-app/dist", "."], check=True)
s = socket.socket(); s.settimeout(15)
s.connect(('127.0.0.1', 18080))
s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')
sftp = paramiko.SFTPClient.from_transport(t)
sftp.put(tar_path, '/tmp/wms-https.tar.gz')
sftp.close(); t.close(); s.close()

o, e = run("""sudo rm -rf /var/www/wms/* && sudo tar -xzf /tmp/wms-https.tar.gz -C /var/www/wms && sudo chown -R www-data:www-data /var/www/wms && echo OK""")
print(o)

# Verify
import urllib.request
def test(url, headers=None):
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status
    except Exception as ex:
        return f"ERR: {ex}"

print(f"  https://thalvior.fun/wms/: {test('https://thalvior.fun/wms/')}")
