// 一次性 patch 脚本：给 orders.js / purchases.js 的库存 UPDATE 注入 ledger 流水写入
// 用法: node src/patch-ledger.js           (dry-run，仅报告)
//       node src/patch-ledger.js --apply   (真写)
// 安全：精确字符串匹配，找不到则跳过，不破坏原逻辑
const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const ORDERS = path.join(BASE, 'routes/orders.js');
const PURCHASES = path.join(BASE, 'routes/purchases.js');
const APPLY = process.argv.includes('--apply');

function patch(file, patches) {
  let src = fs.readFileSync(file, 'utf8');
  let changed = 0;
  for (const [name, anchor, inject] of patches) {
    const idx = src.indexOf(anchor);
    if (idx === -1) { console.warn(`[SKIP] ${name}: 锚点未找到`); continue; }
    if (src.indexOf(inject.trim().slice(0, 60), idx) !== -1) { console.warn(`[SKIP] ${name}: 已注入过`); continue; }
    const insertAt = idx + anchor.length;
    src = src.slice(0, insertAt) + '\n' + inject + src.slice(insertAt);
    changed++;
    console.log(`[PATCH] ${name}`);
  }
  // 顶部 require ledger（若缺）
  if (changed > 0 && !/require\(['"]\.\.\/inventory-ledger['"]\)/.test(src)) {
    const firstReq = src.indexOf("require('");
    const lineEnd = src.indexOf('\n', firstReq);
    src = src.slice(0, lineEnd + 1) + "const ledger = require('../inventory-ledger');\n" + src.slice(lineEnd + 1);
    console.log('[PATCH] 注入 require ledger');
  }
  if (changed === 0) { console.log('[DONE] 无需改动'); return; }
  if (APPLY) {
    fs.writeFileSync(file, src);
    console.log(`[WRITE] ${file} (${changed} 处)`);
  } else {
    console.log(`[DRY-RUN] ${changed} 处待注入（加 --apply 真写）`);
  }
}

// orders.js 三处库存变动
patch(ORDERS, [
  ['orders.reserve(创建预占)',
    `        await conn.query(
          "UPDATE inventory SET qty_reserved = qty_reserved + ? WHERE tenant_id = ? AND product_id = ? AND warehouse = 'MAIN'",
          [it.qty, req.user.tenantId, it.product_id]
        );`,
    `        await ledger.record(conn, { tenantId: req.user.tenantId, productId: it.product_id, warehouse: 'MAIN', changeType: 'reserve', qtyChange: it.qty, qtyBefore: inv[0].qty_reserved, qtyAfter: inv[0].qty_reserved + it.qty, balanceField: 'reserved', refType: 'order', refId: r.insertId, operator: req.user.username, remark: '订单创建预占' });`],
  ['orders.outbound(发货出库)',
    `          await conn.query(
            "UPDATE inventory SET qty_on_hand = qty_on_hand - ?, qty_reserved = qty_reserved - ? WHERE id = ?",
            [it.qty, it.qty, inv[0].id]
          );`,
    `          await ledger.record(conn, { tenantId: req.user.tenantId, productId: it.product_id, warehouse: 'MAIN', changeType: 'outbound', qtyChange: -it.qty, qtyBefore: inv[0].qty_on_hand, qtyAfter: inv[0].qty_on_hand - it.qty, balanceField: 'on_hand', refType: 'order', refId: o.id, operator: req.user.username, remark: '订单发货出库' });`],
  ['orders.release(取消释放)',
    `          await conn.query(
            "UPDATE inventory SET qty_reserved = qty_reserved - ? WHERE tenant_id = ? AND product_id = ? AND warehouse = 'MAIN'",
            [it.qty, req.user.tenantId, it.product_id]
          );`,
    `          await ledger.record(conn, { tenantId: req.user.tenantId, productId: it.product_id, warehouse: 'MAIN', changeType: 'release', qtyChange: -it.qty, qtyBefore: 0, qtyAfter: 0, balanceField: 'reserved', refType: 'order', refId: o.id, operator: req.user.username, remark: '订单取消释放' });`],
]);

// purchases.js 一处采购入库
patch(PURCHASES, [
  ['purchases.inbound(采购入库)',
    `        await conn.query(
          "UPDATE inventory SET qty_on_hand = qty_on_hand + ? WHERE id = ?",
          [it.qty, inv[0].id]
        );`,
    `        await ledger.record(conn, { tenantId: req.user.tenantId, productId: it.product_id, warehouse: 'MAIN', changeType: 'inbound', qtyChange: it.qty, qtyBefore: 0, qtyAfter: 0, balanceField: 'on_hand', refType: 'purchase', refId: parseInt(req.params.id, 10), operator: req.user.username, remark: '采购入库' });`],
]);

console.log('\n[patch-ledger] 完成');
