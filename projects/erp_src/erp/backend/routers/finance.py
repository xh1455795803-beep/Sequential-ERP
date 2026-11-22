from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import (Carrier, Inventory, OpLog, Order, OrderItem, Platform, Product,
                      Shop, ShopListing, StockLedger, Warehouse)
from ..models_ops import (AfterSale, AfterSaleItem, ApAr, BillFee, PickWave, PlatformBill,
                          ProfitRecord, PurchaseOrder, Stocktake, Supplier)
from .. import services as svc
from .. import services_ops as ops

router = APIRouter(prefix="/api", tags=["finance"])

AS_TYPE = {"refund": "仅退款", "return": "退货退款", "exchange": "换货",
           "resend": "补发", "repair": "维修"}
AS_STATUS = {"pending": "待审核", "approved": "已同意", "processing": "处理中",
             "done": "已完成", "rejected": "已拒绝"}


# ==================== 售后 ====================
@router.get("/after-sales")
def after_sales(db: Session = Depends(get_db), status: str = "", atype: str = ""):
    q = db.query(AfterSale)
    if status:
        q = q.filter_by(status=status)
    if atype:
        q = q.filter_by(atype=atype)
    out = []
    for a in q.order_by(AfterSale.id.desc()).all():
        s = db.get(Shop, a.shop_id); w = db.get(Warehouse, a.warehouse_id) if a.warehouse_id else None
        out.append({"id": a.id, "as_no": a.as_no, "order_no": a.order_no,
                    "shop": s.name if s else "", "buyer_nick": a.buyer_nick,
                    "atype": a.atype, "atype_label": AS_TYPE.get(a.atype, a.atype),
                    "reason": a.reason, "amount": a.amount, "status": a.status,
                    "status_label": AS_STATUS.get(a.status, a.status),
                    "need_return": a.need_return, "returned": a.returned,
                    "restock": a.restock, "warehouse": w.name if w else "",
                    "handler": a.handler,
                    "created_at": a.created_at.strftime("%m-%d %H:%M")})
    return out


@router.get("/after-sales/{aid}")
def as_detail(aid: int, db: Session = Depends(get_db)):
    a = db.get(AfterSale, aid)
    if not a:
        raise HTTPException(404, "售后单不存在")
    return {"id": a.id, "as_no": a.as_no,
            "items": [{"sku": i.sku, "name": i.name, "qty": i.qty,
                       "price": i.price, "quality": i.quality,
                       "quality_label": "良品可再售" if i.quality == "good" else "次品报废"}
                      for i in db.query(AfterSaleItem).filter_by(as_id=aid).all()]}


class AsIn(BaseModel):
    order_id: int
    atype: str
    reason: str
    amount: float = 0


@router.post("/after-sales")
def create_as(body: AsIn, db: Session = Depends(get_db)):
    r = ops.create_after_sale(db, body.order_id, body.atype, body.reason, body.amount)
    svc.log(db, "客服", "创建售后单", str(r.get("as_no", "")), body.reason)
    db.commit()
    return r


@router.post("/after-sales/{aid}/process")
def process_as(aid: int, action: str, db: Session = Depends(get_db)):
    r = ops.process_after_sale(db, aid, action)
    svc.log(db, "客服", "处理售后", str(aid), action)
    db.commit()
    return r


@router.get("/after-sale-stats")
def as_stats(db: Session = Depends(get_db)):
    total = db.query(func.count(AfterSale.id)).scalar()
    by_type = {}
    for t, c in db.query(AfterSale.atype, func.count(AfterSale.id)).group_by(AfterSale.atype).all():
        by_type[AS_TYPE.get(t, t)] = c
    by_status = {}
    for s, c in db.query(AfterSale.status, func.count(AfterSale.id)).group_by(AfterSale.status).all():
        by_status[AS_STATUS.get(s, s)] = c
    amount = db.query(func.sum(AfterSale.amount)).scalar() or 0
    done = db.query(func.count(AfterSale.id)).filter_by(status="done").scalar()
    return {"total": total, "by_type": by_type, "by_status": by_status,
            "amount": round(amount, 2), "done": done,
            "pending": db.query(func.count(AfterSale.id)).filter_by(status="pending").scalar()}


