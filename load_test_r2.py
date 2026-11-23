#!/usr/bin/env python3
"""Thalvior v7 压测 Round 2 — 阶跃 / 认证 / 写入 / 混合"""
import threading, time, requests, sys, statistics, concurrent.futures
from datetime import datetime

BASE = 'https://thalvior.icu'
SUPABASE_URL = f'{BASE}/rest/v1'
ANON_KEY = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

headers_anon = {
    'apikey': ANON_KEY,
    'Authorization': f'Bearer {ANON_KEY}',
    'Prefer': 'count=exact',
}

def pct(sorted_vals, p):
    if not sorted_vals: return 0
    idx = int(len(sorted_vals) * p / 100)
    return sorted_vals[min(idx, len(sorted_vals)-1)]

def run_test(name, url, threads, per_thread, headers=None, method='GET', body=None, expected_status=200, print_detail=True):
    total = threads * per_thread
    latencies = []
    statuses = {}
    errors = []
    lock = threading.Lock()
    
    session = requests.Session()
    if headers:
        for k, v in headers.items():
            session.headers[k] = v

    def worker():
        local_lat, local_status, local_errs = [], {}, []
        for _ in range(per_thread):
            try:
                t0 = time.perf_counter()
                resp = session.request(method, url, headers=headers, json=body, timeout=15, allow_redirects=True)
                dt = (time.perf_counter() - t0) * 1000
                local_lat.append(dt)
                local_status[resp.status_code] = local_status.get(resp.status_code, 0) + 1
                if resp.status_code != expected_status:
                    local_errs.append(f'{resp.status_code}')
            except Exception as e:
                local_errs.append(str(e)[:60])
                local_status[0] = local_status.get(0, 0) + 1
        with lock:
            latencies.extend(local_lat)
            for k, v in local_status.items():
                statuses[k] = statuses.get(k, 0) + v
            errors.extend(local_errs)
    
    for _ in range(3):  # warmup
        try: requests.request(method, url, headers=headers, json=body, timeout=10)
        except: pass
    
    t0 = time.perf_counter()
    th_list = [threading.Thread(target=worker, daemon=True) for _ in range(threads)]
    for t in th_list: t.start()
    for t in th_list: t.join()
    elapsed = time.perf_counter() - t0
    
    sorted_lat = sorted(latencies)
    success = sum(v for k, v in statuses.items() if 200 <= k < 400)
    done = sum(statuses.values())
    qps = done / elapsed if elapsed > 0 else 0
    
    result = {
        'name': name, 'threads': threads, 'total': done, 'elapsed': elapsed,
        'qps': qps, 'avg_ms': statistics.mean(sorted_lat) if sorted_lat else 0,
        'med_ms': statistics.median(sorted_lat) if sorted_lat else 0,
        'p90_ms': pct(sorted_lat, 90), 'p95_ms': pct(sorted_lat, 95),
        'p99_ms': pct(sorted_lat, 99), 'max_ms': max(sorted_lat) if sorted_lat else 0,
        'success_pct': success/done*100 if done else 0,
        'errors': errors[:5], 'statuses': dict(sorted(statuses.items()))
    }
    
    if print_detail:
        print(f'  ✅ {qps:7.1f} QPS | avg={result["avg_ms"]:6.1f} p99={result["p99_ms"]:7.1f} max={result["max_ms"]:7.1f} | {result["success_pct"]:5.1f}% ok | {result["errors"]}')
    return result

results = []

# ============================================================
# PART A: 阶跃加压 — 找拐点
# ============================================================
print(f'\n{"="*60}')
print('PART A: 阶跃加压 (Supabase GET tlv_outbound_orders)')
print(f'{"="*60}')

step_url = f'{SUPABASE_URL}/tlv_outbound_orders?select=id,order_no,status,total_charge&limit=20'
step_threads = [10, 20, 50, 80, 100]
per_step = 150  # 每线程 150 请求，100 并发 = 15000 请求

