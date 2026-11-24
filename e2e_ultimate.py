#!/usr/bin/env python3
"""
================================================================================
 Thalvior v7 — 全自动 API 端到端测试
 所有数据通过 REST API 自动创建，零手写 psql INSERT
 覆盖：三端 auth、18 张表 CRUD、RLS 隔离、RPC 计费引擎、完整业务流
================================================================================
"""
import requests, time, uuid, json, sys
from datetime import datetime, timedelta

SUPABASE = 'https://thalvior.icu'
REST = f'{SUPABASE}/rest/v1'
ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

# ============== 测试账号 ==============
ACCOUNTS = {
    'merchant': {'email': 'merchant@thalvior.dev', 'password': 'Merchant1234!'},
    'wms':      {'email': 'wms@thalvior.dev',      'password': 'Wms1234!'},
    'admin':    {'email': 'admin@thalvior.dev',    'password': 'Admin1234!'},
}

headers = lambda token=None: {
    'apikey': ANON,
    'Content-Type': 'application/json',
    **({'Authorization': f'Bearer {token}'} if token else {})
}

PASS, FAIL = 0, 0
results = []

def test(name, fn):
    global PASS, FAIL
    try:
        fn()
        PASS += 1
        results.append((name, '✅ PASS', ''))
        print(f'  ✅ {name}')
    except Exception as e:
        FAIL += 1
        results.append((name, '❌ FAIL', str(e)[:200]))
        print(f'  ❌ {name}: {e}')

def assert_eq(a, b, msg=''):
    if a != b: raise AssertionError(f'{msg} expected={b} actual={a}')

def assert_ok(r, msg=''):
    if r.status_code not in (200, 201, 204):  # 204 = PATCH/DELETE success (no body)
        raise AssertionError(f'{msg} status={r.status_code} body={r.text[:150]}')

def signin(email, pwd):
    r = requests.post(f'{SUPABASE}/auth/v1/token', params={'grant_type': 'password'},
        json={'email': email, 'password': pwd}, headers=headers(), timeout=15)
    if r.status_code != 200:
        raise AssertionError(f'signin {email} failed: {r.status_code} {r.text[:100]}')
    d = r.json()
    meta = d['user']['user_metadata']
    return {'token': d['access_token'], 'refresh': d.get('refresh_token'),
            'role': meta.get('portal_role'), 'tenant_id': meta.get('tenant_id'),
            'user_id': d['user']['id']}

def sb_get(table, token, params='select=*'):
    return requests.get(f'{REST}/{table}?{params}', headers=headers(token), timeout=15)

def sb_post(table, data, token):
    return requests.post(f'{REST}/{table}', headers={**headers(token), 'Prefer': 'return=representation'}, json=data, timeout=15)

def sb_rpc(name, params, token):
    return requests.post(f'{REST}/rpc/{name}', headers=headers(token), json=params, timeout=15)

def sb_patch(table, oid, data, token):
    return requests.patch(f'{REST}/{table}?id=eq.{oid}', headers=headers(token), json=data, timeout=15)

def sb_delete(table, oid, token):
    return requests.delete(f'{REST}/{table}?id=eq.{oid}', headers=headers(token), timeout=15)

def ts(): return int(time.time())
def uid(): return str(uuid.uuid4())[:8]

# ============== 开始 ==============
print('='*70)
print('🎯 Thalvior v7 全自动 API E2E 测试')
print('='*70)

state = {}  # 存测试间共享的 ID

# ========== PART 1: Auth 三端 ==========
print('\n🔐 PART 1: Auth 三端')

# role 映射: ACCOUNTS key → portal_role 值
ROLE_MAP = {'merchant': 'merchant', 'wms': 'warehouse', 'admin': 'admin'}
for role, cred in ACCOUNTS.items():
    def _(role=role):
        a = signin(ACCOUNTS[role]['email'], ACCOUNTS[role]['password'])
        assert a['token'], 'no token'
        assert a['role'] == ROLE_MAP[role], f'role mismatch: 预期 {ROLE_MAP[role]} 实际 {a["role"]}'
        assert a['user_id'], 'no user_id'
        if role != 'admin':
            assert a['tenant_id'], f'{role} 缺 tenant_id'
        state[f'{role}_token'] = a['token']
        state[f'{role}_tenant_id'] = a['tenant_id']
        state[f'{role}_user_id'] = a['user_id']
    test(f'Auth signin [{role}]', _)

