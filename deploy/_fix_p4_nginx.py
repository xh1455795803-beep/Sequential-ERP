#!/usr/bin/env python3
"""P4-NGINX修复：修正SSL证书路径，确保官网落地页根路径/生效"""
import os, sys, socket, time
from urllib.parse import urlparse
import paramiko

PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))
HOST = '120.55.6.75'
USER = 'admin'
PASS = 'yuan340364'

def log(*a, **k): print('[NGINX]', *a, flush=True, **k)

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

    # 先看SSL证书真实位置
    print("\n🔍 1. 查找SSL证书真实位置")
    print("="*60)
    run(cli, "ls -la /etc/nginx/ssl/ 2>&1 ; echo '---'; ls -la /etc/pki/nginx/ 2>&1 | head", sudo=True)

    # 写修正后的Nginx配置
    print("\n🔧 2. 写修正后的Nginx配置（使用正确证书路径）")
    print("="*60)
    NEW_CONF = r'''# 数序ERP — qianniu-erp.cc 唯一入口
# 80 端口：全部 301 跳转到 HTTPS
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name qianniu-erp.cc www.qianniu-erp.cc;
    return 301 https://$host$request_uri;
}

# 443 端口：官网落地页(/) + ERP控制台(/app/) + 后端API(/api/)
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

    # 安全头（always确保所有状态码都返回）
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # ============ 1. 官网落地页（根路径直接访问，无需登录） ============
    location = / {
        alias /opt/shuxu-erp/landing/index.html;
        expires -1;
        add_header Cache-Control "no-store" always;
    }

    # 官网静态文件兜底（如果landing目录不存在，则跳转到/app/）
    location ~* ^\/[^/]+\.(html|css|js|png|jpg|jpeg|svg|gif|ico|webp|woff2?)$ {
        root /opt/shuxu-erp/landing;
        if (!-f $request_filename) {
            # 不在官网静态目录，走ERP控制台
            rewrite ^ /app$uri last;
        }
        expires 7d;
        add_header Cache-Control "public";
    }

    # ============ 2. 上传素材静态文件 ============
    location ^~ /uploads/ {
        alias /opt/shuxu-erp/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public" always;
    }

    # ============ 3. ERP 控制台（SPA 单文件，哈希路由） ============
    location ^~ /app/ {
        alias /opt/shuxu-erp/admin/;
        try_files $uri $uri/ /app/index.html;
        add_header Cache-Control 'no-store' always;
    }
    location = /app { return 301 /app/; }

    # ============ 4. 后端 API (Node.js 8090) ============
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

    # ============ 5. 其他路径 → 跳官网 ============
    location / {
        return 302 /;
    }
}
'''
    sftp.open('/tmp/shuxu-erp.conf.fixed', 'w').write(NEW_CONF)
    run(cli, "sudo cp /tmp/shuxu-erp.conf.fixed /etc/nginx/conf.d/shuxu-erp.conf", sudo=True)
    rc, _, _ = run(cli, "sudo nginx -t 2>&1", sudo=True)
    if rc == 0:
        run(cli, "sudo systemctl reload nginx 2>&1", sudo=True)
        time.sleep(2)
    else:
        log("❌ Nginx配置测试失败，回滚旧配置后退出")
        return

    # 验证
    print("\n✅ 3. 验证所有入口")
    print("="*60)
    checks = [
        ("🔴 根路径 / (官网页面)",   "curl -sS -m 6 -L -o /tmp/x.html -w 'HTTP=%{http_code} size=%{size_download} final=%{url_effective}\\n' https://qianniu-erp.cc/ 2>&1 ; grep -oE '<title>[^<]+</title>|<h1[^>]*>[^<]{0,60}</h1>|一站式|数序跨境' /tmp/x.html | head -5"),
        ("🟢 /app/ (ERP控制台)", "curl -sS -m 6 -o /dev/null -w 'HTTP=%{http_code} size=%{size_download}\\n' https://qianniu-erp.cc/app/"),
        ("🟢 /api/health (后端)", "curl -sS -m 6 https://qianniu-erp.cc/api/health"),
        ("🟢 官网动态API /landing/config", "curl -sS -m 8 https://qianniu-erp.cc/api/v1/public/landing/config | python3 -c \"import sys,json;d=json.load(sys.stdin);print('ready=',d.get('ready'),'banner=',len(d.get('banner',[])),'plans=',len(d.get('plans',[])))\" 2>&1"),
        ("🟢 体验申请POST", "curl -sS -m 8 -X POST -H 'Content-Type: application/json' -d '{\"phone\":\"13800000001\",\"shop_type\":\"测试\"}' https://qianniu-erp.cc/api/v1/public/landing/apply 2>&1 | head -c 200"),
    ]
    for name, cmd in checks:
        log(f"--- {name} ---")
        run(cli, cmd)

    sftp.close()
    cli.close()
    print("\n🎉 官网落地页 + Nginx路由全部生效！")

if __name__ == "__main__":
    main()
