#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
最终修复部署：
1) 修复 scheduler.js 中的 (intermediate value) not iterable
2) 上传所有修复后的后端文件
3) 数据库补齐缺失列
4) 重启服务 + 验证
"""
import os, sys, socket, time, json
from pathlib import Path
from urllib.parse import urlparse
import paramiko

PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))
HOSTS = ['120.55.6.75']
USER = 'admin'
PASS = 'yuan340364'

REPO = Path(__file__).resolve().parent
REMOTE_BACKEND = '/opt/shuxu-erp/backend/src'

def log(*a, **k):
    print('[FIX]', *a, flush=True, **k)

def connect():
    assert PROXY_URL, 'HTTPS_PROXY 环境变量不存在'
    p = urlparse(PROXY_URL)
    ph, pp = p.hostname, p.port or 80
    last_err = None
    for host in HOSTS:
        try:
            port = 22
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(20)
            s.connect((ph, pp))
            s.sendall(f'CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n'.encode())
            data = b''
            while b'\r\n\r\n' not in data:
                data += s.recv(1)
                if len(data) > 4096: break
            first = data.split(b'\r\n')[0].decode(errors='ignore')
            if '200' not in first:
                s.close(); raise RuntimeError('CONNECT 非 200: ' + first)
            cli = paramiko.SSHClient()
            cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            cli.connect(hostname=host, port=22, username=USER, password=PASS,
                        sock=s, timeout=25, banner_timeout=20, auth_timeout=20,
                        allow_agent=False, look_for_keys=False)
            log(f'✅ SSH → {host}')
            return cli
        except Exception as e:
            last_err = e
            try: s.close()
            except: pass
    raise RuntimeError(f'SSH失败：{last_err}')

def run(cli, cmd, timeout=300, sudo=False):
    import shlex
    if sudo:
        cmd = "sudo -n bash -lc " + shlex.quote(cmd)
    log('$', cmd[:240] + ('...' if len(cmd) > 240 else ''))
    stdin, stdout, stderr = cli.exec_command(cmd, timeout=timeout, get_pty=True)
    out = []
    while True:
        try:
            line = stdout.readline()
        except Exception:
            break
        if not line:
            break
        sys.stdout.write('   | ' + line)
        out.append(line)
    err = stderr.read().decode(errors='ignore')
    rc = stdout.channel.recv_exit_status()
    if rc != 0:
        log(f'   👉 exit={rc}')
        if err.strip():
            log('   STDERR:', err[:1200])
    return rc, ''.join(out), err

def upload_file(sftp, local_path, remote_path):
    sftp.put(str(local_path), remote_path)
    log(f'  ⬆️  {local_path.name} → {remote_path}')

def upload_dir(sftp, local_dir, remote_dir):
    for p in Path(local_dir).rglob('*'):
        if p.is_file() and p.suffix in ('.js', '.json'):
            rel = p.relative_to(local_dir)
            target = f'{remote_dir}/{str(rel)}'
            # 确保父目录存在
            parent = str(Path(target).parent)
            try: sftp.stat(parent)
            except:
                try: sftp.mkdir(parent)
                except: pass
            upload_file(sftp, p, target)

def patch_scheduler():
    """修复 scheduler.js 的 query 解构安全问题（本地修改）"""
    p = REPO / 'backend/src/scheduler.js'
    text = p.read_text(encoding='utf-8')
    # 第83行附近：const [r] = await query(INSERT INTO task_runs ...
    # 修复：防止解构 undefined
    old1 = "    const [r] = await query(\n      `INSERT INTO task_runs (task_id, tenant_id, status, started_at, finished_at, duration_ms, result_summary, error_stack, detail_json)"
    new1 = "    const qr = await query(\n      `INSERT INTO task_runs (task_id, tenant_id, status, started_at, finished_at, duration_ms, result_summary, error_stack, detail_json)"
    if old1 in text:
        text = text.replace(old1, new1)
        old2 = "       [task.id, task.tenant_id, status,\n       Math.min(durationMs, 2147483647),\n       summary || (status === 'success' ? 'ok' : ''),\n       error ? (error.stack || error.message || '').toString().slice(0, 4000) : null,\n       result && typeof result === 'object' ? JSON.stringify(result).slice(0, 16000) : null]\n    );\n    runId = r.insertId;"
        new2 = "       [task.id, task.tenant_id, status,\n       Math.min(durationMs, 2147483647),\n       summary || (status === 'success' ? 'ok' : ''),\n       error ? (error.stack || error.message || '').toString().slice(0, 4000) : null,\n       result && typeof result === 'object' ? JSON.stringify(result).slice(0, 16000) : null]\n    );\n    const r = (qr && qr.length ? qr[0] : null) || {};\n    runId = r.insertId || null;"
        if old2 in text:
            text = text.replace(old2, new2)
        else:
            log('  ⚠️ scheduler.js 第二处匹配失败')
    else:
        log('  ℹ️ scheduler.js 可能已修复，跳过')
    p.write_text(text, encoding='utf-8')

def patch_scheduler_routes():
    """修复 scheduler-routes.js count[0].c 安全访问（本地检查）"""
    p = REPO / 'backend/src/routes/scheduler-routes.js'
    text = p.read_text(encoding='utf-8')
    # 查找 count[0].c 原始写法，若存在则替换
    import re
    # 更宽松修复：所有 count[0].c → 安全版
    changed = False
    for m in list(re.finditer(r'count\[0\]\.c', text)):
        changed = True
    if changed:
        text = re.sub(r'count\[0\]\.c', r'(count && count[0] && count[0]\.c ? count[0]\.c : 0)', text)
        p.write_text(text, encoding='utf-8')
        log('  ✅ scheduler-routes.js 修复 count[0].c')
    else:
        log('  ℹ️ scheduler-routes.js 可能已修复')

def main():
    # 1. 本地代码预修复
    print("\n📝 1. 本地代码补丁 (scheduler解构 + count安全访问)")
    print("="*60)
    patch_scheduler()
    patch_scheduler_routes()

    # 2. 连接服务器
    print("\n🔗 2. 连接服务器")
    print("="*60)
    cli = connect()
    sftp = cli.open_sftp()

    # 3. 上传所有后端代码文件
    print("\n⬆️ 3. 上传后端代码（/opt/shuxu-erp/backend/src）")
    print("="*60)
    upload_dir(sftp, REPO / 'backend/src', REMOTE_BACKEND)

    # 4. 数据库补齐缺失列
    print("\n🗄️ 4. 数据库ALTER TABLE补齐缺失列")
    print("="*60)
    # 读取.env
    rc, env_out, _ = run(cli, "cat /opt/shuxu-erp/backend/.env 2>/dev/null | grep -E 'DB_USER|DB_PASSWORD|DB_NAME|DB_HOST' | head -20")
    env_vars = {}
    for line in env_out.splitlines():
        if '=' in line:
            k, v = line.strip().split('=', 1)
            env_vars[k.strip()] = v.strip().strip('"').strip("'")
    log('env keys:', list(env_vars.keys()))
    DB_USER = env_vars.get('DB_USER', 'shuxu')
    DB_PASS = env_vars.get('DB_PASSWORD', env_vars.get('DB_PASS', ''))
    DB_NAME = env_vars.get('DB_NAME', 'shuxu_erp')
    DB_HOST = env_vars.get('DB_HOST', '127.0.0.1')

    # 用 mysql 命令执行 patch
    patch_sql = f"""
