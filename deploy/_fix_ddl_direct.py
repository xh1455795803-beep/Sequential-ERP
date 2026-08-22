#!/usr/bin/env python3
"""直接用 mysql DDL 补全真实缺失的列/索引（不依赖 node 迁移脚本，一步到位）：
  1) shops.ext_fields_enc
  2) uk_tenant_platform_name 唯一索引（shops 防重复店铺）
  3) sync_logs: platform / imported / skipped / finished_at
最后 DESCRIBE 对比 before/after，再重跑 _end2end 要从 18/19 → 19/19，apikey/Noon 假值变 400 不是 500。
"""
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

DDL = r"""
set -eu
# 读 .env 拿真实 DB 凭据
cd /opt/shuxu-erp/backend
set -a; . ./.env; set +a

# 兼容老 .env：可能 DB_PASSWORD 或 DB_PASS（真实线上是 DB_PASSWORD）
export DB_PASS="${DB_PASS:-$DB_PASSWORD}"

MYSQL=(mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASS" -D"$DB_NAME" -N -B)

echo '====== BEFORE: DESCRIBE shops ======'
"${MYSQL[@]}" -e "DESCRIBE shops;"
echo '====== BEFORE: DESCRIBE sync_logs ======'
"${MYSQL[@]}" -e "DESCRIBE sync_logs;"
echo '====== BEFORE: SHOW INDEX FROM shops ======'
"${MYSQL[@]}" -e "SHOW INDEX FROM shops;"

# ---- shops: ADD ext_fields_enc ----
HAS_EXT=$("${MYSQL[@]}" -e "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='shops' AND COLUMN_NAME='ext_fields_enc';")
if [ "$HAS_EXT" = "0" ]; then
  echo 'RUN: ALTER TABLE shops ADD COLUMN ext_fields_enc VARCHAR(2048) NULL COMMENT "3+ 密钥字段加密存储";'
  "${MYSQL[@]}" -e "ALTER TABLE shops ADD COLUMN ext_fields_enc VARCHAR(2048) NULL COMMENT '3+ 密钥字段加密存储';"
else
  echo 'SKIP: ext_fields_enc 已存在';
fi

# ---- shops: ADD UNIQUE uk_tpn (tenant_id, platform, name) ----
HAS_IDX=$("${MYSQL[@]}" -e "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='shops' AND INDEX_NAME='uk_tenant_platform_name';")
if [ "$HAS_IDX" = "0" ]; then
  echo 'RUN: CREATE UNIQUE INDEX uk_tenant_platform_name ON shops(tenant_id, platform, name);'
  "${MYSQL[@]}" -e "CREATE UNIQUE INDEX uk_tenant_platform_name ON shops(tenant_id, platform, name);"
else
  echo 'SKIP: uk_tenant_platform_name 已存在';
fi

# ---- sync_logs: ADD platform / imported / skipped / finished_at（一个一个 IF NOT EXISTS）----
for col in 'platform varchar(30) NULL COMMENT "平台名，便于按平台汇总"' \
           'imported int unsigned NULL DEFAULT 0 COMMENT "本次导入条数"' \
           'skipped int unsigned NULL DEFAULT 0 COMMENT "本次跳过重条数"' \
           'finished_at datetime NULL COMMENT "本次同步结束时间"'; do
  name=$(echo "$col" | awk '{print $1}')
  has=$("${MYSQL[@]}" -e "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sync_logs' AND COLUMN_NAME='$name';")
  if [ "$has" = "0" ]; then
    echo "RUN: ALTER TABLE sync_logs ADD COLUMN $col;"
    "${MYSQL[@]}" -e "ALTER TABLE sync_logs ADD COLUMN $col;"
  else
    echo "SKIP: sync_logs.$name 已存在"
  fi
done

echo '====== AFTER: DESCRIBE shops ======'
"${MYSQL[@]}" -e "DESCRIBE shops;"
echo '====== AFTER: DESCRIBE sync_logs ======'
"${MYSQL[@]}" -e "DESCRIBE sync_logs;"
echo '====== AFTER: SHOW INDEX FROM shops ======'
"${MYSQL[@]}" -e "SHOW INDEX FROM shops;"
echo '====== DDL DONE ======'
"""

def main():
    s = ProxiedSock(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(25); s.pc(SH, SP, PH, PP)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SH, port=SP, username=SU, password=SPASS, sock=s, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = ssh.open_sftp()
    with sftp.open('/tmp/_ddl.sh', 'w') as f: f.write(DDL)
    sftp.chmod('/tmp/_ddl.sh', 0o755)
    def run(c):
        _i, o, e = ssh.exec_command(c, timeout=120, get_pty=True)
        return o.read().decode('utf-8','replace'), e.read().decode('utf-8','replace')
    o1, e1 = run('bash /tmp/_ddl.sh 2>&1')
    print(o1)
    if e1.strip(): print('[STDERR ddl]', e1[:2000])
    ssh.close()

    # 立即重跑 e2e
    print('\n\n========== DDL 完后立即重跑 e2e（目标 19/19）==========')
    import subprocess as sp
    r = sp.run(['python3','/workspace/deploy/_end2end.py'], capture_output=True, text=True, cwd='/workspace/deploy')
    print('\n'.join(r.stdout.splitlines()[-140:]))
    if r.stderr.strip(): print('\n[STDERR end2end]\n' + '\n'.join(r.stderr.splitlines()[-40:]))

if __name__ == '__main__':
    main()
