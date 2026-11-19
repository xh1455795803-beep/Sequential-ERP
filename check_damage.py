#!/usr/bin/env python3
"""紧急检查：货小易会不会被我改 JWT_SECRET 搞崩了？"""
import socket, paramiko, time

def run(c, timeout=120, retries=3):
    last_err = None
    for _ in range(retries):
        try:
            s = socket.socket(); s.settimeout(15)
            s.connect(('127.0.0.1', 18080))
            s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
            tran = paramiko.Transport(s); tran.start_client(timeout=15); tran.auth_password('ubuntu', 'Yuan340364#')
            chan = tran.open_session(); chan.settimeout(timeout); chan.exec_command(c)
            out = chan.recv(131072).decode(errors='replace')
            err = chan.recv_stderr(65535).decode(errors='replace')
            tran.close(); s.close()
            return out.strip(), err.strip()
        except Exception as ex:
            last_err = ex; time.sleep(2)
    raise last_err

# 1. 有没有 git 历史 / 备份能找到原始 JWT_SECRET？
print("=" * 70)
print("1. 找原始 JWT_SECRET")
print("=" * 70)
o, e = run("cd /opt/supabase && git log --oneline -5 2>&1; echo '---'; git diff HEAD docker/.env 2>&1 | head -30; echo '---'; git stash list 2>&1")
print(o[:2000])

o, e = run("ls -la /opt/supabase/docker/.env* 2>&1; echo '---'; ls /var/backups/ 2>/dev/null; echo '---'; find /opt -name '.env.bak*' -o -name '.env.old*' 2>/dev/null | head -5; echo '---'; cat ~/.bash_history 2>/dev/null | grep -i 'JWT\\|supabase\\|secret' | head -10")
print(o[:2000])

# 2. 货小易 meoo 前端里硬编码了什么 API URL / anon key？
print("\n" + "=" * 70)
print("2. 货小易 meoo 前端用什么 API / anon key？")
print("=" * 70)
o, e = run("ls /var/www/meoo/assets/ | head -10; echo '---'; strings /var/www/meoo/assets/*.js 2>/dev/null | grep -i 'supabase\\|SUPABASE_URL\\|anon\\|ANON_KEY\\|thalvior.icu.*rest\\|thalvior.fun.*rest' | sort -u | head -20")
print(o[:2000])

# 3. 测试货小易当前能不能正常 auth
print("\n" + "=" * 70)
print("3. 用当前 ANON_KEY 测试 auth API")
print("=" * 70)
o, _ = run("grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2")
CUR_ANON = o.strip()
o, e = run(f"""curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {CUR_ANON}' \
  -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1 | head -c 300""")
print(f"Auth (new anon): {o[:300]}")

# 4. 如果我知道原来的 secret 是什么格式就能重建...
# 看看有没有其他地方存了旧的
print("\n" + "=" * 70)
print("4. 其他可能的 secret 来源")
print("=" * 70)
o, e = run("docker exec supabase-auth env 2>/dev/null | grep -iE 'JWT|SECRET|KEY' | head -10; echo '---'; cat /opt/supabase/docker/.env | head -20")
print(o[:1500])

# 5. meoo 前端实际调用 API 看看通不通
print("\n" + "=" * 70)
print("5. 货小易 API 实际测试")
print("=" * 70)
import urllib.request, json
def test(url, headers=None):
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read()[:500].decode(errors='replace')
    except urllib.error.HTTPError as ex:
        return f"HTTP {ex.code}", ex.read()[:300].decode(errors='replace')
    except Exception as ex:
        return f"ERR: {ex}", ""

s, b = test("https://thalvior.fun/rest/v1/", {"apikey": CUR_ANON})
print(f"  thalvior.fun/rest/v1/ (new anon): {s} → {b[:200]}")

# 货小易前端页面看看能不能正常加载
s, b = test("https://thalvior.fun/portal/forwarder")
print(f"  thalvior.fun/portal/forwarder: {s}")
if 'assets' in b or 'script' in b:
    print("    ✅ 页面能加载")
else:
    print(f"    content: {b[:200]}")