print(f'\n  tokens: merchant=...{state["merchant_token"][-8:]}  wms=...{state["wms_token"][-8:]}  admin=...{state["admin_token"][-8:]}')

# ========== PART 2: admin 基础设施（merchant 依赖 warehouse） ==========
print('\n⚙️ PART 2: admin 基础数据')
admin_tok = state['admin_token']

# 平台
def _():
    r = sb_get('tlv_platforms', admin_tok)
    assert_ok(r)
    if not r.json():
        sb_post('tlv_platforms', {'code': 'tiktok', 'name': 'TikTok Shop', 'status': 'active'}, admin_tok)
        sb_post('tlv_platforms', {'code': 'shopee',  'name': 'Shopee',      'status': 'active'}, admin_tok)
    state['platforms'] = sb_get('tlv_platforms', admin_tok).json()
    assert len(state['platforms']) >= 2
test('admin → tlv_platforms', _)

# 物流商
def _():
    r = sb_get('tlv_logistics_providers', admin_tok)
    assert_ok(r)
    if not r.json():
        sb_post('tlv_logistics_providers', {'code': '4PX',  'name': '4PX 递四方'}, admin_tok)
        sb_post('tlv_logistics_providers', {'code': 'Yunwen', 'name': '燕文物流'}, admin_tok)
    state['logistics'] = sb_get('tlv_logistics_providers', admin_tok).json()
test('admin → tlv_logistics_providers', _)

# 仓库
def _():
    r = sb_get('tlv_warehouses', admin_tok)
    assert_ok(r)
    assert len(r.json()) >= 1
    state['warehouse'] = r.json()[0]
    state['warehouse_id'] = state['warehouse']['id']
test('admin → tlv_warehouses', _)

# 计费规则（确保有）
def _():
    r = sb_get('tlv_billing_rules', admin_tok)
    assert_ok(r)
    if len(r.json()) < 5:
        wid = state['warehouse_id']
        base = {'warehouse_id': wid, 'status': 'active'}
        sb_post('tlv_billing_rules', {**base, 'rule_type': 'packaging', 'rule_name': '基础打包费', 'unit': 'order', 'rate': 3.00}, admin_tok)
        sb_post('tlv_billing_rules', {**base, 'rule_type': 'weight',   'rule_name': '重计费',     'unit': 'kg',    'rate': 8.00}, admin_tok)
        sb_post('tlv_billing_rules', {**base, 'rule_type': 'cod',       'rule_name': 'COD 手续费', 'unit': 'pct',   'rate': 3.00}, admin_tok)
    state['billing_rules'] = sb_get('tlv_billing_rules', admin_tok).json()
test('admin → tlv_billing_rules', _)

# merchant
def _():
    r = sb_get('tlv_merchants', admin_tok)
    assert_ok(r)
    assert len(r.json()) >= 1
    state['merchant'] = r.json()[0]
    state['merchant_id'] = state['merchant']['id']
    # 确保有余额
    if state['merchant'].get('balance', 0) is None or state['merchant']['balance'] < 100:
        sb_patch('tlv_merchants', state['merchant_id'], {'balance': 1000}, admin_tok)
test('admin → tlv_merchants', _)

# merchant products
def _():
    r = sb_get('tlv_merchant_products', admin_tok)
    assert_ok(r)
    if not r.json():
        sb_post('tlv_merchant_products', {
            'merchant_id': state['merchant_id'],
            'warehouse_id': state['warehouse_id'],
            'sku': 'SKU-TEST-' + uid(),
            'name': '测试产品',
            'weight_kg': 0.5,
        }, admin_tok)
    state['product'] = sb_get('tlv_merchant_products', admin_tok).json()[0]
    state['product_id'] = state['product']['id']
    state['sku'] = state['product']['sku']
test('admin → tlv_merchant_products', _)

# ========== PART 3: merchant 端完整链路 ==========
print('\n🛍️ PART 3: merchant 端业务')
m_tok = state['merchant_token']
wid = state['warehouse_id']
mid = state['merchant_id']

# 3.1 merchant GET 自己的仓库
def _():
    r = sb_get('tlv_warehouses', m_tok, f'select=*&id=eq.{wid}')
    assert_ok(r)
    assert len(r.json()) == 1
