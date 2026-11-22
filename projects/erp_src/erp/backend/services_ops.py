"""扩展业务引擎：采购入库 / WMS 仓内作业 / 售后 / 财务对账与利润"""
import random
import string
from datetime import datetime, timedelta
from sqlalchemy import func
from .models import (Inventory, Order, OrderItem, Product, Shop, StockLedger, Warehouse,
                     Platform, Carrier)
from .models_ops import (AfterSale, AfterSaleItem, ApAr, BillFee, Location, PackCheck,
                         PickTask, PickWave, PlatformBill, ProfitRecord, PurchaseItem,
                         PurchaseOrder, PurchaseReturn, Receipt, StockBatch, Stocktake,
                         StocktakeItem, Supplier, Transfer)


def gen(prefix, n=6):
    return f"{prefix}{datetime.now().strftime('%y%m%d')}{''.join(random.choices(string.digits, k=n))}"


# ==================== 采购 ====================
def receive_purchase(db, po_id, operator="仓管"):
    """采购到货入库：生成入库单 → 质检 → 增加实物库存与批次 → 更新采购单状态。"""
    po = db.get(PurchaseOrder, po_id)
    if not po:
        return {"ok": False, "msg": "采购单不存在"}
    if po.status in ("received", "cancelled"):
        return {"ok": False, "msg": f"采购单状态为 {po.status}，不可收货"}
    items = db.query(PurchaseItem).filter_by(po_id=po.id).all()
    rc_no = gen("RC")
    total_qty = 0
    for it in items:
        arr = it.qty - it.received_qty
        if arr <= 0:
            continue
        inv = db.query(Inventory).filter_by(warehouse_id=po.warehouse_id,
                                            product_id=it.product_id).first()
        if not inv:
            inv = Inventory(warehouse_id=po.warehouse_id, product_id=it.product_id)
            db.add(inv); db.flush()
        before = inv.available
        inv.on_hand += arr
        inv.inbound = max((inv.inbound or 0) - arr, 0)
        db.add(StockLedger(warehouse_id=po.warehouse_id, product_id=it.product_id,
                           change_type="purchase", qty_change=arr,
                           before_available=before, after_available=inv.available,
                           ref_type="receipt", ref_no=rc_no, operator=operator))
        db.add(StockBatch(warehouse_id=po.warehouse_id, product_id=it.product_id,
                          batch_no=f"B{rc_no[-6:]}{it.id}", qty=arr,
                          cost_price=it.price, produced_at=datetime.now(),
                          expire_at=datetime.now() + timedelta(days=random.randint(180, 720))))
        it.received_qty += arr
        total_qty += arr
    db.add(Receipt(rc_no=rc_no, po_id=po.id, warehouse_id=po.warehouse_id,
                   status="checked", qc_pass=True, operator=operator))
    po.status = "received"
    po.received_at = datetime.now()
    db.flush()
    return {"ok": True, "rc_no": rc_no, "qty": total_qty, "msg": f"入库成功，共 {total_qty} 件"}


def purchase_return(db, po_id, product_id, qty, reason="来料不良"):
    po = db.get(PurchaseOrder, po_id)
    p = db.get(Product, product_id)
    inv = db.query(Inventory).filter_by(warehouse_id=po.warehouse_id, product_id=product_id).first()
    if not inv or inv.on_hand < qty:
        return {"ok": False, "msg": "库存不足，无法退货"}
    before = inv.available
    inv.on_hand -= qty
    db.add(StockLedger(warehouse_id=po.warehouse_id, product_id=product_id,
                       change_type="return_out", qty_change=-qty,
                       before_available=before, after_available=inv.available,
                       ref_type="purchase_return", ref_no=po.po_no))
    price = db.query(PurchaseItem).filter_by(po_id=po_id, product_id=product_id).first()
    amt = (price.price if price else p.cost_price) * qty
    db.add(PurchaseReturn(rt_no=gen("PR"), po_id=po_id, product_id=product_id,
                          qty=qty, amount=amt, reason=reason, status="done"))
    db.add(ApAr(direction="ar", partner_type="supplier", partner_id=po.supplier_id,
                partner_name=db.get(Supplier, po.supplier_id).name,
                ref_no=po.po_no, amount=amt, status="open",
                due_date=datetime.now() + timedelta(days=30)))
    db.flush()
    return {"ok": True, "amount": amt, "msg": f"退货 {qty} 件，形成应收 ¥{amt:.2f}"}


