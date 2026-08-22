#!/usr/bin/env python3
"""远端真实注入 .env 跑迁移 v3 / v4（ALTER 加 ext_fields_enc），
再立即 DESCRIBE shops 验证列存在，最后重跑 _end2end 确认探活 400 不是 500。"""
import os, sys, re, socket, json
import paramiko

PROXY = os.environ.get('HTTPS_PROXY') or 'http://127.0.0.1:18080'
m = re.match(r'https?://([^:]+):(\d+)', PROXY); PH, PP = m.group(1), int(m.group(2))
SH, SP = '120.55.6.75', 22
SU, SPASS = 'admin', 'yuan340364'

class ProxiedSock(socket.socket):
    def pc(self, h, p, ph, pp):
        self.connect((ph, pp)); self.sendall(f'CONNECT {h}:{p} HTTP/1.1\r\nHost: {h}:{p}\r\nProxy-Connection: Keep-Alive\r\n\r\n'.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            c = self.recv(4096)
            if not c: raise Exception('EOF proxy')
            buf += c
        head = buf.partition(b'\r\n\r\n')[0].decode('utf-8','ignore')
        if ' 200 ' not in head.split('\r\n')[0]: raise Exception('CONNECT FAIL:'+head.split('\r\n')[0])

def main():
    s = ProxiedSock(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(25); s.pc(SH, SP, PH, PP)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SH, port=SP, username=SU, password=SPASS, sock=s, timeout=25, allow_agent=False, look_for_keys=False)
    def run(cmd):
        _i, o, e = ssh.exec_command(cmd, timeout=60, get_pty=True)
        return o.read().decode('utf-8','replace'), e.read().decode('utf-8','replace')

    # 0. 当前 DB 真实结构
    print('=== before: DESCRIBE shops 前五列 + ext_fields_enc 是否存在 ===')
    o0, e0 = run("""mysql -u shuxu -p'K9mXw7pQ2vRn5tLz' -D shuxu_erp -e "DESCRIBE shops;" 2>&1""")
    print(o0[:2500]); print(e0[:500])
    print('\n=== before: 有没有 ext_fields_enc ===')
    o0b, _ = run("""mysql -u shuxu -p'K9mXw7pQ2vRn5tLz' -D shuxu_erp -N -B -e "SHOW COLUMNS FROM shops LIKE 'ext_fields_enc';" 2>&1""")
    print(o0b)

    # 1) 复制 migrate 脚本到 /tmp 再真实执行（用 set -a; source .env 注入环境）
    print('\n=== 真实注入 .env 跑 migrate-v3.js & migrate-v4.js (远端 /opt/shuxu-erp/backend/) ===')
    migrate_inject = r"""#!/bin/bash
set -eu
cd /opt/shuxu-erp/backend
if [ -f .env ]; then
  set -a; . ./.env; set +a
else
  echo 'NO .env file'; exit 2
fi
echo '-- env check DB_HOST JWT_SECRET --'
echo "DB_HOST=$DB_HOST DB_USER=$DB_USER DB_NAME=$DB_NAME JWT_SECRET_LEN=${#JWT_SECRET}"
# 如果 scripts/migrate-v3.js 不存在，就用 /tmp 里的（本地推过去的 deploy/migrate-v3.js）
for name in migrate-v3.js migrate-v4.js; do
  if [ -f "scripts/$name" ]; then SCRIPT="scripts/$name"
  elif [ -f "/tmp/$name" ]; then SCRIPT="/tmp/$name"
  else
    echo "找不到 $name，跳过"; continue
  fi
  echo "========== RUN $SCRIPT =========="
  timeout 60 /opt/node20/bin/node "$SCRIPT" 2>&1 | tail -n 30
  echo "EXIT=$?"
done
mysql -u"$DB_USER" -p"$DB_PASS" -D"$DB_NAME" -e "DESCRIBE shops;" 2>&1 | head -n 30
echo '-- sync_logs columns --'
mysql -u"$DB_USER" -p"$DB_PASS" -D"$DB_NAME" -e "SHOW COLUMNS FROM sync_logs;" 2>&1 | head -n 24
echo '-- unique idx shops for dup prevention --'
mysql -u"$DB_USER" -p"$DB_PASS" -D"$DB_NAME" -e "SHOW INDEX FROM shops;" 2>&1 | head -n 20
"""
    sftp = ssh.open_sftp()
    with sftp.open('/tmp/_migrate.sh', 'w') as f: f.write(migrate_inject)
    # 把本地 migrate-v3.js / migrate-v4.js 传 /tmp
    for name in ['migrate-v3.js', 'migrate-v4.js']:
        local = f'/workspace/deploy/{name}'
        if os.path.exists(local):
            sftp.put(local, f'/tmp/{name}')
            print('✅ SFTP /tmp/' + name)
    sftp.chmod('/tmp/_migrate.sh', 0o755)
    o1, e1 = run('bash /tmp/_migrate.sh 2>&1')
    print(o1)
    if e1.strip(): print('[STDERR]', e1[:2000])

    # 2) 立即重跑 _end2end（本地也能直接跑，因为它连同一个服务器）
    print('\n\n========== 现在重跑真实 HTTP e2e（期望现在 apikey/noon 假值探活 400 不是 500）==========')
    import subprocess as sp
    r = sp.run(['python3', '/workspace/deploy/_end2end.py'], capture_output=True, text=True, cwd='/workspace/deploy')
    print('\n'.join(r.stdout.splitlines()[-120:]))
    if r.stderr.strip(): print('\n[STDERR end2end]\n' + '\n'.join(r.stderr.splitlines()[-40:]))

    ssh.close()

if __name__ == '__main__':
    main()