for th in step_threads:
    r = run_test(f'conc={th:3d}', step_url, th, per_step, headers=headers_anon)
    results.append(('step', r))
    # 拐点检测：如果成功率 < 95% 或 p99 > 5s 且 QPS 没增长，提前停
    if r['success_pct'] < 99 or (r['p99_ms'] > 5000 and r['qps'] < [x['qps'] for _, x in results[-3:-1]]):
        print(f'  ⚠️ 已到拐点，停止阶跃')
        break

# ============================================================
# PART B: 认证后 API — 先登录拿 token
# ============================================================
print(f'\n{"="*60}')
print('PART B: 认证后 API (merchant token)')
print(f'{"="*60}')

signin_url = f'{BASE}/auth/v1/token'
signin_data = {'email': 'merchant@thalvior.dev', 'password': 'Merchant1234!'}
try:
    resp = requests.post(f'{signin_url}?grant_type=password', json=signin_data,
                        headers={'apikey': ANON_KEY, 'Content-Type': 'application/json'}, timeout=15)
    if resp.status_code == 200:
        token = resp.json()['access_token']
        refresh = resp.json()['refresh_token']
        print(f'  ✅ 登录成功, token 长度 {len(token)}')
    else:
        print(f'  ❌ 登录失败: {resp.status_code} {resp.text[:200]}')
        token = None
except Exception as e:
    print(f'  ❌ 登录异常: {e}')
    token = None

if token:
    headers_auth = {
        'apikey': ANON_KEY,
        'Authorization': f'Bearer {token}',
        'Prefer': 'count=exact',
    }
    
    # B1: merchant 看自己的出库单（有 RLS 过滤）
    r = run_test('merchant→outbound_orders (auth+RLS)',
                f'{SUPABASE_URL}/tlv_outbound_orders?select=id,order_no,status,total_charge&order=created_at.desc&limit=50',
                20, 250, headers=headers_auth)
    results.append(('auth', r))
    
    # B2: merchant 看钱包（有 RLS）
    r = run_test('merchant→wallets (auth+RLS)',
                f'{SUPABASE_URL}/tlv_merchant_wallets?select=*&order=created_at.desc&limit=50',
                20, 250, headers=headers_auth)
    results.append(('auth', r))
    
    # B3: merchant 看库存
    r = run_test('merchant→inventory (auth+RLS)',
                f'{SUPABASE_URL}/tlv_merchant_inventory?select=*&limit=100',
                20, 250, headers=headers_auth)
    results.append(('auth', r))

# ============================================================
# PART C: 写入压力 — INSERT 出库单
# ============================================================
print(f'\n{"="*60}')
print('PART C: 写入压力 (INSERT tlv_outbound_orders)')
print(f'{"="*60}')

