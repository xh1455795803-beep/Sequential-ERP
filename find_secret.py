#!/usr/bin/env python3
"""搞清楚：哪个 secret + 哪个 anon key 才是 meoo 前端用的组合？"""
import socket, paramiko, time, json, base64, hmac, hashlib

def run(c, timeout=60, retries=5):
    for a in range(retries):
        try:
            s = socket.socket(); s.settimeout(20)
            s.connect(('127.0.0.1', 18080))
            s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
            tran = paramiko.Transport(s); tran.start_client(timeout=20); tran.auth_password('ubuntu', 'Yuan340364#')
            chan = tran.open_session(); chan.settimeout(timeout); chan.exec_command(c)
            out = chan.recv(524288).decode(errors='replace')
            err = chan.recv_stderr(131072).decode(errors='replace')
            tran.close(); s.close()
            return out.strip(), err.strip()
        except Exception as ex:
            print(f"  retry {a+1}: {ex}"); time.sleep(2)
    raise RuntimeError("SSH failed")

# meoo 前端硬编码的 anon key (从 JS 里提取的)
MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

# .env.bak2 里的 anon key
BAK_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.KCQJwqKfYexEfOp1cv6VvuF0y37ydP5szTPd9EqF-WI"

# .env.bak2 里的 JWT_SECRET (不带 padding)
BAK_SECRET_RAW = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/ji"  # 显示 len=44 的完整值

# 当前 .env 里的 secret (我写进去时可能多了 padding)
o, _ = run("grep '^JWT_SECRET=' /opt/supabase/docker/.env | cut -d= -f2")
CUR_SECRET = o.strip()
print(f"当前 secret: [{CUR_SECRET}]  (len={len(CUR_SECRET)})")
print(f"备份 secret: [{BAK_SECRET_RAW}]  (len={len(BAK_SECRET_RAW)})")

# === 测试 1：用 meoo 硬编码的 anon key 测 auth API ===
print("\n=== 测试 1：meoo 硬编码 anon key 能不能用？===")
o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/' -H 'apikey: {MEOO_ANON}' 2>&1 | head -c 200
echo ''
echo '---'
curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' \
  -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1 | head -c 300""")
print(o)

# === 测试 2：用备份里的 anon key 测 ===
print("\n=== 测试 2：备份 anon key 能不能用？===")
o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/' -H 'apikey: {BAK_ANON}' 2>&1 | head -c 200
echo ''
echo '---'
curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {BAK_ANON}' \
  -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1 | head -c 300""")
print(o)

# === 测试 3：如果 meoo anon key 不能用，试试直接用它测 JWT 验证 ===
# meoo anon key 签名 P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw
# 说明 meoo build 时的 JWT_SECRET 跟 .env.bak2 的不一样
# 让我看看其他备份文件里的 anon key 签名
print("\n=== 测试 3：找所有备份里 anon key 签名匹配 meoo 的 ===")
import base64 as b64
for fname in [
    "/opt/supabase/docker/.env.snapshot-20261117-preadminA-state",
    "/opt/supabase/docker/.env.bak-20261117-wB",
    "/opt/supabase/docker/.env.bak-1790354592",
]:
    o, _ = run(f"sudo cat {fname} 2>/dev/null")
    for line in o.split('\n'):
        if line.startswith('ANON_KEY='):
            key = line.split('=',1)[1].strip()
            sig = key.split('.')[-1]
            match = "✅ MATCH" if sig == MEOO_ANON.split('.')[-1] else "❌ NO MATCH"
            print(f"  {fname}: sig=...{sig[-30:]} {match}")
        if line.startswith('JWT_SECRET='):
            sec = line.split('=',1)[1].strip()
            print(f"    secret=[{sec}] (len={len(sec)})")

# === 测试 4：如果 meoo anon 不匹配任何备份，那 meoo build 时的 secret 到底是什么？===
# 另一个线索：meoo 里有 VITE_SUPABASE_URL=https://thalvior.icu
# thalvior.icu 和 thalvior.fun 是两个域名，可能不同时间 build 的

# 真正的问题：我只需要让 meoo 恢复工作。
# 如果 meoo 硬编码的 anon key 在当前 auth 容器里验证失败，
# 那我就用 meoo 硬编码的 anon key 作为 AUTH 的 static anon key 重新配置！
# auth 支持 static anon key... 不，auth 是用 JWT_SECRET 签的。

# 正确做法：找到 meoo build 时用的 JWT_SECRET，恢复它。
# 或者：重新用当前 secret 签 meoo 里的 anon key（前端编译好了改不了）。
# 最后一招：从 meoo anon key 的 payload iat 推断当时的 secret。
# iat=1790268016 ≈ 2026-09-24 — 看看 9 月的备份。
print("\n=== 测试 4：9月备份 ===")
for fname in [
    "/opt/supabase/docker/.env.bak.smshook.20260926_173202",
    "/opt/supabase/docker/.env.bak_autoconfirm",
    "/opt/supabase/docker/.env.bak.track17",
]:
    o, _ = run(f"sudo cat {fname} 2>/dev/null")
    for line in o.split('\n'):
        if line.startswith('ANON_KEY='):
            key = line.split('=',1)[1].strip()
            sig = key.split('.')[-1]
            match = "✅ MATCH" if sig == MEOO_ANON.split('.')[-1] else "❌"
            print(f"  {fname}: sig={sig[-20:]} {match}")
        if line.startswith('JWT_SECRET='):
            sec = line.split('=',1)[1].strip()
            print(f"    secret=[{sec}]")

# === 方案：如果找不到 meoo 对应的 secret ===
# 让 meoo 的 auth 用 meoo 自己那个 anon key 的 secret... 不行
# 换个思路：让 auth 容器支持 meoo anon key 验证
# auth 用 GOTRUE_JWT_SECRET 验签，必须一致
# 那我需要同时支持两个 secret？auth 不支持多 secret
# 最后的办法：重新 build + deploy meoo（但我没源码）

# 先测当前 secret + 当前 auth 能不能用 meoo anon key 验证
print("\n=== 测试 5：验证 meoo anon key 签名 ===")
o, _ = run("grep '^JWT_SECRET=' /opt/supabase/docker/.env | cut -d= -f2")
cur_secret = o.strip()
# 去掉可能的 padding
if cur_secret.endswith('='):
    cur_secret_nopad = cur_secret.rstrip('=')
else:
    cur_secret_nopad = cur_secret

sig_input = '.'.join(MEOO_ANON.split('.')[:2])
for name, sec in [("cur (with pad)", cur_secret), ("cur (no pad)", cur_secret_nopad), 
                  ("bak (no pad)", BAK_SECRET_RAW)]:
    try:
        sec_bytes = b64.urlsafe_b64decode(sec + '==')
        sig = hmac.new(sec_bytes, sig_input.encode(), hashlib.sha256).digest()
        sig_b64 = b64.urlsafe_b64encode(sig).rstrip(b'=').decode()
        match = "✅ MATCH" if sig_b64 == MEOO_ANON.split('.')[-1] else "❌"
        print(f"  {name}: computed sig={sig_b64[-20:]} {match}")
    except Exception as ex:
        print(f"  {name}: error {ex}")
