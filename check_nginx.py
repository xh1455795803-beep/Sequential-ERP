#!/usr/bin/env python3
"""Check nginx + domain, then fix frontend URL if needed."""
import socket, paramiko

def ssh_exec(cmd, timeout=120, retries=3):
    last_err = None
    for _ in range(retries):
        try:
            s = socket.socket(); s.settimeout(15)
            s.connect(('127.0.0.1', 18080))
            s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
            t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')
            chan = t.open_session(); chan.settimeout(timeout); chan.exec_command(cmd)
            out = chan.recv(131072).decode(errors='replace')
            err = chan.recv_stderr(65535).decode(errors='replace')
            t.close(); s.close()
            return out.strip(), err.strip()
        except Exception as ex:
            last_err = ex; time.sleep(2)
    raise last_err

def run(c, t=120): return ssh_exec(c, t)

# Check nginx full config
o, e = run("""echo '=== NGINX SITES-ENABLED ==='; ls -la /etc/nginx/sites-enabled/ 2>/dev/null; \
echo '=== NGINX CONF D ==='; ls -la /etc/nginx/conf.d/ 2>/dev/null; \
echo '=== ALL SITE FILES ==='; cat /etc/nginx/sites-enabled/* 2>/dev/null | head -100; \
cat /etc/nginx/conf.d/*.conf 2>/dev/null | head -100; \
echo '=== LISTENING PORTS ==='; sudo netstat -tlnp 2>/dev/null | head -30 || ss -tlnp | head -30; \
echo '=== SYSTEMD ==='; systemctl status nginx --no-pager 2>/dev/null | head -10; \
echo '=== DOMAIN DNS ==='; nslookup thalvior.icu 2>/dev/null || host thalvior.icu 2>/dev/null || echo 'no dns tool'; \
echo '=== CURL LOCALHOST TESTS ==='; curl -sS -o /dev/null -w 'port80: %{http_code}\\n' http://localhost/ 2>&1; \
curl -sS -o /dev/null -w 'port8000: %{http_code}\\n' http://localhost:8000/ 2>&1; \
curl -sk -o /dev/null -w 'port443: %{http_code}\\n' https://localhost/ 2>&1""")
print(o[:3000])
if e: print("[ERR]", e[:500])

# Also check if there's a docker-compose proxy or caddy
o, e = run("""docker ps --format '{{.Names}} {{.Image}} {{.Ports}}' 2>/dev/null | head -20; \
echo '---'; ls /opt/ 2>/dev/null; ls ~/ 2>/dev/null; \
echo '---'; cat /etc/hosts 2>/dev/null""")
print("\n" + o[:2000])