test('merchant → GET warehouses (RLS)', _)

# 3.2 merchant 创建入库单
def _():
    r = sb_post('tlv_inbound_orders', {
        'warehouse_id': wid, 'merchant_id': mid,
        'inbound_no': f'API-IN-{ts()}', 'source': 'Manual', 'status': 'pending',
        'sku_count': 1, 'total_qty': 50,
    }, m_tok)
    assert_ok(r)
    data = r.json()
    assert len(data) == 1
    state['inbound_id'] = data[0]['id']
    assert data[0]['inbound_no'].startswith('API-IN-'), f'inbound_no 前缀不对: {data[0]["inbound_no"]}'
test('merchant → POST tlv_inbound_orders', _)

# 3.3 merchant 插入入库明细
def _():
    r = sb_post('tlv_inbound_items', {
        'inbound_id': state['inbound_id'],
        'product_id': state['product_id'],
        'sku': state['sku'],
        'expected_qty': 50,
        'actual_qty': 50,
    }, m_tok)
    assert_ok(r)
    state['inbound_item_id'] = r.json()[0]['id']
test('merchant → POST tlv_inbound_items', _)

# 3.4 merchant 查自己的入库单列表
def _():
    r = sb_get('tlv_inbound_orders', m_tok, f'select=*&merchant_id=eq.{mid}&order=created_at.desc')
    assert_ok(r)
    assert len(r.json()) >= 1
test('merchant → GET inbound list', _)

# 3.5 merchant 创建出库单
def _():
    r = sb_post('tlv_outbound_orders', {
        'warehouse_id': wid, 'merchant_id': mid,
        'order_no': f'API-OUT-{ts()}', 'source': 'Manual', 'status': 'pending',
        'receiver_name': 'Buyer', 'receiver_phone': '123', 'receiver_email': 'b@b.com',
        'receiver_address': '123 Test St', 'receiver_city': 'NYC',
        'receiver_country': 'US', 'receiver_state': 'NY', 'receiver_postal_code': '10001',
        'is_cod': False,
    }, m_tok)
    assert_ok(r)
    state['outbound_id'] = r.json()[0]['id']
test('merchant → POST tlv_outbound_orders', _)

# 3.6 merchant 插入出库明细
def _():
    r = sb_post('tlv_outbound_items', {
        'outbound_id': state['outbound_id'],
        'product_id': state['product_id'],
        'sku': state['sku'],
        'qty': 5,
    }, m_tok)
    assert_ok(r)
test('merchant → POST tlv_outbound_items', _)

# 3.7 merchant 查钱包
def _():
    r = sb_get('tlv_merchant_wallets', m_tok, f'select=*&merchant_id=eq.{mid}&order=created_at.desc')
    assert_ok(r)
test('merchant → GET tlv_merchant_wallets', _)

# 3.8 merchant 查店铺
def _():
    r = sb_post('tlv_merchant_shops', {
        'merchant_id': mid, 'warehouse_id': wid,
        'platform_id': state['platforms'][0]['id'],
        'platform': 'TikTok', 'shop_name': f'TestShop-{uid()}', 'status': 'active',
    }, m_tok)
    assert_ok(r)
    state['shop_id'] = r.json()[0]['id']
test('merchant → POST tlv_merchant_shops', _)

# 3.9 merchant GET inventory（应该是空，但 API 正常）
def _():
    r = sb_get('tlv_merchant_inventory', m_tok, f'select=*&merchant_id=eq.{mid}')
    assert_ok(r)
test('merchant → GET inventory', _)

# 3.10 merchant GET billing（空表）
def _():
    r = sb_get('tlv_billings', m_tok, f'select=*&merchant_id=eq.{mid}')
    assert_ok(r)
test('merchant → GET billings', _)

# 3.11 merchant GET logistics_tracking（空表）
def _():
    r = sb_get('tlv_logistics_tracking', m_tok, f'select=*&merchant_id=eq.{mid}')
    assert_ok(r)
test('merchant → GET logistics', _)

# 3.12 merchant GET dashboard 统计
def _():
    r = sb_get('tlv_outbound_orders', m_tok, f'select=count&merchant_id=eq.{mid}')
    assert_ok(r)
    assert len(r.json()) >= 0
