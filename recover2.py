#!/usr/bin/env python3
"""恢复原始 JWT_SECRET — 带重试."""
import socket, paramiko, time, os

def run(c, timeout=120, retries=5):
    for attempt in range(retries):
        try:
            s = socket.socket(); s.settimeout(20)
            s.connect(('127.0.0.1', 18080))
            s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
            tran = paramiko.Transport(s); tran.start_client(timeout=20); tran.auth_password('ubuntu', 'Yuan340364#')
            chan = tran.open_session(); chan.settimeout(timeout); chan.exec_command(c)
            out = chan.recv(131072).decode(errors='replace')
            err = chan.recv_stderr(65535).decode(errors='replace')
            tran.close(); s.close()
            return out.strip(), err.strip()
        except Exception as ex:
            print(f"  retry {attempt+1}: {ex}"); time.sleep(3)
    raise RuntimeError("max retries exceeded")

# 1. 所有备份文件里的 JWT_SECRET 值
print("=== 所有备份文件的 JWT_SECRET ===")
files = [
    "/opt/supabase/docker/.env.bak.20261118-184311",
    "/opt/supabase/docker/.env.snapshot-20261117-preadminA-state",
    "/opt/supabase/docker/.env.bak",
    "/opt/supabase/docker/.env.bak2",
    "/opt/supabase/docker/.env.bak.1795068396",
    "/opt/supabase/docker/.env.bak-1790354592",
    "/opt/supabase/docker/.env.bak.track17",
    "/opt/supabase/docker/.env.bak_autoconfirm",
    "/opt/supabase/docker/.env.bak.smshook.20260926_173202",
    "/opt/supabase/docker/.env.bak-before-gotrue-fix-1794885247",
    "/opt/supabase/docker/.env.bak-20261117-wB",
]
for f in files:
    o, e = run(f"sudo cat {f} 2>/dev/null")
    secret = [l.split('=',1)[1] for l in o.split('\n') if l.startswith('JWT_SECRET=')]
    anon = [l.split('=',1)[1] for l in o.split('\n') if l.startswith('ANON_KEY=')]
    if secret:
        print(f"\n  ✅ {os.path.basename(f)}:")
        print(f"     JWT_SECRET = {secret[0][:40]}... (len={len(secret[0])})")
        if anon:
            print(f"     ANON_KEY   = {anon[0][:40]}... (len={len(anon[0])})")
    else:
        print(f"  ❌ {os.path.basename(f)}: no JWT_SECRET or no permission")
