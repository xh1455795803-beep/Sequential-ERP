#!/usr/bin/env python3
"""商用化就绪度快速探测 — 只看商用阻塞项"""
import socket, time, paramiko

HOST = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
buf = b''
while b'\r\n\r\n' not in buf:
    chunk = proxy.recv(4096)
    if not chunk: break
    buf += chunk
time.sleep(0.6)

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

def q(label, cmd):
    print('\n[' + label + ']')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out[:800])
    if err and 'NOTICE' not in err: print('STDERR:', err[:400])

# 1. RLS 状态 — 商用必需
q('1. RLS 是否全开放 (DEV=true→PROD=false)',
    "docker exec supabase-db psql -U postgres -c \"" +
    "select tablename, policyname, permissive, roles, cmd, qual, with_check " +
    "from pg_policies where schemaname='public' order by tablename;\"")

# 2. Auth 配置
q('2. Auth: dev 邮箱允许 + 密码策略',
    "docker exec supabase-auth cat /tmp/config.json 2>/dev/null | head -50 || " +
    "docker exec supabase-db psql -U postgres -c \"select key, value from auth.config where key like '%email%' or key like '%password%' or key like '%confirm%';\"")

# 3. 现有 Auth 用户
q('3. 已注册 Auth 用户',
    "docker exec supabase-db psql -U postgres -c \"select id, email, created_at from auth.users order by created_at desc;\"")

# 4. Edge Functions .env 里的真实 Key（非 demo）
q('4. Edge Functions 环境变量（检查 API Key 是否为空）',
    "docker exec supabase-edge-functions env | grep -iE 'TIKTOK|SHOPSECRET|LAZADAOZONAPI|SERPAPI|TENCENT|ALIYUN_SMS|WECHAT' | sed 's/=.*/=<hidden>/' | sort")

# 5. 前端是否有硬编码 merchant_id / warehouse_id
q('5. 前端硬编码检查 (merchant_id / warehouse_id)',
    "grep -rnE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' /workspace/wms-app/src/ 2>/dev/null | grep -v '\\.test\\.' | head -20 || echo '无硬编码'")

# 6. Supabase 配置（production vs development）
q('6. Supabase 项目 .env 状态',
    "sudo cat /opt/supabase/docker/volumes/api-gateway/conf/config.toml 2>/dev/null | head -30 || " +
    "cat /opt/thalvior-source/.env 2>/dev/null | grep -v PASSWORD | grep -v KEY | head -20")

# 7. HTTPS / SSL
q('7. HTTPS 证书状态',
    "echo '--- ssl conf ---' && sudo ls -la /etc/letsencrypt/live/ 2>/dev/null || echo 'no certbot' && " +
    "echo '--- nginx ssl ---' && sudo grep -r ssl /etc/nginx/ 2>/dev/null | head -5 && " +
    "echo '--- test https ---' && curl -sk https://thalvior.icu/ -o /dev/null -w 'HTTP %{http_code}  TLS=%{ssl_verify_result}\\n' 2>&1")

# 8. 备份策略
q('8. 自动备份脚本/cron',
    "echo '--- root cron ---' && sudo crontab -l 2>/dev/null || echo 'no root cron' && " +
    "echo '--- ubuntu cron ---' && crontab -l 2>/dev/null || echo 'no ubuntu cron' && " +
    "echo '--- backups dir ---' && ls -la /home/ubuntu/backups/ 2>/dev/null | head -10")

# 9. 日志/监控
q('9. 日志轮转与监控',
    "echo '--- logrotate ---' && sudo ls /etc/logrotate.d/ 2>/dev/null | head -10 && " +
    "echo '--- docker logs size ---' && sudo du -sh /var/lib/docker/containers/*/*.log 2>/dev/null | sort -rh | head -5")

# 10. Nginx 生产优化
q('10. Nginx 配置',
    "sudo cat /etc/nginx/sites-enabled/default 2>/dev/null | head -50 || sudo cat /etc/nginx/conf.d/*.conf 2>/dev/null | head -50")

ssh.close()
print('\n✅ 探测完毕')
