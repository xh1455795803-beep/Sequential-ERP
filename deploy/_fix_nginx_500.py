#!/usr/bin/env python3
"""P4-500FIX：修复官网落地页500错误，查Nginx错误日志并修配置"""
import os, sys, socket, time
from urllib.parse import urlparse
import paramiko

PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))
HOST = '120.55.6.75'
USER = 'admin'
PASS = 'yuan340364'

def log(*a, **k): print('[FIX500]', *a, flush=True, **k)

def connect():
    p = urlparse(PROXY_URL); ph, pp = p.hostname, p.port or 80
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(20); s.connect((ph, pp))
    s.sendall(f'CONNECT {HOST}:22 HTTP/1.1\r\nHost: {HOST}:22\r\n\r\n'.encode())
    data = b''
    while b'\r\n\r\n' not in data: data += s.recv(1)
    if b'200' not in data.split(b'\r\n')[0]: raise RuntimeError('CONNECT fail')
    cli = paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(hostname=HOST, port=22, username=USER, password=PASS,
                sock=s, timeout=25, banner_timeout=20, auth_timeout=20,
                allow_agent=False, look_for_keys=False)
    log('✅ SSH OK')
    return cli

def run(cli, cmd, timeout=300, sudo=False):
    import shlex
    if sudo: cmd = "sudo -n bash -lc " + shlex.quote(cmd)
    log('$', cmd[:200])
    stdin, stdout, stderr = cli.exec_command(cmd, timeout=timeout, get_pty=True)
    out = []
    while True:
        try: line = stdout.readline()
        except: break
        if not line: break
        sys.stdout.write('   | ' + line); out.append(line)
    err = stderr.read().decode(errors='ignore')
    rc = stdout.channel.recv_exit_status()
    if rc != 0:
        log(f'   👉 exit={rc}')
        if err.strip(): log('   STDERR:', err[:1200])
    return rc, ''.join(out), err

def main():
    cli = connect()
    sftp = cli.open_sftp()

    # 1. 看Nginx错误日志
    print("\n🔍 1. Nginx最近错误日志（尾30行）")
    print("="*60)
    run(cli, "sudo tail -30 /var/log/nginx/error.log 2>&1", sudo=True)

    # 2. 验证landing目录可读 + 测试直接用nginx serve文件
    print("\n🔍 2. Landing目录权限 + 手工访问测试")
    print("="*60)
    run(cli, "ls -la /opt/shuxu-erp/landing/ ; echo '---'; sudo -u nginx cat /opt/shuxu-erp/landing/index.html > /dev/null 2>&1 && echo 'nginx可读 OK' || echo 'nginx不可读 FAIL' ; stat -c '%a %U %G %n' /opt/shuxu-erp/landing /opt/shuxu-erp/landing/index.html", sudo=True)

    # 3. 修配置：改用root + try_files方式更可靠（alias单文件容易踩坑）
    print("\n🔧 3. 修复Nginx配置：官网改用root + try_files /index.html")
    print("="*60)
    NEW_CONF = r'''# 数序ERP — qianniu-erp.cc 唯一入口
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name qianniu-erp.cc www.qianniu-erp.cc;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name qianniu-erp.cc www.qianniu-erp.cc;

    ssl_certificate     /etc/nginx/ssl/qianniu-erp.cc.crt;
    ssl_certificate_key /etc/nginx/ssl/qianniu-erp.cc.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # ========== 1. 后端 API 优先级最高 ==========
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 15s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        client_max_body_size 50m;
    }

    # ========== 2. 上传素材 ==========
    location ^~ /uploads/ {
        alias /opt/shuxu-erp/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public" always;
    }

    # ========== 3. ERP 控制台 /app/* ==========
    location ^~ /app/ {
        alias /opt/shuxu-erp/admin/;
        try_files $uri $uri/ /app/index.html;
        add_header Cache-Control 'no-store' always;
    }
    location = /app { return 301 /app/; }

    # ========== 4. 官网落地页：以 / 开头但不是上述 API/uploads/app 的所有路径，都走 landing 目录 ==========
    root /opt/shuxu-erp/landing;
    index index.html;

    location = / {
        expires -1;
        add_header Cache-Control "no-store" always;
        try_files /index.html =404;
    }

    # SPA 兼容：官网如果有其他前端路径，回退到官网index.html
    # （当前官网是单页多锚点，这个主要用于防刷新404）
    location / {
        expires 7d;
        # 如果是真实静态文件直接返回，否则回退到官网首页（不跳/app）
        try_files $uri $uri/ /index.html;
    }
}
'''
    sftp.open('/tmp/shuxu-erp.v3.conf', 'w').write(NEW_CONF)
    run(cli, "sudo cp /tmp/shuxu-erp.v3.conf /etc/nginx/conf.d/shuxu-erp.conf", sudo=True)
    rc, _, _ = run(cli, "sudo nginx -t 2>&1", sudo=True)
    if rc == 0:
        run(cli, "sudo systemctl reload nginx 2>&1", sudo=True)
        time.sleep(2)
        # 清Nginx缓存（如果有）
        run(cli, "sudo systemctl restart nginx 2>&1", sudo=True)
        time.sleep(2)
    else:
        log("❌ Nginx test失败")
        return

    # 4. 验证
    print("\n✅ 4. 重测所有入口")
    print("="*60)
    checks = [
        ("根路径 /",   "curl -sS -m 8 -o /tmp/x.html -w 'HTTP=%{http_code} size=%{size_download}\n' https://qianniu-erp.cc/ ; echo '--- title/keywords check ---' ; head -c 600 /tmp/x.html | grep -oE '<title>[^<]+</title>' ; grep -cE '一站式|核心优势|数序跨境|套餐价格' /tmp/x.html"),
        ("/app/",       "curl -sS -m 6 -o /dev/null -w 'HTTP=%{http_code} size=%{size_download}\n' https://qianniu-erp.cc/app/"),
        ("/api/health", "curl -sS -m 6 -w ' HTTP=%{http_code}\n' https://qianniu-erp.cc/api/health | head -c 120"),
    ]
    for name, cmd in checks:
        log(f"--- {name} ---")
        run(cli, cmd)

    sftp.close()
    cli.close()

if __name__ == "__main__":
    main()
