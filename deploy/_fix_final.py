#!/usr/bin/env python3
"""最终修复：dotenv加载 + scheduler-routes反斜杠 + 上传 + seed landing + 重启"""
import os, sys, socket, time
from urllib.parse import urlparse
from pathlib import Path
import paramiko

REPO = Path(__file__).resolve().parent
PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))
HOST = '120.55.6.75'
USER = 'admin'
PASS = 'yuan340364'
REMOTE_BACKEND = '/opt/shuxu-erp/backend/src'

def log(*a, **k): print('[FINAL]', *a, flush=True, **k)

def connect():
    p = urlparse(PROXY_URL); ph, pp = p.hostname, p.port or 80
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(20); s.connect((ph, pp))
    s.sendall(f'CONNECT {HOST}:22 HTTP/1.1\r\nHost: {HOST}:22\r\n\r\n'.encode())
    data = b''
    while b'\r\n\r\n' not in data: data += s.recv(1)
    if b'200' not in data.split(b'\r\n')[0]: raise RuntimeError('CONNECT fail')
    cli = paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(hostname=HOST, port=22, username=USER, password=PASS,
                sock=s, timeout=25, banner_timeout=20, auth_timeout=20,
                allow_agent=False, look_for_keys=False)
    log('✅ SSH OK')
    return cli

def run(cli, cmd, timeout=300, sudo=False):
    import shlex
    if sudo: cmd = "sudo -n bash -lc " + shlex.quote(cmd)
    log('$', cmd[:200])
    stdin, stdout, stderr = cli.exec_command(cmd, timeout=timeout, get_pty=True)
    out = []
    while True:
        try: line = stdout.readline()
        except: break
        if not line: break
        sys.stdout.write('   | ' + line); out.append(line)
    err = stderr.read().decode(errors='ignore')
    rc = stdout.channel.recv_exit_status()
    if rc != 0:
        log(f'   👉 exit={rc}')
        if err.strip(): log('   STDERR:', err[:1200])
    return rc, ''.join(out), err

