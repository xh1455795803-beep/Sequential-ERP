#!/usr/bin/env python3
"""对比原始 .env 和我改过的 .env — JWT_SECRET 到底变了没？"""
import socket, paramiko

def run(c, timeout=60):
    s = socket.socket(); s.settimeout(15)
    s.connect(('127.0.0.1', 18080))
    s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
    tran = paramiko.Transport(s); tran.start_client(timeout=15); tran.auth_password('ubuntu', 'Yuan340364#')
    chan = tran.open_session(); chan.settimeout(timeout); chan.exec_command(c)
    out = chan.recv(131072).decode(errors='replace')
    err = chan.recv_stderr(65535).decode(errors='replace')
    tran.close(); s.close()
    return out.strip(), err.strip()

# 1. 几个关键备份文件的 JWT 值
print("=== 各备份文件的 JWT_SECRET 对比 ===")
for fname in [
    "/opt/supabase/docker/.env",           # 当前
    "/opt/supabase/docker/.env.bak",       # 最近的备份
    "/opt/supabase/docker/.env.bak2",
    "/opt/supabase/docker/.env.bak.1795068396",  # 今天 14:06
    "/opt/supabase/docker/.env.bak-20261118-184311",  # 昨天 18:43
    "/opt/supabase/docker/.env.snapshot-20261117-preadminA-state",  # 11/17 快照
]:
    o, _ = run(f"grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' {fname} 2>/dev/null | sed 's/JWT_SECRET/JWT_SECRET/g'")
    print(f"\n--- {fname} ---")
    for line in o.split('\n'):
        if line:
            k, v = line.split('=', 1)
            # 只显示前30后20
            print(f"  {k}: {v[:30]}...{v[-20:]}  (len={len(v)})")

# 2. 当前 auth 容器和 postgrest 的 secret
print("\n=== 运行中容器的实际 secret ===")
o, _ = run("docker exec supabase-auth env 2>/dev/null | grep 'GOTRUE_JWT_SECRET'")
print(f"  auth GOTRUE_JWT_SECRET: {o.split('=',1)[1] if '=' in o else 'N/A'}")
o, _ = run("docker exec supabase-rest postgrest --dump-config 2>/dev/null | grep 'jwt-secret'")
print(f"  rest jwt-secret: {o}")

# 3. 货小易 meoo 前端里到底写了什么 anon key？
print("\n=== 货小易 meoo 前端里的 anon key ===")
o, e = run("grep -r 'eyJ' /var/www/meoo/ 2>/dev/null | head -5; echo '---'; for f in /var/www/meoo/assets/*.js; do grep -oE 'eyJ[a-zA-Z0-9_-]{10,}\\.[a-zA-Z0-9_-]{10,}\\.[a-zA-Z0-9_-]{10,}' \"$f\" 2>/dev/null; done | sort -u | head -5")
print(o[:2000])

# 4. 关键：当前货小易用的 ANON_KEY 跟我改之前一样吗？
# 如果 meoo 前端没有硬编码 anon key（从环境来的），那没问题
# 如果硬编码了旧的，那我就搞坏了
