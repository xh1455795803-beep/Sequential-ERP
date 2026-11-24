#!/usr/bin/env python3
"""终极：导出所有 tlv_* 表完整 schema 到本地 JSON"""
import socket, time, paramiko, json

HOST, PORT, USER, PASS = '43.133.232.81', 22, 'ubuntu', 'yuan340364#'

def connect():
    sock = socket.socket(); sock.settimeout(20); sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    for attempt in range(20):
        try:
            sock.connect(('127.0.0.1', 18080))
            sock.sendall(f'CONNECT {HOST}:{PORT} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n\r\n'.encode())
            buf = b''
            while b'\r\n\r\n' not in buf:
                d = sock.recv(4096)
                if not d: break
                buf += d
            time.sleep(1)
            t = paramiko.Transport(sock); t.start_client(); t.auth_password(USER, PASS)
            c = paramiko.SSHClient(); c._transport = t; c._sftp_live = False
            return c
        except Exception:
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('connect failed')

def run(c, cmd, timeout=60):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

# 导出所有 tlv_* 表列
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -F $'\t' -At -c \"
SELECT table_name || '\t' || ordinal_position || '\t' || column_name || '\t' || data_type || '\t' || is_nullable || '\t' || coalesce(column_default, '')
FROM information_schema.columns 
WHERE table_schema='public' AND table_name LIKE 'tlv_%'
ORDER BY table_name, ordinal_position;
\"""")

tables = {}
for line in o.strip().split('\n'):
    parts = line.split('\t')
    if len(parts) >= 5:
        tname, pos, col, dtype, nullable = parts[0], parts[1], parts[2], parts[3], parts[4]
        default = parts[5] if len(parts) > 5 else ''
        if tname not in tables:
            tables[tname] = []
        tables[tname].append({
            'pos': int(pos), 'name': col, 'type': dtype, 
            'nullable': nullable == 'YES', 'default': default
        })

# 保存 JSON
with open('/workspace/db_schema_final.json', 'w') as f:
    json.dump(tables, f, indent=2, ensure_ascii=False)

# 打印摘要
print(f'✅ 导出 {len(tables)} 张表的 {sum(len(v) for v in tables.values())} 列 → db_schema_final.json\n')

for tname, cols in sorted(tables.items()):
    print(f'📋 {tname} ({len(cols)} 列):')
    nullable_cols = [c['name'] for c in cols if not c['nullable']]
    print(f'   NOT NULL: {nullable_cols}')
    print()

c.close()