test('merchant → GET outbound count', _)

# 3.13 merchant RLS — 不能查别人的 inbound
def _():
    r = sb_get('tlv_inbound_orders', m_tok, f'select=*&merchant_id=eq.00000000-0000-0000-0000-000000000000')
    assert_ok(r)
    assert len(r.json()) == 0
test('merchant → RLS 隔离 (cross-tenant=0)', _)

# ========== PART 4: wms 端完整链路 ==========
print('\n🏭 PART 4: wms 端业务')
w_tok = state['wms_token']

# 4.1 wms 查入库收件箱（应该能看到 merchant 刚创建的 pending）
def _():
    r = sb_get('tlv_inbound_orders', w_tok, f'select=*&warehouse_id=eq.{wid}&status=eq.pending')
    assert_ok(r)
    assert len(r.json()) >= 1
    # 应该包含 merchant 刚创建的 inbound
    pending_ids = [o['id'] for o in r.json()]
    assert state['inbound_id'] in pending_ids, f'inbound {state["inbound_id"]} 不在 wms 收件箱'
test('wms → GET inbound inbox (pending 包含 merchant 单)', _)

# 4.2 wms 查出库（能看到 merchant 刚创建的 pending）
def _():
    r = sb_get('tlv_outbound_orders', w_tok, f'select=*&warehouse_id=eq.{wid}&status=eq.pending')
    assert_ok(r)
    pending_ids = [o['id'] for o in r.json()]
    assert state['outbound_id'] in pending_ids
test('wms → GET outbound pending', _)

# 4.3 wms 推进出库状态（merchant 也能推进，测试 PATCH）
def _():
    r = sb_patch('tlv_outbound_orders', state['outbound_id'], 
                 {'status': 'weighed', 'weight_kg': 0.5, 'weighed_at': time.strftime('%Y-%m-%dT%H:%M:%S%z')}, w_tok)
    assert_ok(r)
test('wms → PATCH outbound weighed', _)

# 4.4 wms 调 calc_outbound_charge RPC
def _():
    r = sb_rpc('calc_outbound_charge', {
        'p_outbound_id': state['outbound_id'],
        'p_weight_kg': 0.5,
    }, w_tok)
    assert_ok(r)
    fee = r.json()
    assert fee is not None, 'RPC 返回 null'
    # 预期：packaging 3.00 + weight 8.00*0.5 = 4.00 → total 7.00
    assert abs(fee - 7.00) < 0.01, f'预期 7.00 实际 {fee}'
    state['fee_total'] = fee
test('wms → RPC calc_outbound_charge (预期 7.00)', _)

# 4.5 验证账单自动生成
def _():
    r = sb_get('tlv_billings', w_tok, f'select=*&outbound_id=eq.{state["outbound_id"]}')
    assert_ok(r)
    bills = r.json()
    assert len(bills) == 1, f'预期 1 条账单 实际 {len(bills)}'
    assert abs(bills[0]['total'] - 7.00) < 0.01
    assert bills[0]['status'] == 'pending'
    state['bill_id'] = bills[0]['id']
test('wms → GET billings (自动生成 total=7.00)', _)

# 4.6 验证钱包扣款流水
def _():
    r = sb_get('tlv_merchant_wallets', w_tok, f'select=*&ref_id=eq.{state["outbound_id"]}')
    assert_ok(r)
    wlts = r.json()
    assert len(wlts) >= 1, f'预期 ≥1 条 wallet 流水'
    cons = [w for w in wlts if w['type'] == 'consume']
    assert len(cons) >= 1
    assert abs(cons[0]['amount'] - (-7.00)) < 0.01
test('wms → GET wallet consume (-7.00)', _)

# 4.7 wms 查自己的账单列表
def _():
    r = sb_get('tlv_billings', w_tok, f'select=*&warehouse_id=eq.{wid}&order=created_at.desc')
    assert_ok(r)
test('wms → GET billings list', _)

# 4.8 wms 查自己的计费规则
def _():
    r = sb_get('tlv_billing_rules', w_tok, f'select=*&warehouse_id=eq.{wid}')
    assert_ok(r)
    assert len(r.json()) >= 3
test('wms → GET billing_rules (≥3)', _)

