#!/usr/bin/env python3
"""仅上传更新后的index.html"""
import paramiko, os
SSH_HOST = '120.55.6.75'
SSH_USER = 'admin'
SSH_PASS = 'yuan340364'
proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('ALL_PROXY') or ''

def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    sock = None
    if proxy:
        try:
            from paramiko.proxy import ProxyCommand
            import urllib.parse
            p = urllib.parse.urlparse(proxy)
            hostport = f"{p.hostname}:{p.port or 8080}"
            cmd = f"nc -X connect -x {hostport} {SSH_HOST} 22"
            sock = ProxyCommand(cmd)
        except: pass
    client.connect(SSH_HOST, 22, SSH_USER, SSH_PASS, sock=sock, timeout=30)
    return client

c = connect()
sftp = c.open_sftp()
src = '/workspace/deploy/admin/index.html'
dst = '/opt/shuxu-erp/admin/index.html'
size = os.path.getsize(src)
sftp.put(src, dst)
sftp.close()
print(f"✓ uploaded {dst} size={size}")

# 验证
stdin, stdout, stderr = c.exec_command(f"""
cd /opt/shuxu-erp/backend && set -a && source .env 2>/dev/null; set +a
grep -c '飞书' /opt/shuxu-erp/admin/index.html
echo "--- banner check ---"
grep -oE '飞书[^<"]*' /opt/shuxu-erp/admin/index.html || echo "NO FEISHU FOUND ✓"
echo "--- curl test ---"
curl -sk -o /dev/null -w 'HTTPS /app/ HTTP %{{http_code}}\\n' https://qianniu-erp.cc/app/
""", timeout=30)
print(stdout.read().decode('utf-8', errors='ignore'))
c.close()
print("✓ DONE")