# ==================== 财务对账 ====================
@router.get("/bills")
def bills(db: Session = Depends(get_db)):
    out = []
    for b in db.query(PlatformBill).order_by(PlatformBill.id.desc()).all():
        s = db.get(Shop, b.shop_id); p = db.get(Platform, b.platform_id)
        out.append({"id": b.id, "bill_no": b.bill_no, "shop": s.name if s else "",
                    "platform": p.name if p else "", "period": b.period,
                    "order_amount": b.order_amount, "commission": b.commission,
                    "service_fee": b.service_fee, "ad_fee": b.ad_fee,
                    "refund_amount": b.refund_amount, "freight_fee": b.freight_fee,
                    "other_fee": b.other_fee, "settle_amount": b.settle_amount,
                    "status": b.status,
                    "fee_rate": round((b.commission + b.service_fee) / b.order_amount, 4)
                    if b.order_amount else 0})
    return out


@router.get("/bills/{bid}/fees")
def bill_fees(bid: int, db: Session = Depends(get_db)):
    return [{"id": f.id, "fee_type": f.fee_type, "amount": f.amount,
             "order_no": f.order_no, "remark": f.remark}
            for f in db.query(BillFee).filter_by(bill_id=bid).all()]


@router.post("/bills/generate")
def gen_bill(shop_id: int, period: str = "", db: Session = Depends(get_db)):
    period = period or datetime.now().strftime("%Y-%m")
    r = ops.generate_bill(db, shop_id, period)
    svc.log(db, "财务", "生成平台账单", str(shop_id), period)
    db.commit()
    return r


@router.post("/bills/{bid}/reconcile")
def reconcile(bid: int, db: Session = Depends(get_db)):
    b = db.get(PlatformBill, bid)
    if not b:
        raise HTTPException(404, "账单不存在")
    b.status = "reconciled"
    db.commit()
    return {"msg": f"账单 {b.bill_no} 已对账"}


@router.get("/ap-ar")
def ap_ar(db: Session = Depends(get_db), direction: str = ""):
    q = db.query(ApAr)
    if direction:
        q = q.filter_by(direction=direction)
    out = []
    for a in q.order_by(ApAr.id.desc()).all():
        out.append({"id": a.id, "direction": a.direction,
                    "direction_label": "应收" if a.direction == "ar" else "应付",
                    "partner_type": a.partner_type,
                    "partner_type_label": {"platform": "平台", "supplier": "供应商",
                                           "customer": "客户"}.get(a.partner_type, a.partner_type),
                    "partner_name": a.partner_name, "ref_no": a.ref_no,
                    "amount": a.amount, "settled_amount": a.settled_amount,
                    "unsettled": round(a.amount - a.settled_amount, 2),
                    "status": a.status,
                    "status_label": {"open": "未结", "partial": "部分结", "closed": "已结"}.get(a.status),
                    "due_date": a.due_date.strftime("%Y-%m-%d") if a.due_date else "",
                    "created_at": a.created_at.strftime("%m-%d")})
    return out


@router.get("/profit")
def profit(db: Session = Depends(get_db)):
    rows = ops.profit_summary(db)
    total_rev = sum(r["revenue"] for r in rows)
    total_net = sum(r["net"] for r in rows)
    return {"rows": rows, "total_revenue": round(total_rev, 2),
            "total_net": round(total_net, 2),
            "total_margin": round(total_net / total_rev, 4) if total_rev else 0,
            "count": len(rows)}


@router.post("/profit/calc")
def calc_profit(db: Session = Depends(get_db)):
    n = ops.batch_calc_profit(db)
    db.commit()
    return {"msg": f"已核算 {n} 笔订单利润", "count": n}


@router.get("/profit/records")
def profit_records(db: Session = Depends(get_db), limit: int = 60):
    out = []
    for r in db.query(ProfitRecord).order_by(ProfitRecord.id.desc()).limit(limit).all():
        s = db.get(Shop, r.shop_id)
        out.append({"id": r.id, "order_no": r.order_no, "shop": s.name if s else "",
                    "revenue": r.revenue, "goods_cost": r.goods_cost,
                    "freight_cost": r.freight_cost, "platform_fee": r.platform_fee,
                    "ad_fee": r.ad_fee, "pack_cost": r.pack_cost,
                    "gross_profit": r.gross_profit, "net_profit": r.net_profit,
                    "margin": r.margin})
    return out


