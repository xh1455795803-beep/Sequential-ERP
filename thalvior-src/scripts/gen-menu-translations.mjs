#!/usr/bin/env node
/**
 * 菜单翻译自动补全脚本
 * --------------------------------
 * 扫 menuConfig.ts 里所有菜单 key + label，对比 en-US.ts / ja-JP.ts 的 menu 字段，
 * 缺失的条目用 MyMemory 免费 API (api.mymemory.translated.net) 翻译后写入。
 *
 * 用法:
 *   node scripts/gen-menu-translations.mjs       # 正常联网翻译
 *   node scripts/gen-menu-translations.mjs --offline  # 只合并 zh-CN 缺失项到 EN/JA，不联网
 *
 * 挂到 package.json:
 *   "prebuild": "node scripts/gen-menu-translations.mjs"
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');

const USE_HTTP_PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.http_proxy || process.env.https_proxy;
const OFFLINE = process.argv.includes('--offline');

// ============================================================
// 1. 扫 menuConfig.ts 抓所有菜单 key + label
// ============================================================
function extractMenus() {
  const src = fs.readFileSync(path.join(ROOT, 'menu/menuConfig.ts'), 'utf8');
  const re = /key:\s*'([^']+)'[\s\S]*?label:\s*'([^']+)'/g;
  const menus = [];
  let m;
  while ((m = re.exec(src))) {
    menus.push({ key: m[1], zh: m[2] });
  }
  return menus;
}

// ============================================================
// 2. 读 locale 文件，解析 menu 字段里已有的 key
// ============================================================
function parseMenuBlock(content) {
  // 匹配 `menu: { ... },` 这个块，用它来知道有哪些 key 以及块起始/结束位置
  const re = /(\n?\s*menu:\s*\{)([\s\S]*?)(\n\s*\},)/;
  const match = content.match(re);
  if (!match) return null;
  // 抓现有条目
  const items = {};
  const itemRe = /^\s*"([^"]+)":\s*"([^"]*)",?\s*$/gm;
  let im;
  while ((im = itemRe.exec(match[2]))) {
    items[im[1]] = im[2];
  }
  return { header: match[1], items, body: match[2], footer: match[3], startIdx: match.index + match[1].length };
}

function rebuildMenuBlock(parsed, newEntries) {
  // 把 newEntries (数组, {key, val}) 追加到现有 items 后面
  const merged = { ...parsed.items };
  for (const e of newEntries) {
    if (!(e.key in merged)) merged[e.key] = e.val;
  }
  // 按 key 重新排序，保持稳定
  const keys = Object.keys(merged).sort();
  const lines = ['  menu: {'];
  for (const k of keys) {
    lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(merged[k])},`);
  }
  lines.push('  },');
  return lines.join('\n');
}

function writeMenuBlock(content, newBlock) {
  return content.replace(/\n?\s*menu:\s*\{[\s\S]*?\n\s*\},/, '\n' + newBlock);
}

// ============================================================
// 3. 联网翻译 (MyMemory) —— 可选，失败时 fallback 原中文
// ============================================================
async function translateBatch(texts, target) {
  // MyMemory 免费 API: 自动按语言检测
  // langpair: zh-CN|en / zh-CN|ja
  const langpair = target === 'en' ? 'zh-CN|en' : 'zh-CN|ja';
  const results = {};

  for (const txt of texts) {
    // 跳过中文里的纯技术词（如 "OAuth", "SKU", "Webhook", "ERP"）
    if (/^[\w\-\s()]+$/.test(txt) && !/[\u4e00-\u9fa5]/.test(txt)) {
      results[txt] = txt;
      continue;
    }
    if (OFFLINE) {
      results[txt] = txt;
      continue;
    }
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(txt)}&langpair=${langpair}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) { results[txt] = txt; continue; }
      const data = await resp.json();
      const translated = data?.responseData?.translatedText;
      results[txt] = translated || txt;
      // 礼貌性 sleep，免费 API 对高频有惩罚
      await new Promise((r) => setTimeout(r, 150));
    } catch {
      results[txt] = txt;
    }
  }
  return results;
}

// ============================================================
// 4. 手动翻译补全（当联网翻译不可用时兜底）
// ============================================================
const manualFallbackEn = {
  '首页总览': 'Overview',
  '待收款': 'Awaiting Payment', '已付款': 'Paid',
  '待出库': 'Awaiting Outbound', '待发货': 'Awaiting Shipment',
  '已发货': 'Shipped', '已完成': 'Completed',
  '已取消': 'Cancelled', '异常订单': 'Abnormal Orders',
  '售后单': 'After-sale Orders', '退款单': 'Refund Orders',
  '退货单': 'Return Orders', '纠纷单': 'Dispute Orders',
  '手工订单': 'Manual Order',
  '分仓规则': 'Split Rules', '审单规则': 'Review Rules',
  '打印发货': 'Print & Ship', '黑名单': 'Blacklist',
  '订单批量操作': 'Batch Order Ops',
  '全托管备货': 'Fully Managed Prep', '出库管理': 'Outbound Management',
  '托管报表': 'Custody Reports', '托管店铺管理': 'Custody Shops',
  '采购单': 'Purchase Orders', '采购入库': 'Purchase Inbound',
  '采购退货': 'Purchase Return', '采购对账': 'Purchase Reconciliation',
  '仓库设置': 'Warehouse Settings',
  '自营仓库': 'Self Warehouse', '第三方仓库': '3PL Warehouse',
  '平台仓绑定': 'Platform Bindings', '仓库管理': 'Warehouse Management',
  '库存清单': 'Inventory List', '出入库记录': 'Stock Records',
  '入库记录': 'Inbound Records', '出库记录': 'Outbound Records',
  '调拨记录': 'Transfer Records', '盘点记录': 'Stocktaking Records',
  '库存调拨': 'Inventory Transfer', '库存盘点': 'Stocktaking',
  '库存预警': 'Low Stock Alerts', '货架库位管理': 'Shelf/Location Mgmt',
  '包材管理': 'Packaging Materials', '库存同步设置': 'Stock Sync Settings',
  '物流分拨': 'Logistics Dispatch', '物流渠道': 'Shipping Channels',
  '运费模板': 'Freight Templates', '货代管理': 'Forwarder Management',
  '打印模板': 'Print Templates', '面单打印': 'Waybill Print',
  '物流匹配规则': 'Logistics Match Rules', '物流轨迹查询': 'Track Query',
  '海关申报': 'Customs Declaration', '申报模板': 'Declaration Templates',
  '报关资料管理': 'Declaration Documents',
  '广告运营': 'Ads Operations', '广告数据': 'Ads Data',
  '广告报表': 'Ads Reports', '广告投放记录': 'Ads History',
  '店铺活动管理': 'Shop Promotions',
  '财务管理': 'Finance Management', '利润报表': 'Profit Reports',
  '平台对账': 'Platform Reconciliation', '费用流水': 'Fee Ledger',
  '汇率管理': 'Exchange Rates', '成本核算': 'Cost Accounting',
  '回款记录': 'Payment Records', '扣款明细': 'Deduction Details',
  '财务记账': 'Bookkeeping', '记账总览': 'Bookkeeping Overview',
  '会计科目': 'Chart of Accounts', '记账凭证': 'Vouchers',
  '余额对账': 'Balance Reconciliation', '科目余额表': 'Trial Balance',
  '利润表': 'Income Statement',
  '营销中心': 'Marketing Center', '优惠券': 'Coupons',
  '数据中心': 'Data Center', '运营总览': 'Operations Overview',
  'BI 数据看板': 'BI Dashboard', '商品数据分析': 'Product Analytics',
  '店铺统计': 'Shop Stats', '销售报表': 'Sales Reports',
  '流量分析': 'Traffic Analysis', '实时大屏': 'Realtime Big Screen',
  '利润分析': 'Profit Analysis',
  '系统设置': 'System Settings', '子账号管理': 'Sub Accounts',
  '角色权限': 'Roles & Permissions', '全局参数': 'Global Parameters',
  '通知设置': 'Notification Settings', '导入导出中心': 'Import/Export Center',
  '数据同步中心': 'Data Sync Center', '操作日志': 'Operation Logs',
  '审计日志': 'Audit Logs', '数据备份': 'Data Backup',
  '定时任务': 'Scheduled Tasks', 'Webhook': 'Webhook',
  '邀请分销': 'Invite to Distribute', '租户隔离': 'Tenant Isolation',
  '审批中心': 'Approval Center', '订阅与账单': 'Subscription & Billing',
  '套餐信息': 'Plan Info', '消费记录': 'Consumption Records',
  '续费升级': 'Renew/Upgrade',
};

const manualFallbackJa = {
  '工作台': 'ダッシュボード', '授权中心': '認証センター',
  '产品管理': '商品管理', '订单管理': '受注管理',
  '消息中心': 'メッセージセンター', '托管管理': '受托管理',
  '采购管理': '購買管理', '仓库管理': '倉庫管理',
  '物流分拨': '物流仕分', '广告运营': '広告運用',
  '财务管理': '財務管理', '营销中心': 'マーケティング',
  '数据中心': 'データセンター', '系统设置': 'システム設定',
  '首页总览': '概要', '待办中心': 'Todoセンター', '业务提醒': '業務アラート', '数据看板': 'データカンバン',
  '店铺列表': '店舗一覧', '店铺分组': '店舗グループ', '平台管理': 'プラットフォーム管理',
  '授权日志': '認証ログ', '接口同步日志': 'API同期ログ', '任务列表': 'タスク一覧', '平台同步中心': 'プラットフォーム同期',
  '授权新店铺': '新規店舗認証', '一键授权 (OAuth)': 'ワンクリックOAuth', '手动授权 (凭证)': '手動認証',
  '内部SKU库': '内部SKUライブラリ', 'SKU列表': 'SKU一覧', 'SKU组合': 'SKUコンボ', 'SKU映射': 'SKUマッピング',
  '公用采集箱': '共通収集ボックス', '平台采集箱': 'プラットフォーム収集',
  '在线商品管理': 'オンライン商品管理', '在售商品': '販売中', '下架商品': '下架', '违规商品': '違反商品', '商品同步记录': '商品同期履歴',
  '发布记录': '公開履歴', '定价模板': '価格テンプレート', '产品模板': '商品テンプレート', '图片素材库': '画像ライブラリ',
  '文件中心': 'ファイルセンター', '采集设置': '収集設定', '批量操作': '一括操作', '商品搬家': '商品移行',
  'AI工具': 'AIツール', 'AI选品': 'AI選品', 'AI翻译': 'AI翻訳', 'AI标题优化': 'AIタイトル最適化', 'AI关键词挖掘': 'AIキーワード抽出',
  '订单列表': '受注一覧', '订单处理': '受注処理',
  '待收款': '入金待ち', '已付款': '入金済み', '待出库': '出庫待ち', '待发货': '発送待ち',
  '已发货': '発送済み', '已完成': '完了', '已取消': 'キャンセル', '异常订单': '異常受注',
  '售后单': 'アフターサービス', '退款单': '返金依頼', '退货单': '返品依頼', '纠纷单': '紛争依頼',
  '手工订单': '手動受注', '分仓规则': '倉庫分割ルール', '审单规则': '受注審査ルール',
  '打印发货': '印刷・発送', '黑名单': 'ブラックリスト', '订单批量操作': '一括受注操作',
  '全部消息': '全メッセージ', '未读消息': '未読メッセージ',
  '全托管备货': 'フル受托在庫', '出库管理': '出庫管理', '托管报表': '受托レポート', '托管店铺管理': '受托店舗管理',
  '供应商管理': '仕入先管理', '采购计划': '購買計画', '采购单': '購買発注', '采购入库': '購買入庫', '采购退货': '購買返品',
  '1688货源对接': '1688調達', '采购对账': '購買照合',
  '自营仓库': '自社倉庫', '第三方仓库': '3PL倉庫', '平台仓绑定': 'プラットフォーム紐付け',
  '库存清单': '在庫一覧', '出入库记录': '入出庫記録', '入库记录': '入庫記録', '出库记录': '出庫記録',
  '调拨记录': '移動記録', '盘点记录': '棚卸記録',
  '库存调拨': '在庫移動', '库存盘点': '棚卸', '库存预警': '在庫アラート', '货架库位管理': '棚・ロケーション管理',
  '包材管理': '包材管理', '库存同步设置': '在庫同期設定',
  '物流渠道': '物流チャネル', '运费模板': '送料テンプレート', '货代管理': 'フォワーダー管理', '打印模板': '印刷テンプレート',
  '面单打印': '送り状印刷', '物流匹配规则': '物流マッチルール', '物流轨迹查询': '追跡照会',
  '海关申报': '通関申告', '申报模板': '申告テンプレート', '报关资料管理': '通関資料管理',
  '广告数据': '広告データ', '广告报表': '広告レポート', '广告投放记录': '広告配信履歴', '店铺活动管理': '店舗プロモーション',
  '利润报表': '利益レポート', '平台对账': 'プラットフォーム照合', '费用流水': '費用明細', '汇率管理': '為替管理',
  '成本核算': '原価計算', '回款记录': '入金記録', '扣款明细': '控除明細',
  '财务记账': '会計', '记账总览': '会計概要', '会计科目': '勘定科目', '记账凭证': '伝票',
  '余额对账': '残高照合', '科目余额表': '試算表', '利润表': '損益計算書',
  '优惠券': 'クーポン',
  '运营总览': '運営概要', 'BI 数据看板': 'BIダッシュボード', '商品数据分析': '商品分析', '店铺统计': '店舗統計',
  '销售报表': '販売レポート', '流量分析': 'トラフィック分析', '实时大屏': 'リアルタイムビッグスクリーン', '利润分析': '利益分析',
  '子账号管理': 'サブアカウント', '角色权限': 'ロール権限', '全局参数': 'グローバルパラメータ', '通知设置': '通知設定',
  '导入导出中心': 'インポート/エクスポート', '数据同步中心': 'データ同期', '操作日志': '操作ログ', '审计日志': '監査ログ',
  '数据备份': 'データバックアップ', '定时任务': '定时タスク', 'Webhook': 'Webhook',
  '邀请分销': '招待・販売代理', '租户隔离': 'テナント分離', '审批中心': '承認センター',
  '订阅与账单': 'サブスク・請求', '套餐信息': 'プラン情報', '消费记录': '利用履歴', '续费升级': '更新/アップグレード',
};

function getManualFallback(target) {
  return target === 'en' ? manualFallbackEn : manualFallbackJa;
}

// ============================================================
// 5. 主流程
// ============================================================
async function main() {
  const menus = extractMenus();
  console.log(`📖 Scanned ${menus.length} menu entries from menuConfig.ts`);
  if (OFFLINE) console.log('🔌 OFFLINE mode — no network translation');
  else console.log('🌐 Online translation enabled via MyMemory');
  if (USE_HTTP_PROXY) console.log('  proxy:', USE_HTTP_PROXY);

  // 先把 zh-CN 的 menu 补全（它就是 label 原文，100% 可靠）
  const zhFile = path.join(ROOT, 'i18n/locales/zh-CN.ts');
  let zhContent = fs.readFileSync(zhFile, 'utf8');
  const zhParsed = parseMenuBlock(zhContent);
  const zhMissing = menus.filter((m) => !(m.key in zhParsed.items));
  if (zhMissing.length) {
    const newBlock = rebuildMenuBlock(zhParsed, zhMissing.map((m) => ({ key: m.key, val: m.zh })));
    zhContent = writeMenuBlock(zhContent, newBlock);
    fs.writeFileSync(zhFile, zhContent);
    console.log(`  ✅ zh-CN: +${zhMissing.length} entries filled (from label itself)`);
  } else {
    console.log(`  ✅ zh-CN: already complete`);
  }

  // EN / JA
  for (const [target, file] of [['en', 'i18n/locales/en-US.ts'], ['ja', 'i18n/locales/ja-JP.ts']]) {
    const fp = path.join(ROOT, file);
    let content = fs.readFileSync(fp, 'utf8');
    const parsed = parseMenuBlock(content);
    const missing = menus.filter((m) => !(m.key in parsed.items));
    if (!missing.length) {
      console.log(`  ✅ ${target.toUpperCase()}: already complete (${Object.keys(parsed.items).length} entries)`);
      continue;
    }

    // 先塞手动 fallback
    const manual = getManualFallback(target);
    const newEntries = missing.map((m) => ({
      key: m.key,
      val: manual[m.zh] || m.zh,
    }));

    // 再对没有手动 fallback 的条目标出来联网译
    const needOnline = newEntries.filter((e) => e.val === e.key.replace(/^[^.]+\./, '') && OFFLINE === false);
    // 实际上上面判断不准，简化：先把没有在 manual 里找到的（即 val 还是 m.zh 的）标记出来
    const needOnlineIdx = newEntries
      .map((e, i) => (manual[menus[menus.findIndex((mm) => mm.key === e.key)].zh] ? -1 : i))
      .filter((i) => i >= 0);

    if (needOnlineIdx.length) {
      console.log(`  🌐 ${target.toUpperCase()}: ${needOnlineIdx.length} entries need online translation`);
      const texts = needOnlineIdx.map((i) => menus[menus.findIndex((mm) => mm.key === newEntries[i].key)].zh);
      const translations = await translateBatch(texts, target);
      for (const origIdx of needOnlineIdx) {
        const zhLabel = menus.find((mm) => mm.key === newEntries[origIdx].key).zh;
        newEntries[origIdx].val = translations[zhLabel] || zhLabel;
      }
    }

    const newBlock = rebuildMenuBlock(parsed, newEntries);
    content = writeMenuBlock(content, newBlock);
    fs.writeFileSync(fp, content);
    console.log(`  ✅ ${target.toUpperCase()}: +${newEntries.length} new entries`);
  }

  console.log('\n🎉 Done. All menu translations are up to date.');
  console.log('   Tip: 新增菜单后再跑一次 `npm run i18n:menu` 即可自动补全。');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
