#!/usr/bin/env python3
"""
Thalvior v7 高强度压测
场景:
  1. 阶梯加压 20→50→100→200→300→500 并发 (各 30s)
  2. 极限稳压 300 并发 × 3 分钟
  3. auth signin 极限 (并发登录)
  4. 混合读写极限 (60%认证读 + 25%真写入 + 10%SPA + 5%signin)
  同时采集服务器指标 (CPU/mem/docker stats)
"""
import threading, time, requests, sys, statistics, json, random, concurrent.futures
from datetime import datetime
import socket, paramiko

BASE = 'https://thalvior.icu'
SUPABASE_URL = f'{BASE}/rest/v1'
ANON_KEY = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'
H_ANON = {'apikey': ANON_KEY, 'Authorization': f'Bearer {ANON_KEY}'}

# === SSH 服务器监控 ===
SSH_HOST, SSH_PORT, SSH_USER, SSH_PASS = '43.133.232.81', 22, 'ubuntu', 'yuan340364#'
def make_proxy_sock():
    sock = socket.socket(); sock.settimeout(5); sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.connect(('127.0.0.1', 18080))
    sock.sendall(f'CONNECT {SSH_HOST}:{SSH_PORT} HTTP/1.1\r\nHost: {SSH_HOST}:{SSH_PORT}\r\n\r\n'.encode())
    buf = b''
    while b'\r\n\r\n' not in buf:
        d = sock.recv(4096)
        if not d: break
        buf += d
    time.sleep(0.3); return sock

def get_ssh():
    sock = make_proxy_sock()
    t = paramiko.Transport(sock); t.start_client(); t.auth_password(SSH_USER, SSH_PASS)
    c = paramiko.SSHClient(); c._transport = t; c._sftp_live = False
    return c

def server_metrics(c):
    """采一次服务器指标"""
    try:
        o, _ = c.exec_command("""
            echo "=== HOST ===" && top -bn1 | head -5 && free -m | head -3 && df -h / | tail -1 &&
            echo "=== DOCKER ===" && docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null
        """, timeout=10)
        return o.read().decode('utf-8', errors='replace')
    except:
        return ''

# === 工具 ===
def pct(vals, p):
    if not vals: return 0
    s = sorted(vals); idx = int(len(s) * p / 100)
    return s[min(idx, len(s)-1)]

def acquire_token(email, pwd):
    r = requests.post(f'{BASE}/auth/v1/token?grant_type=password',
        json={'email': email, 'password': pwd},
        headers={'apikey': ANON_KEY, 'Content-Type': 'application/json'}, timeout=15)
    return r.json().get('access_token') if r.status_code == 200 else None

def make_body(mid, wid, seq):
    ts = int(time.time() * 1000)
    return {
        'order_no': f'SO-HIGHLOAD-{seq}-{ts}',
        'source': 'manual', 'platform': 'LoadTest', 'status': 'pending',
        'merchant_id': mid, 'warehouse_id': wid, 'merchant_name': 'LoadTest商家',
        'receiver_name': f'Load{seq}',
        'receiver_address': 'High Load Test Street',
        'receiver_city': 'Shenzhen', 'receiver_country': 'CN',
        'total_charge': round(random.uniform(5, 50), 2),
    }