# ==================== 报表中心 ====================
@router.get("/reports/sales")
def report_sales(db: Session = Depends(get_db)):
    """销售报表：按平台 / 按分类 / 按店铺 TOP。"""
    by_platform = {}
    for o in db.query(Order).all():
        s = db.get(Shop, o.shop_id)
        p = db.get(Platform, s.platform_id) if s else None
        k = p.name if p else "未知"
        d = by_platform.setdefault(k, {"orders": 0, "amount": 0})
        d["orders"] += 1
        d["amount"] += o.amount
    rows = [{"name": k, "orders": v["orders"], "amount": round(v["amount"], 2)}
            for k, v in by_platform.items()]
    rows.sort(key=lambda x: -x["amount"])

    by_cat = {}
    for oi in db.query(OrderItem).all():
        p = db.get(Product, oi.product_id)
        d = by_cat.setdefault(p.category or "未分类", {"qty": 0, "amount": 0})
        d["qty"] += oi.qty
        d["amount"] += oi.price * oi.qty
    cats = [{"name": k, "qty": v["qty"], "amount": round(v["amount"], 2)}
            for k, v in by_cat.items()]
    cats.sort(key=lambda x: -x["amount"])

    sku_rank = {}
    for oi in db.query(OrderItem).all():
        d = sku_rank.setdefault(oi.sku, {"name": oi.name, "qty": 0, "amount": 0})
        d["qty"] += oi.qty
        d["amount"] += oi.price * oi.qty
    skus = [{"sku": k, "name": v["name"], "qty": v["qty"], "amount": round(v["amount"], 2)}
            for k, v in sku_rank.items()]
    skus.sort(key=lambda x: -x["amount"])
    return {"by_platform": rows, "by_category": cats, "sku_top": skus[:15]}


@router.get("/reports/inventory")
def report_inventory(db: Session = Depends(get_db)):
    """库存报表：周转、库龄、呆滞、缺货。"""
    rows = []
    for p in db.query(Product).all():
        invs = db.query(Inventory).filter_by(product_id=p.id).all()
        on_hand = sum(i.on_hand for i in invs)
        avail = sum(i.available for i in invs)
        locked = sum(i.locked for i in invs)
        sold = db.query(func.sum(OrderItem.qty)).filter_by(product_id=p.id).scalar() or 0
        turnover = round(sold / on_hand, 2) if on_hand else 0
        cover_days = int(on_hand / (sold / 30)) if sold else 999
        rows.append({"sku": p.sku, "name": p.name, "category": p.category,
                     "on_hand": on_hand, "available": avail, "locked": locked,
                     "sold": sold, "turnover": turnover, "cover_days": cover_days,
                     "value": round(on_hand * p.cost_price, 2),
                     "status": "呆滞" if cover_days > 90 else ("缺货" if avail < 20 else "正常")})
    rows.sort(key=lambda x: -x["value"])
    total_value = sum(r["value"] for r in rows)
    return {"rows": rows, "total_value": round(total_value, 2),
            "slow": len([r for r in rows if r["status"] == "呆滞"]),
            "short": len([r for r in rows if r["status"] == "缺货"])}


@router.get("/reports/fulfillment")
def report_fulfillment(db: Session = Depends(get_db)):
    """履约效率报表：审单时长、发货达成、异常率。"""
    shipped = db.query(Order).filter_by(status="shipped").all()
    audit_mins, ship_hours = [], []
    for o in shipped:
        if o.audited_at and o.created_at:
            audit_mins.append((o.audited_at - o.created_at).total_seconds() / 60)
        if o.shipped_at and o.audited_at:
            ship_hours.append((o.shipped_at - o.audited_at).total_seconds() / 3600)
    total = db.query(func.count(Order.id)).scalar()
    by_status = {}
    for s, c in db.query(Order.status, func.count(Order.id)).group_by(Order.status).all():
        by_status[s] = c
    waves = db.query(PickWave).all()
    return {
        "shipped_count": len(shipped),
        "avg_audit_min": round(sum(audit_mins) / len(audit_mins), 1) if audit_mins else 0,
        "avg_ship_hour": round(sum(ship_hours) / len(ship_hours), 1) if ship_hours else 0,
        "intercept_rate": round((by_status.get("intercepted", 0) / total), 4) if total else 0,
        "by_status": by_status,
        "wave_count": len(waves),
        "wave_done": len([w for w in waves if w.status in ("packed", "done")]),
        "stocktake_count": db.query(func.count(Stocktake.id)).scalar(),
        "total_orders": total,
    }


@router.get("/reports/daily")
def report_daily(db: Session = Depends(get_db)):
    """经营日报：今日与昨日对比。"""
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    y = today - timedelta(days=1)
    def stat(d0, d1):
        orders = db.query(Order).filter(Order.created_at >= d0, Order.created_at < d1).all()
        shipped = [o for o in orders if o.status == "shipped"]
        return {"orders": len(orders), "amount": round(sum(o.amount for o in orders), 2),
                "shipped": len(shipped)}
    t, yd = stat(today, today + timedelta(days=1)), stat(y, today)
    return {"today": t, "yesterday": yd,
            "delta_orders": t["orders"] - yd["orders"],
            "delta_amount": round(t["amount"] - yd["amount"], 2)}