# ==================== WMS 仓内作业 ====================
def create_wave(db, warehouse_id, order_ids, strategy="摘果式"):
    """生成拣货波次：把待发货订单聚合成一个波次，按库位排序生成拣货任务。"""
    orders = [db.get(Order, i) for i in order_ids]
    orders = [o for o in orders if o and o.status == "waiting" and o.warehouse_id == warehouse_id]
    if not orders:
        return {"ok": False, "msg": "所选订单中没有该仓的待发货订单"}
    w = PickWave(wave_no=gen("WV"), warehouse_id=warehouse_id, strategy=strategy,
                 order_count=len(orders), status="created")
    db.add(w); db.flush()
    qty_total, skus = 0, set()
    for o in orders:
        for it in db.query(OrderItem).filter_by(order_id=o.id).all():
            loc = (db.query(Location).filter_by(warehouse_id=warehouse_id).first())
            db.add(PickTask(wave_id=w.id, order_id=o.id, product_id=it.product_id,
                            sku=it.sku, name=it.name,
                            location_code=f"{loc.code if loc else 'A-01-01'}",
                            qty=it.qty, status="pending"))
            qty_total += it.qty
            skus.add(it.product_id)
    w.qty_total = qty_total
    w.sku_count = len(skus)
    db.flush()
    return {"ok": True, "wave_no": w.wave_no, "wave_id": w.id,
            "orders": len(orders), "qty": qty_total, "skus": len(skus),
            "msg": f"波次 {w.wave_no} 已生成：{len(orders)} 单 / {qty_total} 件 / {len(skus)} SKU"}


def pick_wave(db, wave_id, picker="拣货员"):
    """执行拣货：逐条任务拣货，缺货标记 short。"""
    w = db.get(PickWave, wave_id)
    if not w:
        return {"ok": False, "msg": "波次不存在"}
    tasks = db.query(PickTask).filter_by(wave_id=wave_id).all()
    short = 0
    for t in tasks:
        inv = db.query(Inventory).filter_by(warehouse_id=w.warehouse_id,
                                            product_id=t.product_id).first()
        avail = inv.available if inv else 0
        if avail >= t.qty:
            t.picked_qty = t.qty
            t.status = "picked"
        else:
            t.picked_qty = max(avail, 0)
            t.status = "short"
            short += 1
    w.status = "picking"
    w.picker = picker
    db.flush()
    return {"ok": True, "tasks": len(tasks), "short": short,
            "msg": f"拣货完成 {len(tasks) - short}/{len(tasks)} 条，缺货 {short} 条"}


def pack_weigh(db, order_id, wave_id, weight_kg, operator="验货员"):
    """验货称重：记录实重，按实重重算运费，返回结果。"""
    o = db.get(Order, order_id)
    if not o:
        return {"ok": False, "msg": "订单不存在"}
    o.weight_kg = weight_kg
    c = db.get(Carrier, o.carrier_id) if o.carrier_id else db.query(Carrier).first()
    if c:
        o.carrier_id = c.id
        o.freight = round(float(c.base_fee) + weight_kg * float(c.per_kg_fee), 2)
    db.add(PackCheck(order_id=order_id, wave_id=wave_id, weight_kg=weight_kg,
                     freight=o.freight, carrier_id=o.carrier_id,
                     waybill_no=o.waybill_no or "", result="pass", operator=operator))
    db.flush()
    return {"ok": True, "weight": weight_kg, "freight": o.freight,
            "msg": f"实重 {weight_kg}kg，运费重算为 ¥{o.freight:.2f}"}