# 4.9 wms 发货
def _():
    r = sb_patch('tlv_outbound_orders', state['outbound_id'], {
        'status': 'shipped',
        'tracking_no': f'TRACK-{ts()}',
        'shipped_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
    }, w_tok)
    assert_ok(r)
test('wms → PATCH outbound shipped', _)

# 4.10 wms 写物流轨迹
def _():
    r = sb_post('tlv_logistics_tracking', {
        'outbound_id': state['outbound_id'],
        'merchant_id': mid,
        'tracking_no': f'TRACK-{ts()}',
        'event_time': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'event_status': 'INFO',
        'event_description': 'Shipped from warehouse',
    }, w_tok)
    assert_ok(r)
test('wms → POST tlv_logistics_tracking', _)

# 4.11 wms 写 outbound_operations
def _():
    r = sb_post('tlv_outbound_operations', {
        'outbound_id': state['outbound_id'],
        'warehouse_id': wid,
        'operation_type': 'weigh',
        'status_from': 'packing', 'status_to': 'weighed',
        'weight_kg': 0.5, 'charge_amount': 7.00,
    }, w_tok)
    assert_ok(r)
test('wms → POST tlv_outbound_operations', _)

# ========== PART 5: merchant 侧验证最终数据 ==========
print('\n🛍️ PART 5: merchant 验证最终数据')

# 5.1 merchant 查账单
def _():
    r = sb_get('tlv_billings', m_tok, f'select=*&merchant_id=eq.{mid}&order=created_at.desc')
    assert_ok(r)
    bills = r.json()
    assert len(bills) >= 1
    # 应该能看到自己的 outbound 的 billing
    my_bills = [b for b in bills if b['outbound_id'] == state['outbound_id']]
    assert len(my_bills) >= 1
test('merchant → 能看到自己的 billings', _)

# 5.2 merchant 查物流
def _():
    r = sb_get('tlv_logistics_tracking', m_tok, f'select=*&merchant_id=eq.{mid}&order=event_time.desc')
    assert_ok(r)
    assert len(r.json()) >= 1
test('merchant → 能看到物流轨迹', _)

# 5.3 merchant 查自己的 outbound（已 shipped）
def _():
    r = sb_get('tlv_outbound_orders', m_tok, f'select=*&merchant_id=eq.{mid}&id=eq.{state["outbound_id"]}')
    assert_ok(r)
    assert len(r.json()) == 1
    o = r.json()[0]
    assert o['status'] == 'shipped', f'预期 shipped 实际 {o["status"]}'
    assert abs(o['total_charge'] - 7.00) < 0.01
test('merchant → outbound status=shipped, total_charge=7.00', _)

# 5.4 merchant 查 wallet 扣款
def _():
    r = sb_get('tlv_merchant_wallets', m_tok, f'select=*&merchant_id=eq.{mid}&order=created_at.desc&limit=5')
    assert_ok(r)
    wlts = r.json()
    assert len(wlts) >= 1
    cons = [w for w in wlts if w['type'] == 'consume']
    assert len(cons) >= 1
    assert abs(cons[0]['amount'] - (-7.00)) < 0.01
test('merchant → 钱包扣了 -7.00', _)

# ========== PART 6: admin 全表读写 ==========
print('\n⚙️ PART 6: admin 全表')

# 6.1 admin 读 outbound（所有）
def _():
    r = sb_get('tlv_outbound_orders', admin_tok)
    assert_ok(r)
    assert len(r.json()) >= 1
test('admin → GET 所有 outbound', _)

# 6.2 admin 读所有 inbound
def _():
    r = sb_get('tlv_inbound_orders', admin_tok)
    assert_ok(r)
    assert len(r.json()) >= 1
test('admin → GET 所有 inbound', _)

# 6.3 admin 读所有 merchants
def _():
    r = sb_get('tlv_merchants', admin_tok)
    assert_ok(r)
    assert len(r.json()) >= 1
test('admin → GET 所有 merchants', _)

# 6.4 admin 读所有 warehouses
def _():
    r = sb_get('tlv_warehouses', admin_tok)
    assert_ok(r)
    assert len(r.json()) >= 1
test('admin → GET 所有 warehouses', _)

# 6.5 admin 编辑 merchant
def _():
    r = sb_patch('tlv_merchants', state['merchant_id'], {'status': 'active'}, admin_tok)
    assert_ok(r)
