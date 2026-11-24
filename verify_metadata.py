#!/usr/bin/env python3
"""验证前端拿 metadata 的方式 — /user endpoint + client-side"""
import requests, json, base64

BASE = 'https://thalvior.icu'
ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

def get_tokens(email, pwd):
    r = requests.post(f'{BASE}/auth/v1/token?grant_type=password',
        json={'email': email, 'password': pwd},
        headers={'apikey': ANON, 'Content-Type': 'application/json'})
    return r.json()['access_token'], r.json()['user']['id']

print('='*60)
print('📋 前端实际能拿到的 Auth 上下文')
print('='*60)

for email, pwd, label in [
    ('merchant@thalvior.dev','Merchant1234!','🛍️ 商家'),
    ('wms@thalvior.dev','Wms1234!','🏭 仓库'),
    ('admin@thalvior.dev','Admin1234!','⚙️ 管理'),
]:
    token, uid = get_tokens(email, pwd)
    h = {'apikey': ANON, 'Authorization': f'Bearer {token}'}
    
    # 前端用的 supabase.auth.getUser() 实际是 GET /auth/v1/user
    r = requests.get(f'{BASE}/auth/v1/user', headers=h)
    u = r.json()
    
    print(f'\n{label} — {email}')
    print(f'  ✅ uid:         {u["id"]}')
    print(f'  ✅ email:       {u["email"]}')
    print(f'  ✅ aud:         {u.get("aud")}')
    print(f'  ✅ role:        {u.get("role")}')
    print(f'  ✅ metadata:    {json.dumps(u.get("user_metadata"), indent=4, ensure_ascii=False)}')
    
    # 前端读 metadata 的方式：
    #   const { data } = await supabase.auth.getUser()
    #   const portalRole = data.user.user_metadata.portal_role  ✅ 有值！
    #   const tenantId   = data.user.user_metadata.tenant_id    ✅ 有值！

# 最后检查前端代码是不是这样读的
print('\n\n📋 前端代码检查 (getAuthContext):')
import subprocess
result = subprocess.run(['grep', '-n', 'portal_role\|tenant_id\|getUser\|getSession', 
    '/workspace/wms-app/src/lib/supabase.ts'], capture_output=True, text=True)
print(result.stdout or '(没找到匹配)')
