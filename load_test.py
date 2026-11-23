#!/usr/bin/env python3
"""Thalvior v7 抗压测试 — 真实数据"""
import threading, time, requests, sys, statistics, concurrent.futures
from datetime import datetime

BASE = 'https://thalvior.icu'
THREADS = 20
REQUESTS_PER_THREAD = 250
TOTAL = THREADS * REQUESTS_PER_THREAD  # 5000 requests per test

SUPABASE_URL = 'https://thalvior.icu/rest/v1'
SUPABASE_KEY = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

headers_rest = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Prefer': 'count=exact',
}

def pct(sorted_vals, p):
    if not sorted_vals: return 0
    idx = int(len(sorted_vals) * p / 100)
    return sorted_vals[min(idx, len(sorted_vals)-1)]

def run_load_test(name, url, headers=None, method='GET', body=None, expected_status=200):
    print(f'\n{"="*60}')
    print(f'🔨 压测: {name}')
    print(f'   URL: {url}')
    print(f'   并发: {THREADS} 线程 × {REQUESTS_PER_THREAD} = {TOTAL} 请求')
    print(f'{"="*60}')
    
    latencies = []
    statuses = {}
    errors = []
    lock = threading.Lock()
    stop_event = threading.Event()
    
    session = requests.Session()
    if headers:
        for k, v in headers.items():
            session.headers[k] = v

    def worker():
        local_lat = []
        local_status = {}
        local_errors = []
        for _ in range(REQUESTS_PER_THREAD):
            if stop_event.is_set(): break
            try:
                t0 = time.perf_counter()
                resp = session.request(method, url, headers=headers, json=body, 
                                       timeout=15, allow_redirects=True)
                dt = (time.perf_counter() - t0) * 1000  # ms
                local_lat.append(dt)
                local_status[resp.status_code] = local_status.get(resp.status_code, 0) + 1
                if resp.status_code != expected_status:
                    local_errors.append(f'{resp.status_code}')
            except Exception as e:
                local_errors.append(str(e)[:80])
                local_status[0] = local_status.get(0, 0) + 1
        with lock:
            latencies.extend(local_lat)
            for k, v in local_status.items():
                statuses[k] = statuses.get(k, 0) + v
            errors.extend(local_errors)
    
    t_start = time.perf_counter()
    
    # 预热 5 个请求（避免连接冷启动影响）
    print('   预热 5 请求...')
    for _ in range(5):
        try:
            requests.request(method, url, headers=headers, json=body, timeout=10)
        except: pass
    
    threads = []
    for _ in range(THREADS):
        t = threading.Thread(target=worker, daemon=True)
        threads.append(t)
        t.start()
    
    for t in threads:
        t.join()
    
    t_elapsed = time.perf_counter() - t_start
    
    # 统计
    sorted_lat = sorted(latencies)
    success = sum(v for k, v in statuses.items() if 200 <= k < 400)
    total_done = sum(statuses.values())
    qps = total_done / t_elapsed if t_elapsed > 0 else 0
    avg_ms = statistics.mean(sorted_lat) if sorted_lat else 0
    med_ms = statistics.median(sorted_lat) if sorted_lat else 0
    
    print(f'\n📊 结果:')
    print(f'   ⏱️  总耗时: {t_elapsed:.2f}s')
    print(f'   📦 完成请求: {total_done}/{TOTAL}')
    print(f'   ✅ 成功率: {success/total_done*100:.1f}%')
    print(f'   🚀 QPS: {qps:.1f} req/s')
    print(f'   📈 延迟 (ms):')
    print(f'      min={min(sorted_lat):.1f}  avg={avg_ms:.1f}  med={med_ms:.1f}')
    print(f'      p90={pct(sorted_lat,90):.1f}  p95={pct(sorted_lat,95):.1f}  p99={pct(sorted_lat,99):.1f}  max={max(sorted_lat):.1f}')
    print(f'   📋 状态码分布: {dict(sorted(statuses.items()))}')
    if errors:
        print(f'   ❌ 错误示例 (前5): {errors[:5]}')
    
    return {
        'name': name, 'qps': qps, 'avg_ms': avg_ms, 'p99_ms': pct(sorted_lat, 99),
        'success_pct': success/total_done*100 if total_done else 0,
        'total': total_done, 'elapsed_s': t_elapsed
    }

# ====== 测试 1: nginx 静态 JS（最大、最常用的资源）======
r1 = run_load_test(
    '静态资源: index-DNGO2v2a.js (637KB, gzip后约180KB)',
    f'{BASE}/assets/index-DNGO2v2a.js',
)

# ====== 测试 2: nginx 静态 CSS ======
r2 = run_load_test(
    '静态资源: index-C12aLu0K.css (50KB)',
    f'{BASE}/assets/index-C12aLu0K.css',
)

# ====== 测试 3: SPA 页面 — merchant/login (HTML fallback) ======
r3 = run_load_test(
    'SPA 页面: /merchant/login (nginx try_files fallback)',
    f'{BASE}/merchant/login',
)

# ====== 测试 4: SPA 页面 — wms/login ======
r4 = run_load_test(
    'SPA 页面: /wms/login',
    f'{BASE}/wms/login',
)

# ====== 测试 5: Supabase REST API — tlv_warehouses (匿名读) ======
r5 = run_load_test(
    'Supabase API: GET tlv_warehouses (anon key)',
    f'{SUPABASE_URL}/tlv_warehouses?select=id,name,code',
    headers=headers_rest,
)

# ====== 测试 6: Supabase REST API — tlv_merchants (匿名读) ======
r6 = run_load_test(
    'Supabase API: GET tlv_merchants (anon key)',
    f'{SUPABASE_URL}/tlv_merchants?select=id,business_name,balance',
    headers=headers_rest,
)

# ====== 汇总 ======
print(f'\n\n{"="*60}')
print(f'📋 压力测试汇总 @ {datetime.now().strftime("%Y-%m-%d %H:%M")}')
print(f'   并发 {THREADS} × {REQUESTS_PER_THREAD} = {TOTAL} 请求')
print(f'{"="*60}')
print(f'{"测试项":<45} {"QPS":>8} {"avg":>8} {"p99":>8} {"成功率":>8}')
print(f'{"-"*77}')
for r in [r1,r2,r3,r4,r5,r6]:
    print(f'{r["name"][:44]:<45} {r["qps"]:>7.1f} {r["avg_ms"]:>7.1f}ms {r["p99_ms"]:>7.1f}ms {r["success_pct"]:>7.1f}%')

print(f'\n🏗️ 服务器: 43.133.232.81 (nginx + Supabase Docker)')
print(f'📅 测试时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