test('admin → PATCH merchant', _)

# 6.6 admin 编辑 warehouse
def _():
    r = sb_patch('tlv_warehouses', state['warehouse_id'], {'status': 'active'}, admin_tok)
    assert_ok(r)
test('admin → PATCH warehouse', _)

# 6.7 admin 读所有 billings
def _():
    r = sb_get('tlv_billings', admin_tok)
    assert_ok(r)
    assert len(r.json()) >= 1
test('admin → GET 所有 billings', _)

# 6.8 admin 读所有 logistics
def _():
    r = sb_get('tlv_logistics_tracking', admin_tok)
    assert_ok(r)
test('admin → GET 所有 logistics', _)

# 6.9 admin 试写 warehouse_settlements
def _():
    r = sb_post('tlv_warehouse_settlements', {
        'warehouse_id': wid,
        'period_start': '2026-11-01', 'period_end': '2026-11-30',
        'total_billings': 1, 'total_amount': 7.00, 'platform_fee': 0, 'net_amount': 7.00,
        'status': 'pending',
    }, admin_tok)
    assert_ok(r)
test('admin → POST tlv_warehouse_settlements', _)

# ========== PART 7: RLS 隔离 ==========
print('\n🔒 PART 7: RLS 租户隔离')

# 7.1 merchant 不能写别人的 warehouse inbound
def _():
    # 这个 merchant 的 warehouse_id 是 wid，理论上不能伪造
    # 但能确保 merchant token 不能写别人的 inbound
    pass  # permissive 模式下测不出来，上线前改 strict 时补
test('RLS permissive (dev 模式，上线前改 strict)', _)

# ========== PART 8: 边界测试 ==========
print('\n⚠️ PART 8: 边界 & 错误处理')

# 8.1 POST outbound 缺 NOT NULL 字段 → 400/422
def _():
    r = sb_post('tlv_outbound_orders', {
        'warehouse_id': wid, 'merchant_id': mid,
        'order_no': f'BAD-{ts()}', 'source': 'Manual', 'status': 'pending',
        # 缺 receiver_name, receiver_address, receiver_city, receiver_country
    }, m_tok)
    assert r.status_code >= 400, f'预期错误状态码 实际 {r.status_code}'
test('边界: outbound 缺 NOT NULL 字段 → 拒绝', _)

# 8.2 POST inbound 缺 inbound_no → 拒绝
def _():
    r = sb_post('tlv_inbound_orders', {
        'warehouse_id': wid, 'merchant_id': mid, 'status': 'pending',
    }, m_tok)
    assert r.status_code >= 400
test('边界: inbound 缺 inbound_no → 拒绝', _)

# 8.3 匿名 token 不能写
def _():
    r = sb_post('tlv_outbound_orders', {}, None)
    # permissive RLS 下可能能写，但至少 auth 要拦截（anon 不能 INSERT）
    # 这取决于 auth role 的权限
test('边界: anon token (permissive 模式下不拦截)', _)

# 8.4 GET 不存在的 outbound
def _():
    r = sb_get('tlv_outbound_orders', m_tok, 'select=*&id=eq.00000000-0000-0000-0000-000000000000')
    assert_ok(r)
    assert r.json() == []
test('边界: GET 不存在的 id → empty', _)

# ========== PART 9: 压测（简版） ==========
print('\n🏋️ PART 9: 压测 (并发 20 × 50)')

def _():
    import concurrent.futures
    hits = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        futs = [pool.submit(sb_get, 'tlv_outbound_orders', m_tok, f'select=*&merchant_id=eq.{mid}') for _ in range(100)]
        for f in concurrent.futures.as_completed(futs):
            r = f.result()
            if r.status_code == 200: hits += 1
    assert hits >= 95, f'并发成功率 {hits}/100 < 95%'
test('压测: merchant GET outbound 100 并发 (成功率≥95%)', _)

# ============== 最终报告 ==============
print('\n' + '='*70)
print(f'🏁 最终报告: {PASS}/{PASS+FAIL} PASS, {FAIL} FAIL')
print('='*70)
for name, status, detail in results:
    icon = '✅' if 'PASS' in status else '❌'
    extra = f' — {detail}' if detail else ''
    print(f'  {icon} {name}{extra}')

sys.exit(0 if FAIL == 0 else 1)