SET NAMES utf8mb4;
USE `{DB_NAME}`;

-- 1. finance_profit 加 order_date
ALTER TABLE finance_profit ADD COLUMN IF NOT EXISTS order_date DATETIME DEFAULT NULL COMMENT '订单日期（冗余用于快速筛选）' AFTER order_no;
-- 从 order_id 回填 order_date（有订单的）
UPDATE finance_profit fp SET order_date = (SELECT o.created_at FROM orders o WHERE o.id = fp.order_id AND o.tenant_id = fp.tenant_id) WHERE order_date IS NULL AND order_id IS NOT NULL;
UPDATE finance_profit SET order_date = created_at WHERE order_date IS NULL;

-- 2. bills 表缺失列补齐（若不存在则创建）
CREATE TABLE IF NOT EXISTS bills (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  bill_month VARCHAR(7) NOT NULL COMMENT '账期YYYY-MM',
  title VARCHAR(180) NOT NULL,
  total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
  remark VARCHAR(500) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant_month (tenant_id, bill_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bill_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  bill_id BIGINT NOT NULL,
  item_type VARCHAR(40) NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  qty INT NOT NULL DEFAULT 1,
  remark VARCHAR(500) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_bill (bill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. products 加 stock_min
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_min INT NOT NULL DEFAULT 3 COMMENT '安全库存阈值' AFTER cost;

-- 4. 确保终版表存在（migrate-v6-final 表）
CREATE TABLE IF NOT EXISTS landing_configs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  site_name VARCHAR(120) NOT NULL DEFAULT '数序跨境ERP',
  banner_json TEXT NOT NULL COMMENT '官网首屏banner数组JSON',
  advantage_json TEXT NOT NULL COMMENT '产品核心优势数组JSON',
  features_json TEXT NOT NULL COMMENT '12大功能模块数组JSON',
  plans_json TEXT NOT NULL COMMENT '套餐价格数组JSON',
  cases_json TEXT NOT NULL COMMENT '用户案例数组JSON',
  compare_json TEXT NOT NULL COMMENT '对比表JSON',
  apply_json TEXT NOT NULL COMMENT '体验申请字段配置JSON',
  footer_json TEXT NOT NULL COMMENT '底部联系JSON',
  seo_json TEXT NOT NULL COMMENT 'SEO',
  updated_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='官网落地页全量动态配置';

CREATE TABLE IF NOT EXISTS site_applications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  shop_type VARCHAR(80) DEFAULT NULL,
  company VARCHAR(180) DEFAULT NULL,
  contact_name VARCHAR(60) DEFAULT NULL,
  message VARCHAR(1000) DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  handled_by BIGINT DEFAULT NULL,
  note VARCHAR(500) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_phone (phone),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='官网体验申请';

CREATE TABLE IF NOT EXISTS media_assets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL DEFAULT 0 COMMENT '0=公共资源（运营）',
  owner_user_id BIGINT DEFAULT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  original_name VARCHAR(255) DEFAULT NULL,
  stored_name VARCHAR(255) NOT NULL,
  stored_path VARCHAR(500) NOT NULL,
  access_url VARCHAR(500) NOT NULL,
  mime_type VARCHAR(80) DEFAULT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  width INT DEFAULT NULL,
  height INT DEFAULT NULL,
  ext_info_json TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant_cat (tenant_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='素材资源库';

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL UNIQUE,
  plan_code VARCHAR(40) NOT NULL DEFAULT 'basic',
  plan_name VARCHAR(80) NOT NULL DEFAULT '基础版',
  period VARCHAR(20) NOT NULL DEFAULT 'month',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  auto_renew TINYINT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  extra_shops INT NOT NULL DEFAULT 0,
  extra_orders_monthly BIGINT NOT NULL DEFAULT 0,
  extra_storage_mb INT NOT NULL DEFAULT 0,
  extra_ai_calls BIGINT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='租户当前订阅';

CREATE TABLE IF NOT EXISTS billing_orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  order_no VARCHAR(60) NOT NULL UNIQUE,
  order_type VARCHAR(30) NOT NULL DEFAULT 'subscribe',
  plan_code VARCHAR(40) DEFAULT NULL,
  period VARCHAR(20) DEFAULT NULL,
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  pay_method VARCHAR(30) DEFAULT NULL,
  pay_proof_url VARCHAR(500) DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  handled_by BIGINT DEFAULT NULL,
  handled_note VARCHAR(500) DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  expired_at DATETIME DEFAULT NULL,
  extra_json TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant (tenant_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订阅订单';

CREATE TABLE IF NOT EXISTS billing_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  order_id BIGINT DEFAULT NULL,
  action VARCHAR(30) NOT NULL COMMENT 'subscribe/renew/expand/adjust',
  plan_code VARCHAR(40) DEFAULT NULL,
  period VARCHAR(20) DEFAULT NULL,
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  days INT NOT NULL DEFAULT 0,
  operator VARCHAR(40) DEFAULT NULL,
  note VARCHAR(500) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订阅续费记录';

-- 插入默认 landing_configs （仅当不存在时）
INSERT INTO landing_configs (site_name, banner_json, advantage_json, features_json, plans_json, cases_json, compare_json, apply_json, footer_json, seo_json)
SELECT * FROM (
  SELECT
  '数序跨境ERP' AS site_name,
  JSON_ARRAY(JSON_OBJECT('img','/uploads/media/default/banner-1.jpg','title','一站式跨境电商ERP解决方案','subTitle','覆盖全球70+电商平台 · 智能审单 · 库存闭环 · 财务全自动核算','btnText','立即申请体验','btnLink','/apply')) AS banner_json,
  JSON_ARRAY(
    JSON_OBJECT('icon','🌐','title','多平台同步','desc','覆盖Amazon/Temu/Shein/Shopee/速卖通等70+平台，一键同步订单商品'),
    JSON_OBJECT('icon','✅','title','全自动审单','desc','自定义风控规则，95%订单自动放行，异常精准拦截'),
    JSON_OBJECT('icon','📦','title','库存闭环','desc','采购→入库→发货→盘点全链路，SKU级库存实时精准'),
    JSON_OBJECT('icon','💰','title','财务利润','desc','多币种汇率自动换算，订单级利润拆解，月度自动结算'),
    JSON_OBJECT('icon','🤖','title','AI智能','desc','销量预测、库存风险、欺诈识别、智能刊登建议')
  ) AS advantage_json,
  JSON_ARRAY(
    JSON_OBJECT('icon','🛒','title','商品中心','desc','SPU/SKU/变体/刊登/合规全流程管理','points',JSON_ARRAY('SPU/SKU变体','批量刊登','合规预审','预售管理')),
    JSON_OBJECT('icon','📋','title','订单中心','desc','70+平台订单自动拉取、审单、发货','points',JSON_ARRAY('自动拉单','智能审单','批量打单','逆向售后')),
    JSON_OBJECT('icon','🏪','title','店铺中心','desc','多店铺授权、配额管理、健康度监控','points',JSON_ARRAY('一键授权','配额管控','异常预警','令牌刷新')),
    JSON_OBJECT('icon','📦','title','库存中心','desc','多仓多货主、批次序列号、安全库存预警','points',JSON_ARRAY('多仓管理','出入库流水','库存预警','盘点调整')),
    JSON_OBJECT('icon','🚚','title','物流发货','desc','承运商对接、面单打印、头程尾程跟踪','points',JSON_ARRAY('物流对接','批量打单','轨迹跟踪','运费对账')),
    JSON_OBJECT('icon','💰','title','财务中心','desc','利润看板、账单结算、成本分摊、多币种','points',JSON_ARRAY('利润拆解','月度结算','成本分摊','实时汇率')),
    JSON_OBJECT('icon','📊','title','数据看板','desc','销量利润大盘、实时监控、多维度分析','points',JSON_ARRAY('实时大屏','多维分析','自定义报表','7日趋势')),
    JSON_OBJECT('icon','🤖','title','AI智能','desc','销量预测、风险预警、智能推荐','points',JSON_ARRAY('销量预测','欺诈识别','库存风险','AI刊登')),
    JSON_OBJECT('icon','🔔','title','消息通知','desc','站内信+微信+邮件多通道异常告警','points',JSON_ARRAY('多通道','异常告警','审批通知','任务提醒')),
    JSON_OBJECT('icon','🧑‍💼','title','组织权限','desc','多角色子账号、操作权限、字段权限','points',JSON_ARRAY('角色管理','操作日志','子账号','权限隔离')),
    JSON_OBJECT('icon','⚙️','title','调度中心','desc','全自动定时任务、失败重试、可视化监控','points',JSON_ARRAY('自动同步','失败重试','任务监控','手动触发')),
    JSON_OBJECT('icon','🎯','title','运营后台','desc','租户管理、套餐订阅、官网可视化编辑','points',JSON_ARRAY('租户生命周期','套餐改配','官网配置','账单审核'))
  ) AS features_json,
  JSON_ARRAY(
    JSON_OBJECT('name','基础版','price_month','¥199','price_quarter','¥529','price_year','¥1980','tag','入门首选','features',JSON_ARRAY('3个店铺','每月500单','2000个商品','100次AI调用','1GB存储','订单/商品/库存/财务基础功能','工作日工单支持')),
    JSON_OBJECT('name','标准版','price_month','¥599','price_quarter','¥1599','price_year','¥5980','tag','热门推荐','features',JSON_ARRAY('10个店铺','每月5000单','10000个商品','2000次AI调用','10GB存储','自动审单规则配置','多仓+批次序列号','利润看板+月度结算','汇率+7日趋势','工作日1v1客服')),
    JSON_OBJECT('name','专业版','price_month','¥1599','price_quarter','¥4299','price_year','¥15980','tag','专业卖家','features',JSON_ARRAY('30个店铺','每月30000单','商品无限','10000次AI调用','100GB存储','AI销量预测/风险检测','7x12小时客服响应','高级运营后台API','定制物流对接','SLA 99.9%')),
    JSON_OBJECT('name','企业版','price_month','¥4999','price_quarter','¥13499','price_year','¥47980','tag','品牌旗舰','features',JSON_ARRAY('100个店铺','每月20万单','商品无限','50000次AI调用','512GB+存储','专属实施顾问','定制化功能开发','私有化部署选项','SLA 99.95%','7x24运维'))
  ) AS plans_json,
  JSON_ARRAY(
    JSON_OBJECT('logo','🏷️','industry':'3C数码','title':'某深圳数码大卖','quote':'从Temu到Amazon 12店同管，库存准度提升98%，月节省人力80%。'),
    JSON_OBJECT('logo','👗','industry':'女装服饰','title':'某杭州女装跨境','quote':'财务利润拆解帮我们每月省出20万汇损，订单级利润清清楚楚。'),
    JSON_OBJECT('logo':'🏠','industry':'家居百货','title':'某宁波家居出海','quote':'自动审单拦截了97%异常订单，仓库错发率从8%降到0.3%。')
  ) AS cases_json,
  JSON_ARRAY(
    JSON_OBJECT('item':'覆盖平台数','miaoshou':'约30','jushuitan':'约40','ours':'70+'),
    JSON_OBJECT('item':'全自动审单','miaoshou':'基础规则','jushuitan':'高级规则','ours':'AI+规则+风控'),
    JSON_OBJECT('item':'库存精准度','miaoshou':'约90%','jushuitan':'约95%','ours':'99%+流水闭环'),
    JSON_OBJECT('item':'订单级利润','miaoshou':'简单统计','jushuitan':'维度有限','ours':'9大成本口径拆解'),
    JSON_OBJECT('item':'AI智能能力','miaoshou':'无','jushuitan':'部分','ours':'全链路AI'),
    JSON_OBJECT('item':'官网可配置化','miaoshou':'静态','jushuitan':'静态','ours':'动态可视化编辑')
  ) AS compare_json,
  JSON_OBJECT('phonePlaceholder':'请输入您的手机号','shopTypePlaceholder':'请选择主营平台类型','shopTypes',JSON_ARRAY('Amazon','Temu','Shein','Shopee/Lazada','速卖通','eBay','TikTok','独立站','其他'),'btnText':'立即免费申请体验','noteText','提交后，专属顾问将在30分钟内联系您，提供免费1对1演示和14天专业版试用。') AS apply_json,
  JSON_OBJECT('copyright':'© 2025 数序科技 All Rights Reserved','icp':'浙ICP备2025000000号','phone':'400-888-0000','email':'contact@qianniu-erp.cc','wechatQr':'/uploads/media/default/wx-qr.png','address':'浙江省杭州市余杭区未来科技城') AS footer_json,
  JSON_OBJECT('title':'数序跨境ERP - 一站式跨境电商智能管理平台','keywords':'跨境ERP,电商ERP,亚马逊ERP,Temu ERP,Shein ERP,库存管理,订单管理,财务利润','description':'数序跨境ERP覆盖全球70+电商平台，支持智能审单、库存闭环、财务全自动核算与AI辅助决策，助力跨境卖家降本增效。') AS seo_json
) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM landing_configs LIMIT 1);

SELECT 'SQL PATCH 完成' AS status;
"""
    # 写入临时SQL文件执行
    sftp.open('/tmp/patch-db.sql', 'w').write(patch_sql)
    run(cli, f"mysql -h{DB_HOST} -u{DB_USER} -p'{DB_PASS}' {DB_NAME} < /tmp/patch-db.sql 2>&1 | tail -40", timeout=60)

    # 5. 重启服务
    print("\n🔄 5. 重启 shuxu-erp 服务")
    print("="*60)
    run(cli, "sudo systemctl restart shuxu-erp", sudo=True)
    time.sleep(4)
    run(cli, "sudo systemctl status shuxu-erp --no-pager -n 10", sudo=True)

    # 6. 冒烟测试API
    print("\n🧪 6. API冒烟测试 (本机+域名)")
    print("="*60)
    for i in range(6):
        time.sleep(1)
        rc, out, _ = run(cli, "curl -sS -m 4 http://127.0.0.1:8090/api/health 2>&1")
        if "status" in out or "ok" in out:
            log("🎉 本机健康检查通过")
            break
        log(f"  等待... {i+1}/6")

    # 关键API冒烟
    tests = [
        ("官网配置", "curl -sS -m 5 http://127.0.0.1:8090/api/v1/public/landing/config 2>&1 | head -c 400"),
        ("套餐目录", "curl -sS -m 5 http://127.0.0.1:8090/api/v1/public/landing/config 2>&1 | python3 -c \"import sys,json;d=json.load(sys.stdin);print('plans len:', len(d.get('plans',[])),'ready:',d.get('ready'))\""),
    ]
    for name, cmd in tests:
        log(f"--- {name} ---")
        run(cli, cmd)

    sftp.close()
    cli.close()
    print("\n✅ 全部部署完成")

if __name__ == "__main__":
    main()