def create_stocktake(db, warehouse_id, mode="明盘", limit=30, operator="仓管"):
    """生成盘点单：按当前账面库存快照生成明细，暗盘隐藏账面数。"""
    invs = (db.query(Inventory).filter_by(warehouse_id=warehouse_id)
            .order_by(Inventory.on_hand.desc()).limit(limit).all())
    if not invs:
        return {"ok": False, "msg": "该仓无库存"}
    st = Stocktake(st_no=gen("ST"), warehouse_id=warehouse_id, mode=mode,
                   status="counting", sku_count=len(invs), operator=operator)
    db.add(st); db.flush()
    for inv in invs:
        p = db.get(Product, inv.product_id)
        loc = db.query(Location).filter_by(warehouse_id=warehouse_id).first()
        db.add(StocktakeItem(st_id=st.id, product_id=inv.product_id,
                             sku=p.sku, name=p.name,
                             location_code=loc.code if loc else "A-01-01",
                             book_qty=inv.on_hand, real_qty=inv.on_hand,
                             cost_price=p.cost_price))
    db.flush()
    return {"ok": True, "st_no": st.st_no, "st_id": st.id, "skus": len(invs),
            "msg": f"盘点单 {st.st_no} 已生成，共 {len(invs)} 个 SKU"}


def submit_stocktake(db, st_id):
    """提交盘点：计算差异，按差异调整实物库存并生成损益。"""
    st = db.get(Stocktake, st_id)
    items = db.query(StocktakeItem).filter_by(st_id=st_id).all()
    diff_qty, diff_amount = 0, 0
    for it in items:
        d = it.diff
        if d == 0:
            continue
        inv = db.query(Inventory).filter_by(warehouse_id=st.warehouse_id,
                                            product_id=it.product_id).first()
        if inv:
            before = inv.available
            inv.on_hand = max(inv.on_hand + d, 0)
            db.add(StockLedger(warehouse_id=st.warehouse_id, product_id=it.product_id,
                               change_type="adjust", qty_change=d,
                               before_available=before, after_available=inv.available,
                               ref_type="stocktake", ref_no=st.st_no, operator=st.operator))
        diff_qty += d
        diff_amount += d * (it.cost_price or 0)
    st.diff_qty, st.diff_amount = diff_qty, round(diff_amount, 2)
    st.status = "done"
    db.flush()
    return {"ok": True, "diff_qty": diff_qty, "diff_amount": round(diff_amount, 2),
            "msg": f"盘点完成：差异 {diff_qty:+d} 件，损益 ¥{diff_amount:+.2f}"}


def do_transfer(db, from_wid, to_wid, product_id, qty, operator="仓管"):
    src = db.query(Inventory).filter_by(warehouse_id=from_wid, product_id=product_id).first()
    if not src or src.available < qty:
        return {"ok": False, "msg": "调出仓可用库存不足"}
    tf_no = gen("TF")
    src.on_hand -= qty
    db.add(StockLedger(warehouse_id=from_wid, product_id=product_id,
                       change_type="transfer_out", qty_change=-qty,
                       before_available=src.available, after_available=src.available,
                       ref_type="transfer", ref_no=tf_no, operator=operator))
    dst = db.query(Inventory).filter_by(warehouse_id=to_wid, product_id=product_id).first()
    if not dst:
        dst = Inventory(warehouse_id=to_wid, product_id=product_id)
        db.add(dst); db.flush()
    dst.on_hand += qty
    db.add(StockLedger(warehouse_id=to_wid, product_id=product_id,
                       change_type="transfer_in", qty_change=qty,
                       before_available=dst.available, after_available=dst.available,
                       ref_type="transfer", ref_no=tf_no, operator=operator))
    db.add(Transfer(tf_no=tf_no, from_warehouse_id=from_wid, to_warehouse_id=to_wid,
                    product_id=product_id, qty=qty, status="received", operator=operator))
    db.flush()
    return {"ok": True, "tf_no": tf_no, "msg": f"调拨 {qty} 件完成"}