def main():
    cli = connect()
    sftp = cli.open_sftp()

    # 1. 上传修复后的文件
    print("\n⬆️ 1. 上传修复的关键文件")
    print("="*60)
    for f in ['config.js', 'routes/scheduler-routes.js']:
        src = REPO / 'backend/src' / f
        dst = f'{REMOTE_BACKEND}/{f}'
        sftp.put(str(src), dst)
        log(f'   ⬆️ {f}')

    # 2. 手动启动验证（加载dotenv）
    print("\n🔍 2. 手动启动语法验证 + dotenv")
    print("="*60)
    rc, out, _ = run(cli, "cd /opt/shuxu-erp/backend && timeout 6 node -e \"require('./src/config'); console.log('jwt OK:', !!process.env.JWT_SECRET, 'DB OK:', !!process.env.DB_PASSWORD)\" 2>&1", timeout=15)
    if "jwt OK: true" not in out:
        log("⚠️ dotenv可能无效，手动环境变量注入检查:")
        run(cli, "cat /opt/shuxu-erp/backend/.env | grep -v '^#' | head -15")

    # 语法检查
    for f in ['src/config.js', 'src/routes/scheduler-routes.js']:
        run(cli, f"cd /opt/shuxu-erp/backend && node --check {f} 2>&1")

    # 3. 写seed脚本到backend目录下（可以找到mysql2）
    print("\n📝 3. Seed landing_config")
    print("="*60)
    seed_js = r'''
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 2
  });
  try {
    const [rows] = await pool.query('SELECT COUNT(*) c FROM landing_configs');
    if (rows[0].c > 0) {
      console.log('landing_configs 已有', rows[0].c, '条记录，跳过初始化，直接读第一条');
      const [rc] = await pool.query('SELECT id, site_name FROM landing_configs LIMIT 1');
      console.log('  id=', rc[0].id, 'site_name=', rc[0].site_name);
    } else {
      console.log('初始化默认 landing_configs...');
      const banner = JSON.stringify([{img:'https://img.icons8.com/color/96/e-commerce-portfolio.png',title:'一站式跨境电商ERP解决方案',subTitle:'覆盖全球70+电商平台 · 智能审单 · 库存闭环 · 财务全自动核算',btnText:'立即申请体验',btnLink:'/apply'}]);
      const advantage = JSON.stringify([{icon:'🌐',title:'多平台同步',desc:'覆盖Amazon/Temu/Shein/Shopee/速卖通等70+平台，一键同步订单商品'},{icon:'✅',title:'全自动审单',desc:'自定义风控规则，95%订单自动放行，异常精准拦截'},{icon:'📦',title:'库存闭环',desc:'采购→入库→发货→盘点全链路，SKU级库存实时精准'},{icon:'💰',title:'财务利润',desc:'多币种汇率自动换算，订单级利润拆解，月度自动结算'},{icon:'🤖',title:'AI智能',desc:'销量预测、库存风险、欺诈识别、智能刊登建议'}]);
      const features = JSON.stringify([
        {icon:'🛒',title:'商品中心',desc:'SPU/SKU/变体/刊登/合规全流程管理',points:['SPU/SKU变体','批量刊登','合规预审','预售管理']},
        {icon:'📋',title:'订单中心',desc:'70+平台订单自动拉取、审单、发货',points:['自动拉单','智能审单','批量打单','逆向售后']},
        {icon:'🏪',title:'店铺中心',desc:'多店铺授权、配额管理、健康度监控',points:['一键授权','配额管控','异常预警','令牌刷新']},
        {icon:'📦',title:'库存中心',desc:'多仓多货主、批次序列号、安全库存预警',points:['多仓管理','出入库流水','库存预警','盘点调整']},
        {icon:'🚚',title:'物流发货',desc:'承运商对接、面单打印、头程尾程跟踪',points:['物流对接','批量打单','轨迹跟踪','运费对账']},
        {icon:'💰',title:'财务中心',desc:'利润看板、账单结算、成本分摊、多币种',points:['利润拆解','月度结算','成本分摊','实时汇率']},
        {icon:'📊',title:'数据看板',desc:'销量利润大盘、实时监控、多维度分析',points:['实时大屏','多维分析','自定义报表','7日趋势']},
        {icon:'🤖',title:'AI智能',desc:'销量预测、风险预警、智能推荐',points:['销量预测','欺诈识别','库存风险','AI刊登']},
        {icon:'🔔',title:'消息通知',desc:'站内信+微信+邮件多通道异常告警',points:['多通道','异常告警','审批通知','任务提醒']},
        {icon:'🧑‍💼',title:'组织权限',desc:'多角色子账号、操作权限、字段权限',points:['角色管理','操作日志','子账号','权限隔离']},
        {icon:'⚙️',title:'调度中心',desc:'全自动定时任务、失败重试、可视化监控',points:['自动同步','失败重试','任务监控','手动触发']},
        {icon:'🎯',title:'运营后台',desc:'租户管理、套餐订阅、官网可视化编辑',points:['租户生命周期','套餐改配','官网配置','账单审核']}
      ]);
      const plans = JSON.stringify([
        {name:'基础版',price_month:'¥199',price_quarter:'¥529',price_year:'¥1980',tag:'入门首选',features:['3个店铺','每月500单','2000个商品','100次AI调用','1GB存储','订单/商品/库存/财务基础功能','工作日工单支持']},
        {name:'标准版',price_month:'¥599',price_quarter:'¥1599',price_year:'¥5980',tag:'热门推荐',features:['10个店铺','每月5000单','10000个商品','2000次AI调用','10GB存储','自动审单规则配置','多仓+批次序列号','利润看板+月度结算','汇率+7日趋势','工作日1v1客服']},
        {name:'专业版',price_month:'¥1599',price_quarter:'¥4299',price_year:'¥15980',tag:'专业卖家',features:['30个店铺','每月30000单','商品无限','10000次AI调用','100GB存储','AI销量预测/风险检测','7x12小时客服响应','高级运营后台API','定制物流对接','SLA 99.9%']},
        {name:'企业版',price_month:'¥4999',price_quarter:'¥13499',price_year:'¥47980',tag:'品牌旗舰',features:['100个店铺','每月20万单','商品无限','50000次AI调用','512GB+存储','专属实施顾问','定制化功能开发','私有化部署选项','SLA 99.95%','7x24运维']}
      ]);
      const cases = JSON.stringify([
        {logo:'🏷️',industry:'3C数码',title:'某深圳数码大卖',quote:'从Temu到Amazon 12店同管，库存准度提升98%，月节省人力80%。'},
        {logo:'👗',industry:'女装服饰',title:'某杭州女装跨境',quote:'财务利润拆解帮我们每月省出20万汇损，订单级利润清清楚楚。'},
        {logo:'🏠',industry:'家居百货',title:'某宁波家居出海',quote:'自动审单拦截了97%异常订单，仓库错发率从8%降到0.3%。'}
      ]);
      const compare = JSON.stringify([
        {item:'覆盖平台数',miaoshou:'约30',jushuitan:'约40',ours:'70+'},
        {item:'全自动审单',miaoshou:'基础规则',jushuitan:'高级规则',ours:'AI+规则+风控'},
        {item:'库存精准度',miaoshou:'约90%',jushuitan:'约95%',ours:'99%+流水闭环'},
        {item:'订单级利润',miaoshou:'简单统计',jushuitan:'维度有限',ours:'9大成本口径拆解'},
        {item:'AI智能能力',miaoshou:'无',jushuitan:'部分',ours:'全链路AI'},
        {item:'官网可配置化',miaoshou:'静态',jushuitan:'静态',ours:'动态可视化编辑'}
      ]);
      const apply = JSON.stringify({phonePlaceholder:'请输入您的手机号',shopTypePlaceholder:'请选择主营平台类型',shopTypes:['Amazon','Temu','Shein','Shopee/Lazada','速卖通','eBay','TikTok','独立站','其他'],btnText:'立即免费申请体验',noteText:'提交后，专属顾问将在30分钟内联系您，提供免费1对1演示和14天专业版试用。'});
      const footer = JSON.stringify({copyright:'© 2025 数序科技 All Rights Reserved',icp:'浙ICP备2025000000号',phone:'400-888-0000',email:'contact@qianniu-erp.cc',wechatQr:'https://img.icons8.com/color/96/weixing.png',address:'浙江省杭州市余杭区未来科技城'});
      const seo = JSON.stringify({title:'数序跨境ERP - 一站式跨境电商智能管理平台',keywords:'跨境ERP,电商ERP,亚马逊ERP,Temu ERP,Shein ERP,库存管理,订单管理,财务利润',description:'数序跨境ERP覆盖全球70+电商平台，支持智能审单、库存闭环、财务全自动核算与AI辅助决策，助力跨境卖家降本增效。'});
      await pool.query(
        'INSERT INTO landing_configs (site_name,banner_json,advantage_json,features_json,plans_json,cases_json,compare_json,apply_json,footer_json,seo_json) VALUES (?,?,?,?,?,?,?,?,?,?)',
        ['数序跨境ERP',banner,advantage,features,plans,cases,compare,apply,footer,seo]
      );
      console.log('✅ 默认 landing_config 写入完成');
    }
    // 检查终版表列数
    for (const t of ['landing_configs','site_applications','media_assets','tenant_subscriptions','billing_orders','billing_records']) {
      try {
        const [rs] = await pool.query(`SHOW COLUMNS FROM ${t}`);
        console.log(`  ✅ ${t}: ${rs.length} 列`);
      } catch (e) {
        console.log(`  ❌ ${t}: 表不存在或报错:`, e.message);
      }
    }
  } finally {
    pool.end();
  }
})().catch(e => { console.error('SEED ERR:', e); process.exit(1); });
'''
    sftp.open('/opt/shuxu-erp/backend/seed-landing.js', 'w').write(seed_js)
    run(cli, "cd /opt/shuxu-erp/backend && node seed-landing.js 2>&1", timeout=25)

    # 4. 重启服务
    print("\n🔄 4. 重启服务")
    print("="*60)
    run(cli, "sudo systemctl restart shuxu-erp", sudo=True)
    time.sleep(5)
    run(cli, "sudo systemctl status shuxu-erp --no-pager -n 12", sudo=True)

    # 5. 验证API
    print("\n🧪 5. API 验证")
    print("="*60)
    for i in range(8):
        time.sleep(1)
        rc, out, _ = run(cli, "curl -sS -m 4 http://127.0.0.1:8090/api/health 2>&1")
        if "ok" in out:
            log("🎉 健康检查通过:", out.strip())
            break
        log(f"等待... {i+1}/8")
    else:
        log("❌ 仍不通，手动启动看错误:")
        run(cli, "cd /opt/shuxu-erp/backend && timeout 10 node src/app.js 2>&1; echo EXIT=$?", timeout=15)
        return

    # 验证官网配置
    run(cli, '''curl -sS -m 6 http://127.0.0.1:8090/api/v1/public/landing/config 2>&1 | node -e "const d=require('fs').readFileSync(0,'utf8');const j=JSON.parse(d);console.log('ready=',j.ready,'siteName=',j.siteName,'\\n banner=',j.banner.length,' advantage=',j.advantage.length,' features=',j.features.length,'\\n plans=',j.plans.length,' cases=',j.cases.length,' compare=',j.compare.length);"''')

    # 域名级验证
    import urllib.request
    try:
        with urllib.request.urlopen('https://qianniu-erp.cc/api/health', timeout=8) as r:
            body = r.read().decode()
            log('🌐 域名API健康:', body.strip())
    except Exception as e:
        log('🌐 域名API失败:', e)

    sftp.close()
    cli.close()

if __name__ == "__main__":
    main()
