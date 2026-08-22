#!/usr/bin/env python3
"""部署P8：上传前端index.html + 重启Node服务（HTTP CONNECT隧道）"""
import os, sys, paramiko, base64
from pathlib import Path

PROXY = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY') or ''
HOST, PORT, USER, PASS = '120.55.6.75', 22, 'admin', 'yuan340364'
LOCAL = Path('/workspace/deploy/admin/index.html')
REMOTE_ADMIN = '/opt/shuxu-erp/admin/index.html'

def http_connect_tunnel(proxy_url, target_host, target_port):
    from urllib.parse import urlparse
    p = urlparse(proxy_url)
    import socket
    ph, pp = p.hostname, p.port or 80
    s = socket.create_connection((ph, pp), timeout=20)
    req = f'CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\nProxy-Connection: Keep-Alive\r\n\r\n'
    s.sendall(req.encode())
    buf = b''
    while b'\r\n\r\n' not in buf:
        chunk = s.recv(4096)
        if not chunk: raise RuntimeError('Proxy no response')
        buf += chunk
    line1 = buf.split(b'\r\n')[0].decode(errors='ignore')
    if '200' not in line1: raise RuntimeError(f'Proxy rejected: {line1}')
    return s

def get_sftp_shell():
    sock = http_connect_tunnel(PROXY, HOST, PORT) if PROXY else None
    t = paramiko.Transport(sock) if sock else paramiko.Transport((HOST, PORT))
    t.connect(username=USER, password=PASS)
    sftp = paramiko.SFTPClient.from_transport(t)
    chan = t.open_session(); chan.get_pty(); chan.invoke_shell()
    return t, sftp, chan

def run(chan, cmd, timeout=20):
    import time, select
    chan.send(cmd + '\n'); chan.send('echo ===DONE=== $?\n')
    end = time.time() + timeout; out = ''
    while time.time() < end:
        r,_,_ = select.select([chan],[],[], 0.5)
        if r and chan.recv_ready():
            out += chan.recv(65535).decode(errors='ignore')
            if '===DONE===' in out: break
    idx = out.rfind('===DONE===')
    status = '0'
    if idx >= 0:
        rest = out[idx+len('===DONE==='):].strip().split()[0] if idx+len('===DONE===') < len(out) else ''
        status = rest if rest else status
        out = out[:idx]
    return out.strip(), status

def main():
    print('[1/3] 连接服务器...')
    t, sftp, chan = get_sftp_shell()
    try:
        print('[2/3] 上传 index.html ->', REMOTE_ADMIN)
        sftp.put(str(LOCAL), REMOTE_ADMIN)
        st = sftp.stat(REMOTE_ADMIN)
        print(f'  ✓ 已上传，{st.st_size} bytes')

        print('[3/3] 重启Node服务...')
        out, code = run(chan, 'cd /opt/shuxu-erp/backend && set -a && source .env && set +a && pkill -f "node src/app.js" 2>/dev/null; nohup node src/app.js > /tmp/shuxu-app.log 2>&1 &')
        print('  启动命令执行 code=' + code)
        import time; time.sleep(3)
        out, code = run(chan, 'ps aux | grep "node src/app.js" | grep -v grep | head -2')
        print('  Node进程：\n' + out)
        out, code = run(chan, 'curl -sS -m 5 http://127.0.0.1:8090/api/v1/public/landing/config | head -c 300')
        print('  API健康检查：\n' + out[:300])
    finally:
        try: chan.close()
        except: pass
        try: sftp.close()
        except: pass
        try: t.close()
        except: pass

if __name__ == '__main__':
    main()
    print('\n✅ 部署完成')
