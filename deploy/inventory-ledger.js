// 库存变动流水写入器：在事务内与库存 UPDATE 同事务写入，保证流水与余额一致
// change_type: inbound(入库) outbound(出库) reserve(预占) release(释放) adjust(调整) transfer(调拨)
// balance_field: on_hand / reserved
// 调用: await ledger.record(conn, { tenantId, productId, warehouse, changeType, qtyChange, qtyBefore, qtyAfter, balanceField, refType, refId, operator, remark })
const { query } = require('./db');

/**
 * 记录单条库存流水。必须在 withTransaction 的 conn 上下文内调用。
 * @param conn  事务连接
 * @param opts  见上注释
 */
async function record(conn, opts) {
  const o = opts || {};
  await conn.query(
    `INSERT INTO inventory_transactions
     (tenant_id, product_id, warehouse, change_type, qty_change, qty_before, qty_after, balance_field, ref_type, ref_id, operator, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      o.tenantId, o.productId, o.warehouse || 'MAIN',
      o.changeType, o.qtyChange,
      o.qtyBefore ?? 0, o.qtyAfter ?? 0,
      o.balanceField || 'on_hand',
      o.refType || null, o.refId || null,
      o.operator || 'system', o.remark || null
    ]
  );
}

/**
 * 批量查租户流水（带分页/过滤）
 */
async function list(tenantId, { productId, changeType, refType, refId, page = 1, size = 50 } = {}) {
  const where = ['tenant_id = ?'];
  const params = [tenantId];
  if (productId) { where.push('product_id = ?'); params.push(productId); }
  if (changeType) { where.push('change_type = ?'); params.push(changeType); }
  if (refType) { where.push('ref_type = ?'); params.push(refType); }
  if (refId) { where.push('ref_id = ?'); params.push(refId); }
  const offset = (Math.max(1, page) - 1) * size;
  const rows = await query(
    `SELECT t.*, p.sku, p.name FROM inventory_transactions t
     LEFT JOIN products p ON p.tenant_id = t.tenant_id AND p.id = t.product_id
     WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  const [{ c }] = await query(
    `SELECT COUNT(*) AS c FROM inventory_transactions WHERE ${where.join(' AND ')}`,
    params
  );
  return { items: rows, total: c, page, size };
}

module.exports = { record, list };