if token:
    # 先拿 merchant_id 和 warehouse_id
    try:
        mr = requests.get(f'{SUPABASE_URL}/tlv_merchants?select=id,warehouse_id&limit=1',
                         headers=headers_auth, timeout=10)
        if mr.status_code == 200 and mr.json():
            mid = mr.json()[0]['id']
            wid = mr.json()[0]['warehouse_id']
            print(f'  merchant_id={mid}, warehouse_id={wid}')
        else:
            mid, wid = None, None
            print(f'  ❌ 拿 merchant_id 失败')
    except Exception as e:
        print(f'  ❌ 异常: {e}')
        mid, wid = None, None
    
    if mid and wid:
        # 写压测：每线程生成独立 order_no，不冲突
        import random
        def make_order(thread_id, seq):
            ts = int(time.time() * 1000)
            return {
                'order_no': f'SO-LOADTEST-{thread_id}-{seq}-{ts}',
                'source': 'manual', 'platform': 'Test', 'status': 'pending',
                'merchant_id': mid, 'warehouse_id': wid, 'merchant_name': '测试商家',
                'receiver_name': f'Test{thread_id}-{seq}',
                'receiver_address': f'Address {seq} Street',
                'receiver_city': 'Shenzhen', 'receiver_country': 'CN',
                'total_charge': round(random.uniform(5, 50), 2),
            }
        
        # C1: 小写入量
        print('\n  C1: 10 并发 × 50 次 INSERT (串行写入压力)')
        r = run_test('INSERT outbound_orders (20×30=600)',
                    f'{SUPABASE_URL}/tlv_outbound_orders',
                    10, 50, headers=headers_auth, method='POST',
                    body=make_order(0, 0), expected_status=201)
        # 注意：上面只发了一个固定 body。真正的多 body 写入需要特殊处理
        # 改用单连接批量生成
        
        # C2: 真多 body 写入测试
        print('\n  C2: 真并发写入 (20×30=600 独立订单)')
        write_results = []
        write_lock = threading.Lock()
        
        def write_worker(tid, count):
            local_lat, local_stat, local_err = [], {}, []
            for i in range(count):
                try:
                    body = make_order(tid, i)
                    t0 = time.perf_counter()
                    resp = requests.post(f'{SUPABASE_URL}/tlv_outbound_orders',
                                        json=body, headers=headers_auth, timeout=10)
                    dt = (time.perf_counter() - t0) * 1000
                    local_lat.append(dt)
                    local_stat[resp.status_code] = local_stat.get(resp.status_code, 0) + 1
                    if resp.status_code != 201:
                        local_err.append(f'{resp.status_code}:{resp.text[:50]}')
                except Exception as e:
                    local_err.append(str(e)[:60])
                    local_stat[0] = local_stat.get(0, 0) + 1
            with write_lock:
                write_results.extend(local_lat)
                for k, v in local_stat.items():
                    write_status[k] = write_status.get(k, 0) + v
                write_errors.extend(local_err)
        
        write_status = {}
        write_errors = []
        wt0 = time.perf_counter()
        write_threads = [threading.Thread(target=write_worker, args=(i, 30)) for i in range(20)]
        for t in write_threads: t.start()
        for t in write_threads: t.join()
        write_elapsed = time.perf_counter() - wt0
        
        ws = sorted(write_results)
        done = sum(write_status.values())
        ok = sum(v for k, v in write_status.items() if k == 201)
        print(f'  📊 写入结果:')
        print(f'     总耗时: {write_elapsed:.2f}s | 完成: {done} | 成功(201): {ok}')
        print(f'     成功率: {ok/done*100:.1f}% | QPS(写): {done/write_elapsed:.1f}')
        if ws:
            print(f'     avg={statistics.mean(ws):.0f}ms med={statistics.median(ws):.0f}ms p99={pct(ws,99):.0f}ms max={max(ws):.0f}ms')
        print(f'     状态码: {dict(sorted(write_status.items()))}')
        if write_errors:
            print(f'     错误示例: {write_errors[:3]}')
        
        results.append(('write', {'name': 'INSERT outbound (20×30)', 'qps': done/write_elapsed,
                       'avg_ms': statistics.mean(ws) if ws else 0,
                       'p99_ms': pct(ws,99), 'success_pct': ok/done*100 if done else 0,
                       'threads': 20, 'total': done}))
        
        # 清理刚写入的测试数据
        print('\n  🧹 清理写入测试数据...')
        try:
            del_resp = requests.delete(
                f'{SUPABASE_URL}/tlv_outbound_orders',
                headers=headers_auth,
                params={'order_no': 'ilike.SO-LOADTEST-%'}
            )
            print(f'     DELETE → {del_resp.status_code}')
        except Exception as e:
            print(f'     清理异常: {e}')

# ============================================================
# PART D: 混合场景 — 80%读 + 20% SPA 页面
# ============================================================
print(f'\n{"="*60}')
print('PART D: 混合场景 (30 并发, 600 req)')
print(f'{"="*60}')

