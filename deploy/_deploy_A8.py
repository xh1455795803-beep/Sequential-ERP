#!/usr/bin/env python3
"""P8整改部署：上传前端index.html到服务器，重启后端+Nginx reload"""
import paramiko, os, sys

SSH_HOST = '120.55.6.75'
SSH_USER = 'admin'
SSH_PASS = 'yuan340364'

proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy') or os.environ.get('ALL_PROXY') or ''

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
        except Exception as e:
            print(f"[warn] proxy setup fail: {e}, try direct")
    client.connect(SSH_HOST, 22, SSH_USER, SSH_PASS, sock=sock, timeout=30)
    return client

def run(c, cmd):
    print(f"$ {cmd}")
    stdin, stdout, stderr = c.exec_command(cmd, timeout=60)
    out = stdout.read().decode('utf-8', errors='ignore')
    err = stderr.read().decode('utf-8', errors='ignore')
    if out: print(out[:2000])
    if err: print("[stderr]", err[:1000])
    return out + err

def main():
    src = '/workspace/deploy/admin/index.html'
    dst_html = '/opt/shuxu-erp/admin/index.html'
    dst_backend = '/opt/shuxu-erp/backend/src/'
    backend_src = '/workspace/deploy/backend/src/'
    
    c = connect()
    print("[1] upload index.html")
    sftp = c.open_sftp()
    sftp.put(src, dst_html)
    print(f"  uploaded -> {dst_html} size={os.path.getsize(src)}")
    
    # 重新上传billing.js（确保owner权限中间件在）
    for f in ['routes/billing.js', 'routes/saas-admin.js']:
        if os.path.exists(backend_src + f):
            sftp.put(backend_src + f, dst_backend + f)
            print(f"  uploaded -> {dst_backend + f}")
    
    sftp.close()
    
    print("\n[2] restart backend")
    run(c, "systemctl restart shuxu-erp 2>&1 || (cd /opt/shuxu-erp/backend && nohup node src/app.js > /tmp/erp.log 2>&1 &); sleep 2; echo done")
    
    print("\n[3] check process")
    out = run(c, "ps aux | grep -E 'node.*(app|server)' | grep -v grep; netstat -tlnp 2>/dev/null | grep 8090 || ss -tlnp 2>/dev/null | grep 8090")
    if '8090' in str(out):
        print("  ✓ backend listening on 8090")
    else:
        print("  ⚠ backend check unclear, see output above")
    
    print("\n[4] smoke test API")
    out = run(c, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8090/api/v1/public/landing/config; echo")
    print(f"  public landing: {out.strip()}")
    
    out = run(c, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8090/app/; echo")
    print(f"  /app/ via node: {out.strip()}")
    
    c.close()
    print("\n✓ deploy A8 done")

if __name__ == '__main__':
    main()
