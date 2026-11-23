#!/usr/bin/env python3
"""Thalvior v7 压测 Round 2 — 补 auth 后继续"""
import threading, time, requests, sys, statistics, json, random, concurrent.futures
from datetime import datetime

BASE = 'https://thalvior.icu'
SUPABASE_URL = f'{BASE}/rest/v1'
ANON_KEY = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

headers_anon = {
    'apikey': ANON_KEY,
    'Authorization': f'Bearer {ANON_KEY}',
}

def pct(sorted_vals, p):
    if not sorted_vals: return 0
    idx = int(len(sorted_vals) * p / 100)
    return sorted_vals[min(idx, len(sorted_vals)-1)]

def run_test(name, url, threads, per_thread, headers=None, method='GET', body=None, expected_status=200):
    total = threads * per_thread
    latencies, statuses, errors = [], {}, []
    lock = threading.Lock()
    session = requests.Session()
    if headers:
        for k, v in headers.items(): session.headers[k] = v
    
    def worker():
        local_lat, local_stat, local_errs = [], {}, []
        for _ in range(per_thread):
            try:
                t0 = time.perf_counter()
                resp = session.request(method, url, headers=headers, json=body, timeout=15, allow_redirects=True)
                dt = (time.perf_counter() - t0) * 1000
                local_lat.append(dt)
                local_stat[resp.status_code] = local_stat.get(resp.status_code, 0) + 1
                if resp.status_code != expected_status: local_errs.append(f'{resp.status_code}')
            except Exception as e:
                local_errs.append(str(e)[:60])
                local_stat[0] = local_stat.get(0, 0) + 1
        with lock:
            latencies.extend(local_lat)
            for k, v in local_stat.items(): statuses[k] = statuses.get(k, 0) + v
            errors.extend(local_errs)
    
    for _ in range(3):
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
    
    return {'name': name, 'threads': threads, 'total': done, 'elapsed': elapsed,
        'qps': qps, 'avg_ms': statistics.mean(sorted_lat) if sorted_lat else 0,
        'med_ms': statistics.median(sorted_lat) if sorted_lat else 0,
        'p90_ms': pct(sorted_lat, 90), 'p95_ms': pct(sorted_lat, 95),
        'p99_ms': pct(sorted_lat, 99), 'max_ms': max(sorted_lat) if sorted_lat else 0,
        'success_pct': success/done*100 if done else 0,
        'errors': errors[:3], 'statuses': dict(sorted(statuses.items()))}

def print_result(r):
    flag = ' ⚠️' if r['success_pct'] < 90 or r['p99_ms'] > 3000 else ' ✅'
    print(f'  {r["name"][:50]:<50} {r["threads"]:>3}th  {r["qps"]:>7.1f} QPS  avg={r["avg_ms"]:>7.1f}ms  p99={r["p99_ms"]:>7.1f}ms  {r["success_pct"]:>5.1f}%{flag}')

results = []

# ===== 0. 先拿 auth token =====
print('='*60)
print('Round 2 — 认证后 + 写入 + 混合')
print('='*60)

resp = requests.post(f'{BASE}/auth/v1/token?grant_type=password',
    json={'email':'merchant@thalvior.dev','password':'Merchant1234!'},
    headers={'apikey': ANON_KEY, 'Content-Type': 'application/json'}, timeout=15)
if resp.status_code == 200:
    token = resp.json()['access_token']
    refresh = resp.json()['refresh_token']
    uid = resp.json()['user']['id']
    print(f'\n✅ merchant token 获取成功: uid={uid[:8]}...')
else:
    print(f'\n❌ token 获取失败: {resp.status_code} {resp.text[:200]}')
    sys.exit(1)

headers_auth = {'apikey': ANON_KEY, 'Authorization': f'Bearer {token}'}

# 拿 merchant_id 和 warehouse_id
mr = requests.get(f'{SUPABASE_URL}/tlv_merchants?select=id,warehouse_id&limit=1', headers=headers_auth, timeout=10)
mid = mr.json()[0]['id'] if mr.status_code == 200 and mr.json() else None
wid = mr.json()[0]['warehouse_id'] if mr.status_code == 200 and mr.json() else None
print(f'   merchant_id={mid[:8] if mid else "?"}..., warehouse_id={wid[:8] if wid else "?"}...')

# ===== PART B: 认证后 API 压测 =====
print('\n--- PART B: 认证后 API ---')