mix_urls = [
    ('get_api', f'{SUPABASE_URL}/tlv_merchants?select=*&limit=10', 0.5, headers_anon),
    ('get_api', f'{SUPABASE_URL}/tlv_outbound_orders?select=*&limit=20', 0.3, headers_anon),
    ('spa_page', f'{BASE}/merchant/login', 0.2, None),
]

mix_lat, mix_stat, mix_err = [], {}, []
mix_lock = threading.Lock()
mix_per = 20

def mix_worker(tid):
    local_lat, local_stat, local_err = [], {}, []
    for i in range(mix_per):
        # 随机选 URL (按权重)
        r = random.random()
        cum = 0
        selected = mix_urls[0]
        for item in mix_urls:
            cum += item[2]
            if r < cum:
                selected = item
                break
        
        _, url, _, hdr = selected
        try:
            t0 = time.perf_counter()
            resp = requests.get(url, headers=hdr, timeout=10, allow_redirects=True)
            dt = (time.perf_counter() - t0) * 1000
            local_lat.append(dt)
            local_stat[resp.status_code] = local_stat.get(resp.status_code, 0) + 1
            if resp.status_code not in (200, 302):
                local_err.append(f'{resp.status_code}')
        except Exception as e:
            local_err.append(str(e)[:60])
            local_stat[0] = local_stat.get(0, 0) + 1
    with mix_lock:
        mix_lat.extend(local_lat)
        for k, v in local_stat.items():
            mix_stat[k] = mix_stat.get(k, 0) + v
        mix_err.extend(local_err)

import random
mt0 = time.perf_counter()
mix_threads = [threading.Thread(target=mix_worker, args=(i,)) for i in range(30)]
for t in mix_threads: t.start()
for t in mix_threads: t.join()
mix_elapsed = time.perf_counter() - mt0

ms = sorted(mix_lat)
done = sum(mix_stat.values())
ok = sum(v for k, v in mix_stat.items() if 200 <= k < 400)
print(f'  📊 混合结果:')
print(f'     总耗时: {mix_elapsed:.2f}s | 完成: {done} | QPS: {done/mix_elapsed:.1f}')
print(f'     成功率: {ok/done*100:.1f}% | avg={statistics.mean(ms):.0f}ms p99={pct(ms,99):.0f}ms max={max(ms):.0f}ms')
print(f'     状态码: {dict(sorted(mix_stat.items()))}')

# ============================================================
# 最终汇总
# ============================================================
print(f'\n\n{"="*60}')
print(f'📋 Round 2 完整汇总 @ {datetime.now().strftime("%Y-%m-%d %H:%M")}')
print(f'{"="*60}')

# 按类别分组打印
categories = {'step': 'PART A 阶跃加压', 'auth': 'PART B 认证后 API',
             'write': 'PART C 写入压力', 'mix': 'PART D 混合场景'}

for cat_key, cat_label in categories.items():
    cat_results = [(k, r) for k, r in results if k == cat_key]
    if not cat_results: continue
    print(f'\n🏷️ {cat_label}')
    print(f'  {"测试项":<45} {"并发":>4} {"QPS":>8} {"avg":>7} {"p99":>7} {"成功率":>7}')
    print(f'  {"-"*82}')
    for _, r in cat_results:
        print(f'  {r["name"][:44]:<45} {r.get("threads",""):>4} {r["qps"]:>7.1f} {r["avg_ms"]:>6.1f}ms {r["p99_ms"]:>6.1f}ms {r["success_pct"]:>6.1f}%')

# 拐点分析
step_results = [(k, r) for k, r in results if k == 'step']
if step_results:
    print(f'\n📈 阶跃拐点分析:')
    for _, r in step_results:
        flag = ' ⚠️' if r['success_pct'] < 99 or r['p99_ms'] > 3000 else ' ✅'
        print(f'   并发 {r["threads"]:>3}: QPS={r["qps"]:7.1f} p99={r["p99_ms"]:6.0f}ms ok={r["success_pct"]:.1f}%{flag}')

print(f'\n📅 完成时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
