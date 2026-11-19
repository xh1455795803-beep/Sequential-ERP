#!/usr/bin/env python3
"""救命！恢复原始 JWT_SECRET — 从备份文件里找！"""
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

# 1. 直接读备份文件的 JWT_SECRET
print("=== 所有备份文件的 JWT_SECRET 对比 ===")
files = [
    "/opt/supabase/docker/.env.bak.20261118-184311",
    "/opt/supabase/docker/.env.snapshot-20261117-preadminA-state",
    "/opt/supabase/docker/.env.bak.1795068396",
    "/opt/supabase/docker/.env.bak",
    "/opt/supabase/docker/.env.bak2",
]
for f in files:
    o, _ = run(f"sudo cat {f} 2>/dev/null | grep '^JWT_SECRET='")
    print(f"  {f}: {o}")

# 2. 也看看 meoo 里硬编码的 anon key payload 里有没有 hint
# anon key 的 payload 是 {"role":"anon","iss":"supabase","iat":...,"exp":...}
# 但 JWT_SECRET 是用来验证签名的，从签名无法反推 secret
# 不过 meoo 里有个 VITE_SUPABASE_URL=https://thalvior.icu — 说明原来的 URL 是 thalvior.icu

# 3. 看看 git log 里有没有 .env 改动记录
print("\n=== git log for .env ===")
o, e = run("cd /opt/supabase && git log --all --oneline -- docker/.env 2>&1 | head -10")
print(o)

# 4. 原始 anon key 的 payload iat 是多少？
# eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw
# payload: {"role":"anon","iss":"supabase","iat":1790268016,"exp":2105628016}
# iat=1790268016 ≈ 2026-09-24
# 那时候的 JWT_SECRET 是什么？

# 5. 看看 .env.bak-1790354592 (Sep 26) 的值
print("\n=== 更多备份 ===")
for f in [
    "/opt/supabase/docker/.env.bak-1790354592",
    "/opt/supabase/docker/.env.bak.track17",
    "/opt/supabase/docker/.env.bak_autoconfirm",
]:
    o, _ = run(f"sudo cat {f} 2>/dev/null | grep '^JWT_SECRET='")
    print(f"  {f}: {o}")

# 6. 紧急：如果找不到原始 secret，用硬编码的 anon key 反推？不行，签名无法反推
# 那换个思路：保留新 secret，但用新 secret 重新签 meoo 里硬编码的那两个 key（让它们变成可用）
# 不行，meoo 前端的 JS 是编译好的，没法改

# 7. 看看当前 JWT_SECRET 值和我之前改过的记录
print("\n=== 当前 JWT_SECRET 值 ===")
o, _ = run("grep '^JWT_SECRET=' /opt/supabase/docker/.env")
print(o)

# 8. 看看我自己的工作目录有没有之前的值
print("\n=== 本地工作目录有没有旧值 ===")
import os
for f in os.listdir("/workspace"):
    if f.endswith('.py') or f.endswith('.sh') or f.endswith('.env*') or f.endswith('.sql'):
        try:
            with open(f"/workspace/{f}") as fh:
                content = fh.read()
            if 'JWT_SECRET' in content and 'thalvior-wms' not in content:
                print(f"  {f}: has old JWT_SECRET references")
        except: pass
