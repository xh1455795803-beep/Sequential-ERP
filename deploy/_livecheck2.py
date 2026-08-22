#!/usr/bin/env python3
# L2b: 精查 app.js require 链 & 服务器上所有路由文件的语法 (node --check) & 行数 & 末尾
import os, sys, re, socket
import paramiko

PROXY = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy') or 'http://127.0.0.1:18080'
m = re.match(r'https?://([^:]+):(\d+)', PROXY); PROXY_HOST, PROXY_PORT = m.group(1), int(m.group(2))
SSH_HOST, SSH_PORT = '120.55.6.75', 22
SSH_USER, SSH_PASS = 'admin', 'yuan340364'

class ProxiedSock(socket.socket):
    def proxied_connect(self, host, port, ph, pp):
        self.connect((ph, pp))
        req = f'CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\nProxy-Connection: Keep-Alive\r\n\r\n'
        self.sendall(req.encode()); buf = b''
        while b'\r\n\r\n' not in buf:
            c = self.recv(4096)
            if not c: raise Exception('代理提前结束')
            buf += c
        head = buf.partition(b'\r\n\r\n')[0].decode('utf-8','ignore')
        if ' 200 ' not in head.split('\r\n')[0]: raise Exception('CONNECT 失败:'+head.split('\r\n')[0])

def main():
    s = ProxiedSock(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(25); s.proxied_connect(SSH_HOST, SSH_PORT, PROXY_HOST, PROXY_PORT)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, port=SSH_PORT, username=SSH_USER, password=SSH_PASS, sock=s, timeout=25, allow_agent=False, look_for_keys=False)

    cmds = [
      ('服务器 backend 目录结构', 'ls -lah /opt/shuxu-erp/backend/src/ /opt/shuxu-erp/backend/src/routes/ /opt/shuxu-erp/backend/src/platforms/ 2>/dev/null | head -60'),
      ('app.js 开头 require 链(前 80 行)', 'head -n 80 /opt/shuxu-erp/backend/src/app.js'),
      ('真实 oauth.js 行数 & 前后 & 末尾',
        'wc -l /opt/shuxu-erp/backend/src/routes/oauth.js; echo "-- head 10 --"; head -n 10 /opt/shuxu-erp/backend/src/routes/oauth.js; echo "-- tail 40 --"; tail -n 40 /opt/shuxu-erp/backend/src/routes/oauth.js | nl -ba'),
      ('对 src 下所有 js 做 node --check 语法检查(列错误的)',
        "cd /opt/shuxu-erp/backend && find src -name '*.js' -type f | sort | while read f; do /opt/node20/bin/node --check \"$f\" >/tmp/_nc 2>&1; rc=$?; [ $rc -ne 0 ] && echo \"[FAIL rc=$rc] $f\"; cat /tmp/_nc | head -n 20; done"),
      ("require 加载测试：手动 require('./app') 看崩溃报错 (不启动端口)",
        """cd /opt/shuxu-erp/backend && timeout 10 /opt/node20/bin/node -e "try{require('./src/app.js')}catch(e){console.log('APP_REQUIRE_ERROR:');console.log(e.name+': '+e.message);console.log(e.stack)}" 2>&1 | head -n 80"""),
      ('app.listen 前的挂载顺序：搜 app.use('/api' + 打印 routes',
        "grep -nE \"app\\.use.*(auth|oauth|shops|inventory|audit|debug|v1|'/api'|require\\()\" /opt/shuxu-erp/backend/src/app.js | head -n 60"),
      ('如果 require 有 try/catch：是否吞掉了错误',
        "grep -nE \"try\\{.*require|catch\\(\" /opt/shuxu-erp/backend/src/app.js | head -n 30"),
      ('把后端所有路由文件都 cat 行数 & sha256，和仓库本地比对',
        "cd /opt/shuxu-erp/backend/src && find routes platforms middleware -maxdepth 2 -type f -name '*.js' | sort | xargs -I{} sh -c 'printf \"%s %s\\n\" \"$(sha256sum {} | cut -c1-12)\" \"$0\"' {} "),
      ('L2c v2：Nginx 静态资源 (admin 目录文件) + index.html 内嵌的外链资源 curl 200/404',
        "ls -lah /opt/shuxu-erp/admin/ ; echo '-- index 里外链 (src/href 非 #/data:) --'; grep -oE '(src|href)=[\"'\\''\"][^\"'\\''\"]+[\"'\\''\"]' /opt/shuxu-erp/admin/index.html | grep -vE '^src=\"#|^href=\"#|data:|mailto:|https?:' | sed -E \"s/^(src|href)=([\\\"\\\"])(.*)\\2$/\\3/g\" | sort -u | while read r; do r=${r#/}; [ -z \"$r\" ] && continue; echo \"=== $r ===\"; curl -sS -o /tmp/_x -w \"HTTP:%{http_code} SIZE:%{size_download} CT:%{content_type}\\n\" --max-time 5 -H 'Host: qianniu-erp.cc' -k \"https://127.0.0.1/$r\"; done"),
      ('立刻再打 8090 本地后端，确认全 404 状态未变',
        "for p in /api/auth/me /api/oauth/status /api/shops /api/v1/shops /api/v1/platforms /api/auth/login /stats/dashboard; do echo -n \"$p => \"; curl -sS -o /tmp/_y -w \"HTTP:%{http_code}\\n\" --max-time 3 \"http://127.0.0.1:8090$p\"; head -c 160 /tmp/_y; echo; done"),
    ]
    for t, cmd in cmds:
        print(f'\n========== {t} ==========')
        print('$', cmd[:200])
        try:
            stdin, stdout, stderr = ssh.exec_command(cmd, timeout=40, get_pty=True)
            out = stdout.read().decode('utf-8','replace').rstrip()[:16000]
            err = stderr.read().decode('utf-8','replace').rstrip()[:2500]
            if out: print(out)
            if err: print('\n[STDERR]\n'+err)
        except Exception as e:
            import traceback; print('[ERR]', traceback.format_exc()[:1200])
    ssh.close()

if __name__ == '__main__':
    main()
