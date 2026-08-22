#!/usr/bin/env python3
"""精准复现 Noon apikey 探活 500：用刚刚的真实账号 admin2516683d / e2e-tenant-2516683d 登录拿 token，POST /api/v1/oauth/apikey/noon 提交假值，
然后 journalctl --since '2 minutes ago' 看 Node 打出的完整 stack trace（因为 500 统一处理走 console.error）。
"""
import os, sys, re, socket, json
import paramiko

PROXY = os.environ.get('HTTPS_PROXY') or 'http://127.0.0.1:18080'
m = re.match(r'https?://([^:]+):(\d+)', PROXY); PH, PP = m.group(1), int(m.group(2))
SH, SP = '120.55.6.75', 22
SU, SPASS = 'admin', 'yuan340364'

class ProxiedSock(socket.socket):
    def pc(self, h, p, ph, pp):
        self.connect((ph, pp)); self.sendall(f'CONNECT {h}:{p} HTTP/1.1\r\nHost: {h}:{p}\r\nProxy-Connection: Keep-Alive\r\n\r\n'.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            c = self.recv(4096)
            if not c: raise Exception('EOF proxy')
            buf += c
        head = buf.partition(b'\r\n\r\n')[0].decode('utf-8','ignore')
        if ' 200 ' not in head.split('\r\n')[0]: raise Exception('CONNECT FAIL:'+head.split('\r\n')[0])

def main():
    s = ProxiedSock(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(25); s.pc(SH, SP, PH, PP)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SH, port=SP, username=SU, password=SPASS, sock=s, timeout=25, allow_agent=False, look_for_keys=False)
    def run(cmd):
        _i, o, e = ssh.exec_command(cmd, timeout=40, get_pty=True)
        return o.read().decode('utf-8','replace'), e.read().decode('utf-8','replace')

    # 1) 登录拿 token
    login_body = json.dumps({'username':'admin2516683d','password':'e2e-Pass123!'})
    o1, e1 = run(f"""curl -sS -X POST -H 'Content-Type: application/json' -d {json.dumps(login_body)} 'http://127.0.0.1:8090/api/v1/auth/login'""")
    print('--- login resp ---'); print(o1[:500]); print(e1[:300])
    try:
        token = json.loads(o1)['token']
    except Exception as ex:
        print('login parse fail:', ex); sys.exit(1)

    # 2) 提交 Noon apikey 假值（注意 URL 大小写，我们平台名是 'Noon'）
    fake = json.dumps({'shop_name':'E2E-Noon-Repro Store','currency':'AED','api_key':'INVALID_1234_FAKE','api_secret':'WRONG_SECRET_XYZ_5678'})
    o2, e2 = run(f"""curl -sS -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer {token}' -d {json.dumps(fake)} 'http://127.0.0.1:8090/api/v1/oauth/apikey/Noon'""")
    print('\n--- POST /api/v1/oauth/apikey/Noon 假值 response ---'); print(o2[:1000]); print(e2[:400])

    # 3) 同步立即 journalctl 抓最近 2 分钟的 shuxu-erp 报错
    o3, e3 = run("journalctl -u shuxu-erp --since '2 minutes ago' --no-pager -o cat 2>&1 | tail -n 120")
    print('\n--- journalctl 最近 2 分钟 shuxu-erp stack trace ---')
    print(o3)
    if e3.strip(): print('[STDERR journalctl]', e3[:1200])

    # 4) 顺便把 Noon 所在 KEY_PLATFORMS 以及 apikey 路由里需要的字段打印
    o4, _ = run("cd /opt/shuxu-erp/backend && /opt/node20/bin/node -e \"const o=require('./src/routes/oauth.js');console.log(JSON.stringify({HasNoon: !!o.KEY_PLATFORMS && !!o.KEY_PLATFORMS.Noon, NoonFields: o.KEY_PLATFORMS && o.KEY_PLATFORMS.Noon && o.KEY_PLATFORMS.Noon.fields}, null, 2))\" 2>&1 | head -n 60")
    print('\n--- 远端 oauth.js module.exports 里有没有暴露 KEY_PLATFORMS / Noon.fields ---'); print(o4[:1500])
    o5, _ = run("grep -nE 'module.exports' /opt/shuxu-erp/backend/src/routes/oauth.js ; echo '---'; grep -cE 'probeCredentials|checkSyncable|adapter.probe|lookup' /opt/shuxu-erp/backend/src/routes/oauth.js")
    print(o5[:800])
    ssh.close()

if __name__ == '__main__':
    main()
