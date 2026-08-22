#!/usr/bin/env python3
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
cmd = '''
cd /opt/shuxu-erp/backend && set -a && source .env 2>/dev/null; set +a
mysql -h127.0.0.1 -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT id, tenant_id, username, role, is_owner FROM users LIMIT 15;
" 2>&1
'''
stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='ignore'))
err = stderr.read().decode('utf-8', errors='ignore')
if 'Access denied' not in err and 'ERROR' in err: print(err)

c.close()