# === Token 池 ===
print('='*70)
print('🎯 Thalvior v7 高强度压力测试')
print(f'   时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
print('='*70)

print('\n📦 准备 token 池...')
merchant_token = acquire_token('merchant@thalvior.dev', 'Merchant1234!')
wms_token = acquire_token('wms@thalvior.dev', 'Wms1234!')
admin_token = acquire_token('admin@thalvior.dev', 'Admin1234!')
assert merchant_token and wms_token and admin_token, '❌ token 获取失败'

# 拿 merchant/warehouse id
h = {'apikey': ANON_KEY, 'Authorization': f'Bearer {merchant_token}'}
mr = requests.get(f'{SUPABASE_URL}/tlv_merchants?select=id,warehouse_id&limit=1', headers=h, timeout=10)
MID = mr.json()[0]['id']; WID = mr.json()[0]['warehouse_id']
print(f'   merchant_id={MID[:8]}... warehouse_id={WID[:8]}... ✅')

# SSH
print('\n📡 连接服务器监控...')
try:
    sshc = get_ssh()
    print('   ✅ SSH 就绪')
    # 打印初始状态
    print(server_metrics(sshc))
except Exception as e:
    print(f'   ⚠️ SSH 不可用: {e}')
    sshc = None

# ============================================================
# 核心压测函数 — 固定时长而非固定次数
# ============================================================
def stress_run(name, duration_sec, concurrency, work_fn, desc=''):
    """固定时长 duration_sec，并发 concurrency，跑 work_fn(session)"""
    print(f'\n{"─"*70}')
    print(f'🔥 {name}')
    print(f'   并发={concurrency} 时长={duration_sec}s {desc}')
    print(f'{"─"*70}')

    latencies, statuses, errors = [], {}, []
    lock = threading.Lock()
    stop_flag = threading.Event()

    def worker(tid):
        s = requests.Session()
        local_lat, local_stat, local_err = [], {}, []
        while not stop_flag.is_set():
            try:
                dt, status, err = work_fn(s, tid)
                if dt is None: continue
                local_lat.append(dt)
                local_stat[status] = local_stat.get(status, 0) + 1
                if err: local_err.append(err[:80])
            except Exception as e:
                local_stat[0] = local_stat.get(0, 0) + 1
                local_err.append(str(e)[:80])
        with lock:
            latencies.extend(local_lat)
            for k, v in local_stat.items(): statuses[k] = statuses.get(k, 0) + v
            errors.extend(local_err)

    # 启动 worker
    th_list = [threading.Thread(target=worker, args=(i,), daemon=True) for i in range(concurrency)]
    
    # 预热 (让 worker 先跑起来)
    stop_flag.clear()
    t0 = time.perf_counter()
    for t in th_list: t.start()
    
    # 同时采服务器指标 (每 10s 一次)
    server_snapshots = []
    def snap_loop():
        if not sshc: return
        while not stop_flag.is_set():
            time.sleep(10)
            snap = server_metrics(sshc)
            if snap: server_snapshots.append((time.strftime('%H:%M:%S'), snap))
    
    snap_thread = threading.Thread(target=snap_loop, daemon=True)
    snap_thread.start()
    
    # 等待结束
    time.sleep(duration_sec)
    stop_flag.set()
    for t in th_list: t.join(timeout=5)
    snap_thread.join(timeout=3)
    elapsed = time.perf_counter() - t0

    # 统计
    done = sum(statuses.values())
    ok = sum(v for k, v in statuses.items() if 200 <= k < 400)
    qps = done / elapsed if elapsed > 0 else 0
    s_lat = sorted(latencies) if latencies else []
    
    return {
        'name': name, 'concurrency': concurrency, 'duration': duration_sec,
        'total': done, 'elapsed': elapsed, 'qps': qps,
        'avg': statistics.mean(s_lat) if s_lat else 0,
        'med': statistics.median(s_lat) if s_lat else 0,
        'p90': pct(s_lat, 90), 'p95': pct(s_lat, 95), 'p99': pct(s_lat, 99),
        'p999': pct(s_lat, 99.9), 'max': max(s_lat) if s_lat else 0,
        'success': ok/done*100 if done else 0,
        'errors': errors[:5], 'statuses': dict(sorted(statuses.items())),
        'server_snaps': server_snapshots,
    }

def print_stats(r):
    flag = '⚠️' if r['success'] < 99 or r['p99'] > 2000 else '✅'
    print(f'  📊 {r["total"]} 请求 / {r["elapsed"]:.1f}s')
    print(f'  🚀 QPS={r["qps"]:.1f}  ✅成功率={r["success"]:.2f}%  {flag}')
    print(f'  📈 avg={r["avg"]:.0f}ms  med={r["med"]:.0f}ms  p90={r["p90"]:.0f}ms  p95={r["p95"]:.0f}ms  p99={r["p99"]:.0f}ms  p999={r["p999"]:.0f}ms  max={r["max"]:.0f}ms')
    print(f'  📋 状态码: {r["statuses"]}')
    if r['errors']: print(f'  ❌ 错误示例: {r["errors"][:2]}')
    if r['server_snaps']:
        print(f'  🖥️  服务器快照 @ {r["server_snaps"][-1][0]}:')
        for line in r['server_snaps'][-1][1].split('\n')[:8]:
            print(f'     {line[:80]}')

# ============================================================
# WORK FUNCTIONS — 每个场景一个
# ============================================================

def work_read_api(s, tid):
    """认证后读 outbound_orders"""
    try:
        t0 = time.perf_counter()
        r = s.get(f'{SUPABASE_URL}/tlv_outbound_orders?select=id,order_no,status&limit=50',
                  headers=H_MERC, timeout=10)
        return (time.perf_counter()-t0)*1000, r.status_code, None
    except Exception as e:
        return None, 0, str(e)

def work_read_inventory(s, tid):
    try:
        t0 = time.perf_counter()
        r = s.get(f'{SUPABASE_URL}/tlv_merchant_inventory?select=*&limit=100',
                  headers=H_MERC, timeout=10)
        return (time.perf_counter()-t0)*1000, r.status_code, None
    except Exception as e:
        return None, 0, str(e)

def work_spa_page(s, tid):
    try:
        t0 = time.perf_counter()
        r = s.get(f'{BASE}/merchant/login', timeout=10, allow_redirects=True)
        return (time.perf_counter()-t0)*1000, r.status_code, None
    except Exception as e:
        return None, 0, str(e)

def work_anon_api(s, tid):
    try:
        t0 = time.perf_counter()
        r = s.get(f'{SUPABASE_URL}/tlv_warehouses?select=*&limit=5',
                  headers=H_ANON, timeout=10)
        return (time.perf_counter()-t0)*1000, r.status_code, None
    except Exception as e:
        return None, 0, str(e)

def work_write_order(s, tid):
    """真 INSERT outbound (写完清理)"""
    try:
        body = make_body(MID, WID, random.randint(1,999999))
        t0 = time.perf_counter()
        r = s.post(f'{SUPABASE_URL}/tlv_outbound_orders', json=body,
                   headers=H_MERC, timeout=10)
        return (time.perf_counter()-t0)*1000, r.status_code, None
    except Exception as e:
        return None, 0, str(e)

def work_signin(s, tid):
    """并发 auth signin"""
    try:
        t0 = time.perf_counter()
        r = s.post(f'{BASE}/auth/v1/token?grant_type=password',
            json={'email':'merchant@thalvior.dev','password':'Merchant1234!'},
            headers={'apikey': ANON_KEY, 'Content-Type': 'application/json'}, timeout=10)
        return (time.perf_counter()-t0)*1000, r.status_code, None
    except Exception as e:
        return None, 0, str(e)

def work_mixed(s, tid):
    """混合场景 — 按概率选"""
    r = random.random()
    cum = 0
    # 60% read auth, 25% write, 10% SPA, 5% signin
    cum += 0.6
    if r < cum: return work_read_api(s, tid)
    cum += 0.25
    if r < cum: return work_write_order(s, tid)
    cum += 0.10
    if r < cum: return work_spa_page(s, tid)
    return work_signin(s, tid)

# H_MERC token
H_MERC = {'apikey': ANON_KEY, 'Authorization': f'Bearer {merchant_token}'}
H_WMS  = {'apikey': ANON_KEY, 'Authorization': f'Bearer {wms_token}'}
H_ADMIN= {'apikey': ANON_KEY, 'Authorization': f'Bearer {admin_token}'}

# ============================================================
# RUN ALL SCENARIOS
# ============================================================
all_results = []

# --- PART 1: 阶梯加压 ---
print('\n\n' + '='*70)
print('🏁 PART 1: 阶梯加压 (认证后 API — GET outbound_orders)')
print('='*70)

for conc in [20, 50, 100, 200, 300, 500]:
    r = stress_run(f'read_api_conc{conc}', 30, conc, work_read_api,
                   desc='认证后 RLS 查询 (GET tlv_outbound_orders)')
    print_stats(r)
    all_results.append(('step', r))
    if r['success'] < 99:
        print(f'   ⚠️ 成功率跌破 99%, 停止继续加压')
        break

# --- PART 2: 长时间稳压 ---
print('\n\n' + '='*70)
print('⏱️  PART 2: 长时间稳压 (300 并发 × 3 分钟)')
print('='*70)

for label, fn, desc in [
    ('read_api', work_read_api, '认证后读 outbound'),
    ('read_inventory', work_read_inventory, '认证后读 inventory'),
]:
    r = stress_run(f'stable_{label}', 180, 300, fn, desc=desc)
    print_stats(r)
    all_results.append(('stable', r))

# --- PART 3: 写入极限 ---
print('\n\n' + '='*70)
print('✍️  PART 3: 真写入极限 (INSERT outbound)')
print('='*70)

for conc in [50, 100, 200]:
    r = stress_run(f'write_conc{conc}', 20, conc, work_write_order,
                   desc='真 INSERT tlv_outbound_orders (测试数据会清理)')
    print_stats(r)
    all_results.append(('write', r))

# 清理测试数据
print('\n🧹 清理测试写入数据...')
resp = requests.delete(f'{SUPABASE_URL}/tlv_outbound_orders', headers=H_MERC,
                       params={'order_no': 'ilike.SO-HIGHLOAD-%'}, timeout=30)
print(f'   DELETE → {resp.status_code}')

# --- PART 4: auth signin 极限 ---
print('\n\n' + '='*70)
print('🔐 PART 4: auth signin 极限 (并发登录)')
print('='*70)

for conc in [20, 50, 100]:
    r = stress_run(f'signin_conc{conc}', 20, conc, work_signin,
                   desc='POST /auth/v1/token password grant')
    print_stats(r)
    all_results.append(('signin', r))

# --- PART 5: 混合场景极限 ---
print('\n\n' + '='*70)
print('🎲 PART 5: 混合读写极限 (500 并发)')
print('='*70)

r = stress_run('mixed_500', 60, 500, work_mixed,
               desc='500 并发混合: 60%认证读 + 25%真写入 + 10%SPA + 5%signin')
print_stats(r)
all_results.append(('mixed', r))

# 清理混合场景写入
print('\n🧹 清理混合场景测试数据...')
resp = requests.delete(f'{SUPABASE_URL}/tlv_outbound_orders', headers=H_MERC,
                       params={'order_no': 'ilike.SO-HIGHLOAD-%'}, timeout=30)
print(f'   DELETE → {resp.status_code}')

# ============================================================
# 最终汇总
# ============================================================
print('\n\n' + '='*70)
print(f'📊 高强度压测最终汇总 @ {datetime.now().strftime("%Y-%m-%d %H:%M")}')
print('='*70)

# PART 1 阶梯
print(f'\n🏁 PART 1: 阶梯加压 (认证后 GET outbound_orders)')
print(f'  {"并发":>4}  {"QPS":>8}  {"avg":>8}  {"p99":>8}  {"p99.9":>8}  {"成功率":>7}  {"状态码"}')
print(f'  {"-"*65}')
for cat, r in all_results:
    if cat == 'step':
        sc = r['concurrency']
        flag = '⚠️' if r['success'] < 99 else '✅'
        print(f'  {sc:>4}  {r["qps"]:>8.1f}  {r["avg"]:>7.0f}ms  {r["p99"]:>7.0f}ms  {r["p999"]:>7.0f}ms  {r["success"]:>6.1f}%  {flag}')

# PART 2 稳压
print(f'\n⏱️  PART 2: 3 分钟稳压 (300 并发)')
print(f'  {"测试项":<25} {"QPS":>8}  {"avg":>8}  {"p99":>8}  {"成功率":>7}')
print(f'  {"-"*58}')
for cat, r in all_results:
    if cat == 'stable':
        print(f'  {r["name"]:<25} {r["qps"]:>8.1f}  {r["avg"]:>7.0f}ms  {r["p99"]:>7.0f}ms  {r["success"]:>6.1f}%')

# PART 3 写入
print(f'\n✍️  PART 3: 真写入 (INSERT outbound)')
print(f'  {"并发":>4}  {"写QPS":>8}  {"avg":>8}  {"p99":>8}  {"成功率":>7}')
print(f'  {"-"*40}')
for cat, r in all_results:
    if cat == 'write':
        print(f'  {r["concurrency"]:>4}  {r["qps"]:>8.1f}  {r["avg"]:>7.0f}ms  {r["p99"]:>7.0f}ms  {r["success"]:>6.1f}%')

# PART 4 signin
print(f'\n🔐 PART 4: auth signin 极限')
print(f'  {"并发":>4}  {"signin QPS":>10}  {"avg":>8}  {"p99":>8}  {"成功率":>7}')
print(f'  {"-"*44}')
for cat, r in all_results:
    if cat == 'signin':
        print(f'  {r["concurrency"]:>4}  {r["qps"]:>10.1f}  {r["avg"]:>7.0f}ms  {r["p99"]:>7.0f}ms  {r["success"]:>6.1f}%')

# PART 5 混合
print(f'\n🎲 PART 5: 500 并发混合场景')
for cat, r in all_results:
    if cat == 'mixed':
        print(f'  总请求: {r["total"]}  耗时: {r["elapsed"]:.1f}s')
        print(f'  QPS: {r["qps"]:.1f}  成功率: {r["success"]:.1f}%')
        print(f'  avg={r["avg"]:.0f}ms  p99={r["p99"]:.0f}ms  p99.9={r["p999"]:.0f}ms  max={r["max"]:.0f}ms')

# 关键结论
print(f'\n{"="*70}')
print(f'🎯 核心结论')
print(f'{"="*70}')

step_results = [r for c, r in all_results if c == 'step']
if step_results:
    peak = max(step_results, key=lambda x: x['qps'])
    print(f'  📈 读 QPS 峰值: {peak["qps"]:.0f} @ concurrency={peak["concurrency"]}')
    
p99_at_100 = next((r for c, r in all_results if c == 'step' and r['concurrency'] == 100), None)
if p99_at_100:
    print(f'  📈 100 并发 p99 延迟: {p99_at_100["p99"]:.0f}ms')

write_results = [r for c, r in all_results if c == 'write']
if write_results:
    print(f'  ✍️  写 QPS 峰值: {max(write_results, key=lambda x: x["qps"])["qps"]:.1f}')

signin_results = [r for c, r in all_results if c == 'signin']
if signin_results:
    print(f'  🔐 signin QPS 峰值: {max(signin_results, key=lambda x: x["qps"])["qps"]:.1f}')

any_fail = any(r['success'] < 99 for c, r in all_results)
print(f'  {"✅" if not any_fail else "⚠️"} 所有场景成功率 >99%: {"是" if not any_fail else "有失败"}')

if sshc:
    print(f'\n🖥️  服务器最终状态:')
    print(server_metrics(sshc))
    sshc.close()

print(f'\n📅 完成时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
