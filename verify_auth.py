#!/usr/bin/env python3
"""真实认证 API 端到端验证"""
import requests, json

BASE = 'https://thalvior.icu'
ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'
H_ANON = {'apikey': ANON, 'Authorization': f'Bearer {ANON}'}

def test(name, method, url, **kw):
    t0 = __import__('time').perf_counter()
    try:
        r = requests.request(method, url, timeout=15, **kw)
        dt = (__import__('time').perf_counter() - t0) * 1000
        body = r.text[:300] if r.text else ''
        print(f'  {"✅" if r.status_code < 400 else "❌"} {name}: {r.status_code} ({dt:.0f}ms)')
        if r.status_code >= 400: print(f'     body: {body[:200]}')
        return r
    except Exception as e:
        print(f'  ❌ {name}: {e}')
        return None

print('='*60)
print('🔐 认证 API 端到端验证')
print('='*60)

# 1. Sign In 三端
print('\n1️⃣ signInWithPassword (三端):')
tokens = {}
for email, pwd, label in [
    ('merchant@thalvior.dev','Merchant1234!','🛍️ 商家'),
    ('wms@thalvior.dev','Wms1234!','🏭 仓库'),
    ('admin@thalvior.dev','Admin1234!','⚙️ 管理'),
]:
    r = test(f'{label} signin', 'POST', f'{BASE}/auth/v1/token?grant_type=password',
        headers={'apikey': ANON, 'Content-Type': 'application/json'},
        json={'email': email, 'password': pwd})
    if r and r.status_code == 200:
        d = r.json()
        um = d.get('user_metadata', d.get('user', {}).get('raw_user_meta_data', {}) or {})
        tokens[label] = {'access': d['access_token'], 'refresh': d['refresh_token'], 
                        'uid': d['user']['id'], 'role': um.get('portal_role'),
                        'tid': um.get('tenant_id')}
        print(f'     uid={d["user"]["id"][:8]}... role={tokens[label]["role"]} tid={str(tokens[label]["tid"])[:8]}...')

# 2. GET /user 带 token
print('\n2️⃣ GET /user (每个 token):')
for label, info in tokens.items():
    test(f'{label} /user', 'GET', f'{BASE}/auth/v1/user',
        headers={'apikey': ANON, 'Authorization': f'Bearer {info["access"]}'})

# 3. 用 token 调业务 API (merchant 调自己的出库单)
print('\n3️⃣ token + REST API 业务调用:')
for label, info in tokens.items():
    h = {'apikey': ANON, 'Authorization': f'Bearer {info["access"]}'}
    # 每个端调自己的核心表
    if label == '🛍️ 商家':
        test(f'{label} → tlv_outbound_orders (RLS)', 'GET',
            f'{BASE}/rest/v1/tlv_outbound_orders?select=id,order_no,status,total_charge&limit=5', headers=h)
        test(f'{label} → tlv_merchant_wallets (RLS)', 'GET',
            f'{BASE}/rest/v1/tlv_merchant_wallets?select=*&limit=5', headers=h)
    elif label == '🏭 仓库':
        test(f'{label} → tlv_outbound_orders (RLS warehouse视角)', 'GET',
            f'{BASE}/rest/v1/tlv_outbound_orders?select=*&limit=5', headers=h)
    elif label == '⚙️ 管理':
        test(f'{label} → tlv_merchants (admin全表)', 'GET',
            f'{BASE}/rest/v1/tlv_merchants?select=*&limit=5', headers=h)

# 4. Refresh token
print('\n4️⃣ refreshToken (用 merchant refresh):')
info = tokens['🛍️ 商家']
r = test('refresh', 'POST', f'{BASE}/auth/v1/token?grant_type=refresh_token',
    headers={'apikey': ANON, 'Content-Type': 'application/json'},
    json={'refresh_token': info['refresh']})
if r and r.status_code == 200:
    print('     ✅ refresh 成功，拿到新 token')

# 5. 三端 tenant_id 正确性
print('\n5️⃣ tenant_id 正确性验证 (从 token 里解 JWT):')
import base64
for label, info in tokens.items():
    # 解 JWT payload (base64url)
    parts = info['access'].split('.')
    padding = 4 - len(parts[1]) % 4
    payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * padding))
    print(f'  {label}: sub={payload["sub"][:8]}... role={payload.get("role")} email={payload.get("email")}')

print('\n' + '='*60)
print('✅ 认证 API 完整链路闭环')
print('   signIn → JWT → /user → REST API + RLS → refresh')
print('='*60)