# ==================== 售后 ====================
def create_after_sale(db, order_id, atype, reason, amount=0):
    o = db.get(Order, order_id)
    if not o:
        return {"ok": False, "msg": "订单不存在"}
    items = db.query(OrderItem).filter_by(order_id=order_id).all()
    amt = amount or sum(i.price * i.qty for i in items)
    a = AfterSale(as_no=gen("AS"), order_id=order_id, order_no=o.order_no,
                  shop_id=o.shop_id, buyer_nick=o.buyer_nick, atype=atype,
                  reason=reason, amount=round(amt, 2),
                  need_return=atype in ("return", "exchange"),
                  warehouse_id=o.warehouse_id, status="pending")
    db.add(a); db.flush()
    for i in items:
        db.add(AfterSaleItem(as_id=a.id, product_id=i.product_id, sku=i.sku,
                             name=i.name, qty=i.qty, price=i.price))
    db.flush()
    return {"ok": True, "as_no": a.as_no, "as_id": a.id, "amount": round(amt, 2),
            "msg": f"售后单 {a.as_no} 已创建"}


def process_after_sale(db, as_id, action, handler="客服"):
    """处理售后：approve 同意 / reject 拒绝 / return_received 退货入库 / done 完成。"""
    a = db.get(AfterSale, as_id)
    if not a:
        return {"ok": False, "msg": "售后单不存在"}
    a.handler = handler
    if action == "approve":
        a.status = "approved"
        msg = "已同意售后，等待处理"
    elif action == "reject":
        a.status = "rejected"
        msg = "已拒绝售后申请"
    elif action == "return_received":
        a.returned = True
        a.status = "processing"
        if a.warehouse_id:
            for it in db.query(AfterSaleItem).filter_by(as_id=a.id).all():
                if it.quality == "good":
                    inv = db.query(Inventory).filter_by(warehouse_id=a.warehouse_id,
                                                        product_id=it.product_id).first()
                    if inv:
                        before = inv.available
                        inv.on_hand += it.qty
                        db.add(StockLedger(warehouse_id=a.warehouse_id,
                                           product_id=it.product_id,
                                           change_type="return_in", qty_change=it.qty,
                                           before_available=before,
                                           after_available=inv.available,
                                           ref_type="aftersale", ref_no=a.as_no,
                                           operator=handler))
            a.restock = True
        msg = "退货已入库，良品已重新上架"
    elif action == "done":
        a.status = "done"
        a.finished_at = datetime.now()
        o = db.get(Order, a.order_id)
        if o and o.status == "shipped":
            o.status = "cancelled"
            o.audit_msg = f"已售后完成（{a.as_no}）"
        db.add(ApAr(direction="ap", partner_type="customer", partner_id=a.shop_id,
                    partner_name=a.buyer_nick, ref_no=a.as_no,
                    amount=a.amount, settled_amount=a.amount, status="closed"))
        msg = f"售后完成，退款 ¥{a.amount:.2f}"
    else:
        return {"ok": False, "msg": "未知操作"}
    db.flush()
    return {"ok": True, "msg": msg, "status": a.status}


# ==================== 财务与利润 ====================
FEE_RATE = {"taobao": 0.02, "tmall": 0.05, "jd": 0.06, "pdd": 0.006,
            "douyin": 0.05, "kuaishou": 0.05, "xhs": 0.05, "wxvideo": 0.03}


def calc_order_profit(db, order_id):
    """计算单笔订单利润：收入 - 商品成本 - 运费 - 平台费 - 广告分摊 - 包材。"""
    o = db.get(Order, order_id)
    if not o:
        return None
    items = db.query(OrderItem).filter_by(order_id=o.id).all()
    goods_cost = sum((db.get(Product, i.product_id).cost_price or 0) * i.qty for i in items)
    shop = db.get(Shop, o.shop_id)
    plat = db.get(Platform, shop.platform_id) if shop else None
    rate = FEE_RATE.get(plat.code if plat else "", 0.03)
    platform_fee = round(o.amount * rate, 2)
    ad_fee = round(o.amount * 0.04, 2)          # 广告按 4% 分摊（可配置）
    freight_cost = round(o.freight or 0, 2)
    pack_cost = round(2.5 * sum(i.qty for i in items), 2)
    gross = round(o.amount - goods_cost - freight_cost, 2)
    net = round(gross - platform_fee - ad_fee - pack_cost, 2)
    margin = round(net / o.amount, 4) if o.amount else 0
    r = ProfitRecord(order_no=o.order_no, shop_id=o.shop_id, order_id=o.id,
                     revenue=o.amount, goods_cost=round(goods_cost, 2),
                     freight_cost=freight_cost, platform_fee=platform_fee,
                     ad_fee=ad_fee, pack_cost=pack_cost,
                     gross_profit=gross, net_profit=net, margin=margin)
    db.add(r); db.flush()
    return r