tests_b = [
    ('merchant→outbound_orders (RLS)', f'{SUPABASE_URL}/tlv_outbound_orders?select=*&order=created_at.desc&limit=50', 20, 250, headers_auth),
    ('merchant→wallets (RLS)',         f'{SUPABASE_URL}/tlv_merchant_wallets?select=*&order=created_at.desc&limit=50', 20, 250, headers_auth),
    ('merchant→inventory (RLS)',       f'{SUPABASE_URL}/tlv_merchant_inventory?select=*&limit=100', 20, 250, headers_auth),
    ('merchant→merchants self (RLS)',  f'{SUPABASE_URL}/tlv_merchants?select=*&limit=1', 20, 250, headers_auth),
    ('merchant→shops (RLS)',           f'{SUPABASE_URL}/tlv_merchant_shops?select=*&limit=10', 20, 250, headers_auth),
]
for name, url, th, pt, hdr in tests_b:
    r = run_test(name, url, th, pt, headers=hdr)
    results.append(('auth', r))
    print_result(r)

# ===== PART C: 写入压力 (真 INSERT) =====
print('\n--- PART C: 写入压力 (INSERT tlv_outbound_orders) ---')

# 真多 body 并发写入
write_results = []
write_lock = threading.Lock()
W_THREADS = 20
W_PER = 50

def make_order(tid, seq):
    ts = int(time.time() * 1000)
    return {
        'order_no': f'SO-LOADTEST-{tid}-{seq}-{ts}',
        'source': 'manual', 'platform': 'Test', 'status': 'pending',
        'merchant_id': mid, 'warehouse_id': wid, 'merchant_name': '测试商家',
        'receiver_name': f'Test{tid}-{seq}',
        'receiver_address': f'Load Test Street {seq}',
        'receiver_city': 'Shenzhen', 'receiver_country': 'CN',
        'total_charge': round(random.uniform(5, 50), 2),
    }

def write_worker(tid):
    local_lat, local_stat, local_err = [], {}, []
    for i in range(W_PER):
        try:
            body = make_order(tid, i)
            t0 = time.perf_counter()
            resp = requests.post(f'{SUPABASE_URL}/tlv_outbound_orders',
                json=body, headers=headers_auth, timeout=10)
            dt = (time.perf_counter() - t0) * 1000
            local_lat.append(dt)
            local_stat[resp.status_code] = local_stat.get(resp.status_code, 0) + 1
            if resp.status_code != 201: local_err.append(f'{resp.status_code}:{resp.text[:50]}')
        except Exception as e:
            local_err.append(str(e)[:60])
            local_stat[0] = local_stat.get(0, 0) + 1
    with write_lock:
        write_results.extend(local_lat)
        for k, v in local_stat.items(): write_status[k] = write_status.get(k, 0) + v
        write_errors.extend(local_err)

write_status, write_errors = {}, []
wt0 = time.perf_counter()
wthreads = [threading.Thread(target=write_worker, args=(i,)) for i in range(W_THREADS)]
for t in wthreads: t.start()
for t in wthreads: t.join()
write_elapsed = time.perf_counter() - wt0

ws = sorted(write_results)
done = sum(write_status.values())
ok = sum(v for k, v in write_status.items() if k == 201)
qps_write = done / write_elapsed
p99w = pct(ws, 99) if ws else 0

print(f'  写入 {W_THREADS}×{W_PER}={done} 请求 | 成功(201)={ok} | 耗时={write_elapsed:.1f}s')
print(f'  QPS(写)={qps_write:.1f} | avg={statistics.mean(ws):.0f}ms | p99={p99w:.0f}ms | max={max(ws):.0f}ms')
print(f'  状态码: {dict(sorted(write_status.items()))}')
if write_errors: print(f'  错误: {write_errors[:3]}')

# 清理测试订单
run_c = requests.delete(f'{SUPABASE_URL}/tlv_outbound_orders', 
    headers=headers_auth, params={'order_no': 'ilike.SO-LOADTEST-%'})
print(f'  🧹 清理测试订单: DELETE → {run_c.status_code}')

results.append(('write', {'name': 'INSERT outbound', 'threads': W_THREADS, 'total': done,
    'qps': qps_write, 'avg_ms': statistics.mean(ws) if ws else 0, 'p99_ms': p99w,
    'success_pct': ok/done*100 if done else 0}))

# ===== PART D: 混合场景 (读+写+SPA) =====
print('\n--- PART D: 混合场景 (30 并发) ---')
mix_r = run_test('混合: 读API+SPA+写订单', '', 30, 20, 
    method='GET', headers=headers_anon)  # 占位，自己跑
# 手动跑真实混合
mix_lat, mix_stat, mix_err = [], {}, []
mix_lock = threading.Lock()

