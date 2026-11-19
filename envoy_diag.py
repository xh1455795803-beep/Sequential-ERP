#!/usr/bin/env python3
"""Envoy 诊断 — 为什么 apikey 401."""
import socket, paramiko, time, json

def run(c, timeout=120, retries=8):
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
        except: time.sleep(2); continue
    raise RuntimeError("SSH failed")

MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

# 1. Envoy 容器环境变量
print("=== 1. Envoy env ===")
o, _ = run("docker exec supabase-envoy env 2>/dev/null | grep -E 'ANON|SECRET|JWT|KEY|SUPABASE'")
print(o)

# 2. Envoy 配置文件里的 lua filter
print("\n=== 2. Envoy envoy.yaml ===")
o, _ = run("cat /opt/supabase/docker/volumes/api/envoy/envoy.yaml")
print(o[:2000])

# 3. Envoy lua filter 内容
print("\n=== 3. Envoy lua filter ===")
o, _ = run("ls /opt/supabase/docker/volumes/api/envoy/; echo '---'; cat /opt/supabase/docker/volumes/api/envoy/lua/auth.lua 2>/dev/null | head -80; echo '---'; find /opt/supabase/docker/volumes/api/envoy -name '*.lua' | while read f; do echo \"=== $f ===\"; cat \"$f\" | head -100; done")
print(o[:3000])

# 4. Envoy admin API
print("\n=== 4. Envoy admin (port 9901) ===")
o, _ = run("curl -sS 'http://localhost:9901/config_dump' 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d[\"configs\"][0][\"dynamic_active_configs\"][0][\"config\"], indent=2)[:2000])' 2>/dev/null || echo 'admin fail'")
print(o[:3000])

# 5. 如果 envoy 用 ANON_KEY 验证 apikey header → meoo 的 anon key 跟当前 .env 的不一致
# 之前我改了 .env 的 ANON_KEY（虽然现在恢复了 meoo 的签名版本）
# 但 envoy 容器是不是没加载新 ANON_KEY？
# 重启 envoy！

# 6. 重启 envoy
print("\n=== 5. Restart envoy ===")
run("docker restart supabase-envoy && sleep 5 && docker ps --filter name=supabase-envoy --format '{{.Names}} {{.Status}}'")

# 7. 再测
print("\n=== 6. Retest auth health with apikey ===")
o, e = run(f"""curl -sS 'http://localhost:8000/auth/v1/health' -H 'apikey: {MEOO_ANON}' 2>&1
echo '---'
curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1 | head -c 500
echo '---'
curl -sS 'http://localhost:8000/rest/v1/' -H 'apikey: {MEOO_ANON}' 2>&1 | head -c 300""", timeout=20)
print(o)
