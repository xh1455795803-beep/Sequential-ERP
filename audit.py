#!/usr/bin/env python3
"""先搞清楚：货小易是怎么跑的？我到底改了哪些不该改的东西？"""
import socket, paramiko

def run(c, timeout=120):
    s = socket.socket(); s.settimeout(15)
    s.connect(('127.0.0.1', 18080))
    s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
    tran = paramiko.Transport(s); tran.start_client(timeout=15); tran.auth_password('ubuntu', 'Yuan340364#')
    chan = tran.open_session(); chan.settimeout(timeout); chan.exec_command(c)
    out = chan.recv(131072).decode(errors='replace')
    err = chan.recv_stderr(65535).decode(errors='replace')
    tran.close(); s.close()
    return out.strip(), err.strip()

# 1. 货小易 nginx 完整配置
print("=" * 70)
print("1. thalvior.fun nginx 完整配置 (货小易)")
print("=" * 70)
o, e = run("cat /etc/nginx/sites-available/thalvior.fun")
print(o)

# 2. 货小易的前端是怎么调用 supabase 的？
print("\n" + "=" * 70)
print("2. 货小易前端文件（meoo）里的 API 配置")
print("=" * 70)
o, e = run("ls /var/www/meoo/; echo '---'; grep -r 'supabase\\|SUPABASE_URL\\|api.thalvior' /var/www/meoo/assets/ 2>/dev/null | head -c 500")
print(o[:2000])

# 3. docker-compose.yml 被我改过哪些行
print("\n" + "=" * 70)
print("3. 当前 docker-compose.yml 中 rest/api-gw 相关行")
print("=" * 70)
o, e = run("grep -n -B1 -A30 'container_name: supabase-envoy' /opt/supabase/docker/docker-compose.yml | head -40")
print(o)
o, e = run("grep -n -B1 -A25 'container_name: supabase-rest' /opt/supabase/docker/docker-compose.yml | head -35")
print(o)

# 4. 当前 .env 被我改过的值
print("\n" + "=" * 70)
print("4. 当前 .env 中我改过的值")
print("=" * 70)
o, e = run("grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY|PGRST)' /opt/supabase/docker/.env")
print(o)

# 5. 所有 wms_ 表的 RLS 状态
print("\n" + "=" * 70)
print("5. wms_ 表 RLS 状态")
print("=" * 70)
o, e = run("docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'wms_%';\"")
print(o)

# 6. 线上 thalvior.fun/wms/ 到底能不能正常跑（外部视角）
print("\n" + "=" * 70)
print("6. thalvior.fun/wms/ 从外部视角测")
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

s, b = test("https://thalvior.fun/wms/")
print(f"  /wms/: {s}")
s, b = test("https://thalvior.fun/wms/dashboard")
print(f"  /wms/dashboard (SPA fallback): {s}")
s, b = test("https://thalvior.fun/wms/assets/")
print(f"  /wms/assets/ directory: {s}")

# 7. envoy 直连 https 能通吗？
print("\n" + "=" * 70)
print("7. 直接测 envoy 的 https (可能没配 TLS)")
print("=" * 70)
s, b = test("https://thalvior.fun:8000/rest/v1/")
print(f"  direct https:8000: {s}")
s, b = test("http://thalvior.fun:8000/rest/v1/")
print(f"  direct http:8000: {s}")

# 8. 货小易自己的 API 代理长啥样？
print("\n" + "=" * 70)
print("8. 货小易的 rest/auth proxy 配置")
print("=" * 70)
o, e = run("awk '/location.*rest/,/^    }/' /etc/nginx/sites-available/thalvior.fun; echo '==='; awk '/location.*auth/,/^    }/' /etc/nginx/sites-available/thalvior.fun")
print(o)