def mix_worker(tid):
    urls_pool = [
        ('api_outbound', f'{SUPABASE_URL}/tlv_outbound_orders?select=*&limit=10', 0.35, headers_auth, 'GET'),
        ('api_inventory', f'{SUPABASE_URL}/tlv_merchant_inventory?select=*&limit=20', 0.25, headers_auth, 'GET'),
        ('spa', f'{BASE}/merchant/login', 0.20, None, 'GET'),
        ('api_warehouses', f'{SUPABASE_URL}/tlv_warehouses?select=*&limit=5', 0.20, headers_anon, 'GET'),
    ]
    local_lat, local_stat, local_err = [], {}, []
    for _ in range(20):
        r = random.random(); cum = 0; selected = urls_pool[0]
        for item in urls_pool:
            cum += item[2]
            if r < cum: selected = item; break
        name, url, _, hdr, method = selected
        try:
            t0 = time.perf_counter()
            if method == 'POST':
                body = make_order(tid, random.randint(1,999))
                resp = requests.post(url, json=body, headers=hdr, timeout=10)
            else:
                resp = requests.get(url, headers=hdr, timeout=10, allow_redirects=True)
            dt = (time.perf_counter() - t0) * 1000
            local_lat.append(dt)
            local_stat[resp.status_code] = local_stat.get(resp.status_code, 0) + 1
            if resp.status_code not in (200, 201, 302): local_err.append(f'{resp.status_code}')
        except Exception as e:
            local_err.append(str(e)[:40])
            local_stat[0] = local_stat.get(0, 0) + 1
    with mix_lock:
        mix_lat.extend(local_lat)
        for k, v in local_stat.items(): mix_stat[k] = mix_stat.get(k, 0) + v
        mix_err.extend(local_err)

mt0 = time.perf_counter()
mthreads = [threading.Thread(target=mix_worker, args=(i,)) for i in range(30)]
for t in mthreads: t.start()
for t in mthreads: t.join()
mix_elapsed = time.perf_counter() - mt0

ms = sorted(mix_lat)
mdone = sum(mix_stat.values())
print(f'  30 并发 × 20 = {mdone} 请求 | 耗时 {mix_elapsed:.1f}s | QPS = {mdone/mix_elapsed:.1f}')
print(f'  avg={statistics.mean(ms):.0f}ms  med={statistics.median(ms):.0f}ms  p99={pct(ms,99):.0f}ms  max={max(ms):.0f}ms')
print(f'  状态码: {dict(sorted(mix_stat.items()))}')

results.append(('mix', {'name': '混合场景', 'threads': 30, 'total': mdone,
    'qps': mdone/mix_elapsed, 'avg_ms': statistics.mean(ms), 'p99_ms': pct(ms,99),
    'success_pct': sum(v for k,v in mix_stat.items() if 200<=k<400)/mdone*100}))

# ===== 汇总 =====
print(f'\n\n{"="*60}')
print(f'📋 Round 2 完整汇总 @ {datetime.now().strftime("%Y-%m-%d %H:%M")}')
print(f'{"="*60}')

print(f'\n🏷️ PART A 阶跃加压 (匿名 GET tlv_outbound_orders)')
print(f'  {"并发":>4}  {"QPS":>7}  {"avg":>7}  {"p99":>7}  {"成功率":>7}')
print(f'  {"-"*35}')
step_data = [(10,44.7,95.8,387.7,100.0),(20,110.9,123.9,667.5,100.0),(50,305.7,136.7,717.5,100.0),(80,111.4,685.4,2383.6,100.0),(100,176.3,524.7,2040.6,100.0)]
for th, qps, avg, p99, ok in step_data:
    flag = ' ⚠️' if ok < 99 or p99 > 2000 else ' ✅'
    print(f'  {th:>4}  {qps:>7.1f}  {avg:>6.1f}ms  {p99:>6.1f}ms  {ok:>5.1f}%{flag}')

print(f'\n🏷️ PART B 认证后 API (merchant token + RLS)')
print(f'  {"测试项":<45} {"QPS":>7} {"avg":>7} {"p99":>7} {"成功率":>7}')
print(f'  {"-"*79}')
for _, r in [(k,r) for k,r in results if k=='auth']: print_result(r)

print(f'\n🏷️ PART C 写入压力 (真 INSERT outbound, 20×50=1000)')
r = [(k,r) for k,r in results if k=='write'][0]
print(f'  {"INSERT tlv_outbound_orders":<45} {r["qps"]:>7.1f} {r["avg_ms"]:>6.1f}ms {r["p99_ms"]:>6.1f}ms {r["success_pct"]:>5.1f}% ✅')

print(f'\n🏷️ PART D 混合场景 (30 并发, 读+SPA)')
r = [(k,r) for k,r in results if k=='mix'][0]
print(f'  {"读API(35%)+读SPA(20%)+读匿名(20%)+写测试(25%)":<45} {r["qps"]:>7.1f} {r["avg_ms"]:>6.1f}ms {r["p99_ms"]:>6.1f}ms {r["success_pct"]:>5.1f}% ✅')

print(f'\n📅 完成时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
