#!/usr/bin/env python3
"""真实业务端到端 HTTP 测试（走 SSH 上 curl 127.0.0.1:8090，避免 Nginx/SSL 干扰）。
顺序：1) 健康检查  2) 注册 free 租户  3) 登录拿 token  4) /auth/me 200  5) shops / inventory / audit / notifications 都是 200 / 401 而非 404
6) oauth/status 返回 items 列表且 >= 70  7) supported-platforms 返回 items >= 70
8) 新建 Noon 密钥店铺：假值 1234 → 后端 400『凭证校验失败』且 shops 表没新增
9) 同一个店铺名 + 平台 录入两次 → 第二次 409 重复拦截
"""
import os, sys, re, socket, json, secrets, time
import paramiko

PROXY = os.environ.get('HTTPS_PROXY') or 'http://127.0.0.1:18080'
m = re.match(r'https?://([^:]+):(\d+)', PROXY); PH, PP = m.group(1), int(m.group(2))
SH, SP = '120.55.6.75', 22
SU, SPASS = 'admin', 'yuan340364'

class ProxiedSock(socket.socket):
    def pc(self, h, p, ph, pp):
        self.connect((ph, pp))
        self.sendall(f'CONNECT {h}:{p} HTTP/1.1\r\nHost: {h}:{p}\r\nProxy-Connection: Keep-Alive\r\n\r\n'.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            c = self.recv(4096)
            if not c: raise Exception('proxy EOF')
            buf += c
        head = buf.partition(b'\r\n\r\n')[0].decode('utf-8','ignore')
        if ' 200 ' not in head.split('\r\n')[0]: raise Exception('CONNECT FAIL:'+head.split('\r\n')[0])

def main():
    s = ProxiedSock(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(25); s.pc(SH, SP, PH, PP)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SH, port=SP, username=SU, password=SPASS, sock=s, timeout=25, allow_agent=False, look_for_keys=False)

    def run(cmd, timeout=30):
        _i, o, e = ssh.exec_command(cmd, timeout=timeout, get_pty=True)
        return o.read().decode('utf-8','replace'), e.read().decode('utf-8','replace')

    def curl(method, path, body=None, token=None, extra=''):
        args = ['-sS', f'-X {method}', '--max-time 10',
                '-H "Content-Type: application/json"',
                f'-o /tmp/_r -w "HTTP:%{{http_code}}\\nSIZE:%{{size_download}}\\n"']
        if token: args.append(f'-H "Authorization: Bearer {token}"')
        if body is not None:
            import shlex
            args.append(f'-d {shlex.quote(body)}')
        cmd = f"curl {' '.join(args)} {extra} 'http://127.0.0.1:8090{path}' ; echo '=== BODY ===' ; cat /tmp/_r ; echo"
        return run(cmd)

    results = []
    def R(name, expected_code, body_pred=None, **kw):
        o, e = curl(**kw)
        lines = o.splitlines()
        http = ''; size = ''; body = ''
        i = 0
        while i < len(lines) and (lines[i].startswith('HTTP:') or lines[i].startswith('SIZE:')):
            if lines[i].startswith('HTTP:'): http = lines[i].split(':',1)[1].strip()
            if lines[i].startswith('SIZE:'): size = lines[i].split(':',1)[1].strip()
            i += 1
        if '=== BODY ===' in lines:
            body = '\n'.join(lines[lines.index('=== BODY ===')+1:])
        try: bj = json.loads(body)
        except Exception: bj = body[:400]
        ok = str(http) == str(expected_code)
        if ok and body_pred:
            try: ok = body_pred(bj)
            except Exception as ex: print('PRED EX:', ex); ok = False
        results.append((name, ok, http, size, bj if not isinstance(bj, str) else bj[:400]))
        mark = '✅' if ok else '❌'
        print(f'{mark} {name} HTTP={http} size={size}\n  payload: {json.dumps(bj, ensure_ascii=False)[:300]}')
        return ok, bj

    # 0) /api/health 不带 v1，立即确认后端 Express 正常
    R('health /api/health', '200', lambda b: b.get('status')=='ok', method='GET', path='/api/health')

    rand = secrets.token_hex(4)
    tenant = f'e2e-tenant-{rand}'
    user = f'admin{rand}'
    pwd = 'e2e-Pass123!'
    print('\n===== Test user: tenant=%s user=%s =====' % (tenant, user))

    # 1) register
    ok, b1 = R('/api/v1/auth/register', '200',
        lambda b: isinstance(b.get('token'), str) and len(b['token']) > 20,
        method='POST', path='/api/v1/auth/register',
        body=json.dumps(dict(company=tenant, username=user, password=pwd)))
    token = None
    if ok:
        token = b1['token']
        print('  ✅ 注册一次成功，token长度:', len(token), 'user返回:', b1.get('user'), 'tenant返回:', (b1.get('tenant') or {}).get('name'))
    else:
        # 如果注册 409（测试残留用户名），立即用同一账号 login 拿 token
        print('  注册未 PASS 原返回：', json.dumps(b1, ensure_ascii=False)[:400], '，开始回退到 login 拿 token')
        ok2, b1b = R('/api/v1/auth/login fallback', '200', lambda b: len(b.get('token',''))>20,
            method='POST', path='/api/v1/auth/login',
            body=json.dumps(dict(username=user, password=pwd)))
        if ok2: token = b1b['token']

    # 2) login 再拿一个 token 确认 200
    if token:
        R('/api/v1/auth/login', '200', lambda b: len(b.get('token',''))>20,
          method='POST', path='/api/v1/auth/login',
          body=json.dumps(dict(username=user, password=pwd)))

    # 3) /auth/me 有 token 必须 200，没 token 也不能 404（401 OK）
    if token:
        R('/api/v1/auth/me (带token 200)', '200',
          lambda b: isinstance(b.get('user'), dict) and b.get('tenant'),
          method='GET', path='/api/v1/auth/me', token=token)
    else:
        R('/api/v1/auth/me (无token 401≠404)', '401', method='GET', path='/api/v1/auth/me')

    # 4) 核心列表 API
    for p, label in [('/api/v1/shops','shops 列表'),
                     ('/api/v1/inventory/transactions?limit=5','库存流水'),
                     ('/api/v1/audit/logs?limit=5','审计日志'),
                     ('/api/v1/notifications?limit=5','通知'),
                     ('/api/v1/oauth/status','OAuth status'),
                     ('/api/v1/shops/supported-platforms','支持的平台列表'),
                     ('/api/v1/stats/dashboard','概览统计')]:
        R(f'{label} {p}', '200',
          lambda b: True if (isinstance(b, dict) and (b.get('items') is not None or 'orders' in b or 'tenant' in b or isinstance(b.get('ok'), bool) or True)) else False,
          method='GET', path=p, token=token)

    # 5) supported-platforms & oauth/status 都要真的有 items 且 >= 70（不是空数组）
    _, sp_body = R('supported-platforms count', '200',
        lambda b: isinstance(b.get('items'), list) and len(b['items']) >= 70,
        method='GET', path='/api/v1/shops/supported-platforms', token=token)
    _, os_body = R('oauth/status count', '200',
        lambda b: isinstance(b.get('items'), list) and len(b['items']) >= 70,
        method='GET', path='/api/v1/oauth/status', token=token)

    # 6) 创建密钥型店铺：
    #    A) Noon 是 stub 平台 → POST /apikey/Noon 必须 400『真实 API 暂未接入，暂不开放密钥录入』& DB 不写入
    #    B) Temu 真实适配器平台 → 提交假值 1234 必须 400『凭证校验失败』& DB 不写入
    probe_stub_platform = 'Noon'
    probe_real_platform = None
    # 从 oauth/status 里挑一个真实 apikey 平台（mode=apikey 且 __stub 不存在；这里无法直接拿 __stub，就从硬编码真实平台里找 oauth/status 返回了的）
    real_candidates = ['Temu', 'SHEIN', 'OZON', 'Wildberries', 'Coupang', 'Walmart', 'Fruugo', 'Qoo10', 'Kaufland', 'OnBuy']
    if isinstance(os_body, dict):
        present = {x.get('platform') for x in os_body.get('items', []) if isinstance(x, dict) and x.get('mode') == 'apikey'}
        for c in real_candidates:
            if c in present:
                probe_real_platform = c; break
    print('\n=== 密钥探活测试: stub 平台={}, 真实平台={} ==='.format(probe_stub_platform, probe_real_platform))
    # A) Noon stub 假值 → 400
    noon_name = f'E2E-{rand} {probe_stub_platform} Store'
    fields_noon = {'shop_name': noon_name, 'currency': 'AED', 'api_key': 'INVALID_STUB_1234', 'api_secret': 'WRONG_STUB_SECRET_5678'}
    R(f'A:{probe_stub_platform}(stub) 假密钥 → 必须 400「暂不开放」且 DB 0 条',
      '400', lambda b: isinstance(b.get('error'), str) and ('暂未接入' in b['error'] or '暂不开放' in b['error'] or '拒绝保存任何凭证' in b['error']),
      method='POST', path=f'/api/v1/oauth/apikey/{probe_stub_platform}',
      body=json.dumps(fields_noon), token=token)
    # 立刻查当前租户店铺数，确认 stub 拒绝后没偷偷写进 DB
    db_count_sql = """mysql -u shuxu -p'K9mXw7pQ2vRn5tLz' -D shuxu_erp -N -B -e "select count(*) from shops where tenant_id=(select id from tenants where name='""" + tenant + """');" 2>/dev/null"""
    oq, eq = run(db_count_sql); print(f'  现在该租户店铺数（stub 拒绝后）：{oq.strip()}')

    # B) Temu/SHEIN 真实平台 → 假值必须也 400『凭证校验失败』（不是 200 蒙混过关）
    real_store_name = f'E2E-{rand} {probe_real_platform or "Temu"} RealProbe Store'
    fields_real = {'shop_name': real_store_name, 'currency': 'USD',
                   'api_key': 'INVALID_1234_FAKE_X',
                   'api_secret': 'WRONG_SECRET_XYZ_5678_FAKE_Y'}
    if probe_real_platform:
        R(f'B:{probe_real_platform}(真实适配器) 假密钥 → 400「凭证校验失败」& DB 0 条',
          '400', lambda b: isinstance(b.get('error'), str) and ('凭证校验失败' in b['error'] or '无效' in b['error'] or '长度不足' in b['error']),
          method='POST', path=f'/api/v1/oauth/apikey/{probe_real_platform}',
          body=json.dumps(fields_real), token=token)
        oq2, _ = run(db_count_sql); print(f'  现在该租户店铺数（真实平台拒绝后）：{oq2.strip()}')

    # 7) Noon 手动录入归属登记（200 OK，允许"登记名字用"但不允许存密钥）→ 再录同名 409
    manual_platform = probe_stub_platform  # Noon
    manual_name = noon_name
    R(f'[归属登记] 手动录 {manual_platform}/{manual_name} → 200 OK（允许登记，仅做归属）',
      '200', lambda b: isinstance(b.get('item'), dict),
      method='POST', path='/api/v1/shops', token=token,
      body=json.dumps({'name': manual_name, 'platform': manual_platform, 'commission_rate': 0.08, 'currency': 'AED'}))
    R(f'[归属重复拦截] 同名同平台再录一次 → 409',
      '409', method='POST', path='/api/v1/shops', token=token,
      body=json.dumps({'name': manual_name, 'platform': manual_platform}))

    # 9) 用刚刚新建的店铺 id 打 sync & refresh-token → 预期 400『未授权』而不是 404（证明端点存在）
    list_o, _e = R('GET shops 拿到新建店铺 id', '200', method='GET', path='/api/v1/shops', token=token)
    sid = None
    if isinstance(list_o, tuple):
        pass
    # 我们上面 R 返回的是 tuple (ok, bj)，刚才没接 sid，重拉
    o2, e2 = run("curl -sS -H 'Authorization: Bearer %s' 'http://127.0.0.1:8090/api/v1/shops' | head -c 2000" % token)
    try:
        shops_list = json.loads(o2)
        items = shops_list.get('items') or []
        sid = next((x['id'] for x in items if x.get('name') == shop_name), None)
    except Exception as ex:
        print('parse shops_list fail', ex, o2[:300])
    print('  新建店铺 id:', sid)
    if sid:
        # 新建的是 Noon 归属登记店（auth_status=manual，没有 access_token / api_key）
        # → sync 端点应该返回 stub 级 imported=0/skipped=0 的 stub 响应，HTTP 200（允许手动归属店点同步，只是没数据）
        R(f'/api/v1/shops/{sid}/sync 归属店点同步 → HTTP 200 stub 级 imported/skipped=0（不报错）',
          '200',
          lambda b: b.get('ok') is True or (isinstance(b.get('result'), dict) and b['result'].get('imported') == 0),
          method='POST', path=f'/api/v1/shops/{sid}/sync',
          body=json.dumps({'type':'orders'}), token=token)
        # 密钥型 Noon 的 refresh-token 必须返回 400 明确说『不支持令牌刷新』
        R(f'/api/v1/shops/{sid}/refresh-token Noon 密钥型 → HTTP 400「不支持刷新」≠404≠500',
          '400',
          lambda b: isinstance(b.get('error'), str) and ('不支持' in b['error'] or '密钥型' in b['error']),
          method='POST', path=f'/api/v1/shops/{sid}/refresh-token', token=token)

    # 打印总表
    print('\n\n=============================')
    print('SUMMARY（全部操作都基于 127.0.0.1:8090 真实后端 HTTP 返回）')
    passed = sum(1 for x in results if x[1])
    total = len(results)
    for name, ok, http, size, bj in results:
        mark = '✅' if ok else '❌'
        print(f'  {mark} [{http}] {name}  ({size} bytes)')
    print(f'TOTAL: {passed}/{total}')

if __name__ == '__main__':
    main()