def batch_calc_profit(db, limit=200):
    done = 0
    for o in db.query(Order).filter_by(status="shipped").limit(limit).all():
        exist = db.query(ProfitRecord).filter_by(order_no=o.order_no).first()
        if exist:
            continue
        calc_order_profit(db, o.id)
        done += 1
    db.flush()
    return done


def generate_bill(db, shop_id, period):
    """生成店铺月度平台账单：汇总已发货订单，按比例计算各项费用。"""
    s = db.get(Shop, shop_id)
    plat = db.get(Platform, s.platform_id) if s else None
    orders = db.query(Order).filter_by(shop_id=shop_id, status="shipped").all()
    if not orders:
        return {"ok": False, "msg": "该店铺暂无已发货订单"}
    order_amount = round(sum(o.amount for o in orders), 2)
    rate = FEE_RATE.get(plat.code if plat else "", 0.03)
    commission = round(order_amount * rate, 2)
    service_fee = round(order_amount * 0.005, 2)
    ad_fee = round(order_amount * 0.04, 2)
    refund = round(order_amount * 0.03, 2)
    freight = round(sum(o.freight or 0 for o in orders), 2)
    other = round(order_amount * 0.002, 2)
    settle = round(order_amount - commission - service_fee - ad_fee - refund - freight - other, 2)
    bill_no = f"BL{s.code.replace('-', '')}{period.replace('-', '')}"
    old = db.query(PlatformBill).filter_by(bill_no=bill_no).first()
    if old:
        db.query(BillFee).filter_by(bill_id=old.id).delete()
        db.delete(old); db.flush()
    b = PlatformBill(bill_no=bill_no, shop_id=shop_id,
                     platform_id=s.platform_id, period=period,
                     order_amount=order_amount, commission=commission,
                     service_fee=service_fee, ad_fee=ad_fee, refund_amount=refund,
                     freight_fee=freight, other_fee=other, settle_amount=settle,
                     status="pending")
    db.add(b); db.flush()
    for t, v in [("佣金", commission), ("服务费", service_fee), ("广告费", ad_fee),
                 ("退款", refund), ("运费", freight), ("其他", other)]:
        db.add(BillFee(bill_id=b.id, fee_type=t, amount=v,
                       remark=f"按 {t} 口径计入 {period}"))
    db.add(ApAr(direction="ar", partner_type="platform", partner_id=shop_id,
                partner_name=s.name, ref_no=bill_no, amount=settle,
                due_date=datetime.now() + timedelta(days=15)))
    db.flush()
    return {"ok": True, "bill_no": bill_no, "order_amount": order_amount,
            "settle": settle, "msg": f"账单 {bill_no} 已生成，应结算 ¥{settle:.2f}"}


def profit_summary(db):
    """经营利润汇总：按店铺维度。"""
    rows = []
    for s in db.query(Shop).all():
        rs = db.query(ProfitRecord).filter_by(shop_id=s.id).all()
        if not rs:
            continue
        rev = sum(r.revenue for r in rs)
        net = sum(r.net_profit for r in rs)
        rows.append({"shop": s.name, "platform": db.get(Platform, s.platform_id).name,
                     "orders": len(rs), "revenue": round(rev, 2),
                     "goods_cost": round(sum(r.goods_cost for r in rs), 2),
                     "platform_fee": round(sum(r.platform_fee for r in rs), 2),
                     "ad_fee": round(sum(r.ad_fee for r in rs), 2),
                     "gross": round(sum(r.gross_profit for r in rs), 2),
                     "net": round(net, 2),
                     "margin": round(net / rev, 4) if rev else 0})
    rows.sort(key=lambda x: -x["net"])
    return rows
