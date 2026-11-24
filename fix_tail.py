#!/usr/bin/env python3
"""修 Nginx zone 格式 + 最终 reload"""
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

def do(label, cmd):
    print('\n=== [' + label + '] ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out[:400])
    if err: print('ERR:', err[:300])

# 修 security.conf 里的 zone 大小
do('1. 修 nginx zone 格式',
    "sudo python3 << 'PYEOF'\n"
    "path = '/etc/nginx/conf.d/security.conf'\n"
    "with open(path) as f: c = f.read()\n"
    "# zone=conn_per_ip:10 → zone=conn_per_ip:10m\n"
    "c = c.replace('zone=conn_per_ip:10', 'zone=conn_per_ip:10m')\n"
    "with open(path, 'w') as f: f.write(c)\n"
    "print('✅ 已修复 zone 大小格式')\n"
    "PYEOF")

do('2. nginx -t + reload',
    "sudo nginx -t 2>&1 && sudo nginx -s reload && echo '✅ nginx reloaded OK'")

# 再次验证审计日志（用真实的列）
do('3. 审计日志再次验证 — 用 outbound_orders',
    "docker exec -i supabase-db psql -U supabase_admin -d postgres << 'SQL'\n"
    "INSERT INTO tlv_stock_takes (warehouse_id, merchant_id, take_type, status)\n"
    "VALUES ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'dynamic', 'completed');\n"
    "\n"
    "SELECT operation, table_name, merchant_id, new_data->>'take_type' as take_type, created_at\n"
    "FROM tlv_audit_logs\n"
    "WHERE created_at > now() - interval '2 minutes'\n"
    "ORDER BY created_at DESC LIMIT 5;\n"
    "SQL")

# 最终统计
do('4. audit_logs 总数',
    "docker exec supabase-db psql -U postgres -d postgres -c \"SELECT count(*) FROM tlv_audit_logs;\"")

# 验证安全头现在全部生效
import requests
try:
    r = requests.get('https://thalvior.icu/', timeout=15, allow_redirects=True)
    h = r.headers
    print('\n【安全头最终验证】')
    headers_to_check = [
        ('X-Frame-Options', 'SAMEORIGIN'),
        ('X-Content-Type-Options', 'nosniff'),
        ('Strict-Transport-Security', 'max-age=63072000; includeSubDomains'),
    ]
    for k, v in headers_to_check:
        actual = h.get(k, h.get(k.lower(), ''))
        ok = actual == v
        print('  ' + ('✅' if ok else '❌') + ' ' + k + ': ' + actual[:60])
except Exception as e:
    print('  ⚠️ 请求失败:', str(e)[:60])

ssh.close()
print('\n✅ 全部修复完成！')
