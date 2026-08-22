#!/usr/bin/env python3
# 服务器 L1-L2 运行态实时诊断：通过 HTTPS_PROXY HTTP CONNECT 隧道 SSH 到 120.55.6.75
# 只做只读检测，不修改任何东西
import os, sys, json, re, socket, base64, time, traceback
try:
    import paramiko
except Exception as e:
    print('需要先: pip3 install paramiko\\nError:', e); sys.exit(1)

PROXY = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy') or 'http://127.0.0.1:18080'
m = re.match(r'https?://([^:]+):(\d+)', PROXY)
if not m:
    print('PROXY 格式不支持:', PROXY); sys.exit(1)
PROXY_HOST, PROXY_PORT = m.group(1), int(m.group(2))

SSH_HOST = '120.55.6.75'
SSH_PORT = 22
SSH_USER, SSH_PASS = 'admin', 'yuan340364'

class ProxiedSock(socket.socket):
    def __init__(self, *a, **kw): super().__init__(*a, **kw)
    def proxied_connect(self, host, port, proxy_host, proxy_port):
        self.connect((proxy_host, proxy_port))
        req = f'CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\nProxy-Connection: Keep-Alive\r\n\r\n'
        self.sendall(req.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            chunk = self.recv(4096)
            if not chunk: raise Exception('代理响应提前结束')
            buf += chunk
        head, _, _ = buf.partition(b'\r\n\r\n')
        first = head.split(b'\r\n',1)[0].decode('utf-8','ignore')
        if ' 200 ' not in first:
            raise Exception(f'代理 CONNECT 失败: {first}')
        return True

def login():
    s = ProxiedSock(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(20)
    s.proxied_connect(SSH_HOST, SSH_PORT, PROXY_HOST, PROXY_PORT)
    t = paramiko.Transport(s)
    t.connect(username=SSH_USER, password=SSH_PASS)
    return t.open_sftp_client(), t.open_session_channel().__class__.__mro__[0] and paramiko.SSHClient() or None

def main():
    # 建立连接
    s = ProxiedSock(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(25)
    s.proxied_connect(SSH_HOST, SSH_PORT, PROXY_HOST, PROXY_PORT)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, port=SSH_PORT, username=SSH_USER, password=SSH_PASS, sock=s, timeout=25, allow_agent=False, look_for_keys=False)
    print('=== L0 SSH 登录成功 ===')

    cmds = [
      ('L1a systemctl status shuxu-erp (50 行)', 'systemctl status shuxu-erp --no-pager -l -n 50 || true'),
      ('L1b journalctl -u shuxu-erp 最近 200 行', "journalctl -u shuxu-erp -n 200 --no-pager -o short-iso 2>/dev/null || echo 'no-journal'"),
      ('L1c 进程存活 & 端口 LISTEN', "ps -ef | grep -E 'node.*shuxu|node.*src/app|node .*erp' | grep -v grep; echo '---'; ss -ltnp | grep -E '8090|3306|80|443' || true; echo '---'; lsof -iTCP:8090 -sTCP:LISTEN -n -P 2>/dev/null || true"),
      ('L1d 直接打后端 127.0.0.1:8090 三个 API（绕过 Nginx）',
        "curl -sS -o /tmp/_be1 -w 'HTTP:%{http_code}\\nSIZE:%{size_download}\\nCT:%{content_type}\\n' --max-time 6 http://127.0.0.1:8090/api/auth/me ; echo '== body =='; head -c 400 /tmp/_be1; echo; echo '---'; curl -sS -o /tmp/_be2 -w 'HTTP:%{http_code}\\n' --max-time 6 http://127.0.0.1:8090/ ; head -c 300 /tmp/_be2; echo; echo '---'; curl -sS -o /tmp/_be3 -w 'HTTP:%{http_code}\\n' --max-time 6 http://127.0.0.1:8090/api/oauth/status ; head -c 400 /tmp/_be3"),
      ('L1e 找 Node 日志输出文件 (pm2 / nohup / systemd stdout)',
        "echo '-- pm2 ls --'; (pm2 jlist 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);print(json.dumps([{\"name\":x[\"name\"],\"pm_id\":x[\"pm_id\"],\"pm2_env\":{k:x[\"pm2_env\"].get(k) for k in (\"pm_exec_path\",\"pm_cwd\",\"out_file\",\"error_file\",\"log_file\")}} for x in d],indent=2,ensure_ascii=False))' 2>/dev/null || echo 'no-pm2'); echo '-- systemd stdout file --'; (systemctl show -p FragmentPath,StandardOutput,StandardError,SYSLOG_IDENTIFIER shuxu-erp 2>/dev/null || true); echo '-- 最近一小时 /var/log 下和 erp 相关文件 --'; find /var/log -maxdepth 3 -type f \\( -iname '*erp*' -o -iname '*shuxu*' -o -iname 'node*.log' \\) 2>/dev/null | head -20 ; echo '-- 工作目录 /opt/shuxu-erp/backend 里有没有本地日志 --'; ls -la /opt/shuxu-erp/backend/*.log /opt/shuxu-erp/backend/src/*.log 2>/dev/null | head"),
      ('L2a 读 Nginx 真实配置 shuxu-erp.conf（第一页，不要太大）',
        "cat /etc/nginx/conf.d/shuxu-erp.conf 2>/dev/null | head -120"),
      ('L2b Nginx access/error 最近 120 行（按时间）',
        "echo '-- error.log 最近 80 行 --'; tail -n 80 /var/log/nginx/error.log 2>/dev/null || echo 'no-error-log'; echo '-- access.log 最近 120 行 --'; tail -n 120 /var/log/nginx/access.log 2>/dev/null || echo 'no-access-log'"),
      ('L2c /app/ 路径下的静态资源清单 & & /app/ 里 index.html 里所有引用资源逐个 curl 检查 200/404',
        "echo '-- ls /opt/shuxu-erp/admin/ --'; ls -lah /opt/shuxu-erp/admin/ | head -50; echo '-- index.html 中提到的 src=|href=|url( 资源 --'; for r in $(grep -oE '(src|href)=[\"'\\''\"][^\"'\\''\"]+[\"'\\''\"]' /opt/shuxu-erp/admin/index.html 2>/dev/null | grep -oE '[\"'\\''\"][^\"'\\''\"]+[\"'\\''\"]' | tr -d \\\"' | grep -vE '^(#|data:|mailto:|https?:)' | sed 's#^/##g'); do echo \"--- resource: $r ---\"; curl -sS -o /tmp/_r -w \"HTTP:%{http_code} SIZE:%{size_download}  TYPE:%{content_type}\\n\" --max-time 6 -H 'Host: qianniu-erp.cc' \"http://127.0.0.1/$r\" 2>&1 ; head -c 80 /tmp/_r; echo; done"),
      ('L2d curl 本机 Nginx /app/#/shops（模拟你说的一进来就 shops 的场景），看 index 实际内容是否是我们新的 117036 字节版',
        "curl -sS -o /tmp/_app -w 'HTTP:%{http_code} SIZE:%{size_download}\\n' --max-time 8 -H 'Host: qianniu-erp.cc' 'https://127.0.0.1/app/' -k; echo '-- size on disk vs fetched --'; stat -c '%s %n' /opt/shuxu-erp/admin/index.html 2>/dev/null; ls -l /tmp/_app; echo '-- grep 新代码标记 (Newegg|校验并保存密钥|_ensureRootHash) --'; for k in Newegg 校验并保存密钥 _ensureRootHash afterAuth dashboard; do n=$(grep -c \"$k\" /tmp/_app 2>/dev/null); echo \"$k => $n\"; done"),
    ]
    for title, cmd in cmds:
        print(f'\\n========== {title} ==========')
        print('$', cmd[:200])
        try:
            stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30, get_pty=True)
            out = stdout.read().decode('utf-8','replace')
            err = stderr.read().decode('utf-8','replace')
            if out: print(out.rstrip()[:12000])
            if err: print('[STDERR]', err.rstrip()[:2000])
        except Exception as e:
            print('[EXEC ERROR]', traceback.format_exc()[:1200])
    ssh.close()

if __name__ == '__main__':
    main()
