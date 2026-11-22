from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import (Carrier, Inventory, Order, OrderItem, Platform, Product, Shop,
                      StockLedger, Warehouse)
from ..models_ops import (AfterSale, AfterSaleItem, ApAr, BillFee, Location, PackCheck,
                          PickTask, PickWave, PlatformBill, ProfitRecord, PurchaseItem,
                          PurchaseOrder, PurchaseReturn, Receipt, StockBatch, Stocktake,
                          StocktakeItem, Supplier, Transfer)
from .. import services as svc
from .. import services_ops as ops

router = APIRouter(prefix="/api", tags=["ops"])

PO_STATUS = {"draft": "草稿", "approved": "已审核", "partial": "部分到货",
             "received": "已入库", "cancelled": "已取消"}
AS_TYPE = {"refund": "仅退款", "return": "退货退款", "exchange": "换货",
           "resend": "补发", "repair": "维修"}
AS_STATUS = {"pending": "待审核", "approved": "已同意", "processing": "处理中",
             "done": "已完成", "rejected": "已拒绝"}


# ==================== 采购供应链 ====================
@router.get("/suppliers")
def suppliers(db: Session = Depends(get_db)):
    out = []
    for s in db.query(Supplier).all():
        pos = db.query(PurchaseOrder).filter_by(supplier_id=s.id).all()
        out.append({"id": s.id, "code": s.code, "name": s.name, "contact": s.contact,
                    "phone": s.phone, "tax_no": s.tax_no, "pay_term": s.pay_term,
                    "lead_days": s.lead_days, "credit_limit": s.credit_limit,
                    "score": s.score, "status": s.status,
                    "po_count": len(pos),
                    "po_amount": round(sum(p.amount for p in pos), 2)})
    return out


@router.get("/purchase-orders")
def purchase_orders(db: Session = Depends(get_db)):
    out = []
    for p in db.query(PurchaseOrder).order_by(PurchaseOrder.id.desc()).all():
        sp = db.get(Supplier, p.supplier_id); w = db.get(Warehouse, p.warehouse_id)
        items = db.query(PurchaseItem).filter_by(po_id=p.id).all()
        recv = sum(i.received_qty for i in items)
        total = sum(i.qty for i in items)
        out.append({"id": p.id, "po_no": p.po_no, "supplier": sp.name if sp else "",
                    "warehouse": w.name if w else "", "status": p.status,
                    "status_label": PO_STATUS.get(p.status, p.status),
                    "amount": p.amount, "sku_count": len(items),
                    "qty": total, "received": recv,
                    "progress": round(recv / total * 100) if total else 0,
                    "expect_date": p.expect_date.strftime("%Y-%m-%d") if p.expect_date else "",
                    "buyer": p.buyer, "created_at": p.created_at.strftime("%m-%d %H:%M")})
    return out


@router.get("/purchase-orders/{pid}")
def po_detail(pid: int, db: Session = Depends(get_db)):
    p = db.get(PurchaseOrder, pid)
    if not p:
        raise HTTPException(404, "采购单不存在")
    sp = db.get(Supplier, p.supplier_id); w = db.get(Warehouse, p.warehouse_id)
    return {"id": p.id, "po_no": p.po_no, "supplier": sp.name if sp else "",
            "warehouse": w.name if w else "", "status": p.status,
            "amount": p.amount, "remark": p.remark,
            "items": [{"sku": i.sku, "name": i.name, "qty": i.qty,
                       "received_qty": i.received_qty, "price": i.price,
                       "tax_rate": i.tax_rate}
                      for i in db.query(PurchaseItem).filter_by(po_id=pid).all()]}


class POIn(BaseModel):
    supplier_id: int
    warehouse_id: int
    items: List[dict]


@router.post("/purchase-orders")
def create_po(body: POIn, db: Session = Depends(get_db)):
    amount = 0
    po_no = ops.gen("PO")
    p = PurchaseOrder(po_no=po_no, supplier_id=body.supplier_id,
                      warehouse_id=body.warehouse_id, status="approved",
                      expect_date=datetime.now() + timedelta(days=7))
    db.add(p); db.flush()
    for it in body.items:
        prod = db.get(Product, it.get("product_id"))
        if not prod:
            continue
        qty = int(it.get("qty", 10))
        price = float(it.get("price") or prod.cost_price)
        db.add(PurchaseItem(po_id=p.id, product_id=prod.id, sku=prod.sku, name=prod.name,
                            qty=qty, price=price))
        amount += qty * price
    p.amount = round(amount, 2)
    inv_rows = db.query(Inventory).filter_by(warehouse_id=body.warehouse_id).all()
    for inv in inv_rows:
        if any(i.product_id == inv.product_id for i in db.query(PurchaseItem).filter_by(po_id=p.id).all()):
            inv.inbound += 0
    db.flush()
    svc.log(db, "采购部", "创建采购单", po_no, f"¥{amount:.2f}")
    db.commit()
    return {"ok": True, "po_no": po_no, "amount": round(amount, 2), "id": p.id}


@router.post("/purchase-orders/{pid}/receive")
def receive_po(pid: int, db: Session = Depends(get_db)):
    r = ops.receive_purchase(db, pid)
    svc.log(db, "仓管", "采购入库", str(pid), str(r.get("msg")))
    db.commit()
    return r


class ReturnIn(BaseModel):
    product_id: int
    qty: int
    reason: str = "来料不良"


@router.post("/purchase-orders/{pid}/return")
def return_po(pid: int, body: ReturnIn, db: Session = Depends(get_db)):
    r = ops.purchase_return(db, pid, body.product_id, body.qty, body.reason)
    db.commit()
    return r


@router.get("/receipts")
def receipts(db: Session = Depends(get_db)):
    out = []
    for r in db.query(Receipt).order_by(Receipt.id.desc()).all():
        po = db.get(PurchaseOrder, r.po_id); w = db.get(Warehouse, r.warehouse_id)
        out.append({"id": r.id, "rc_no": r.rc_no, "po_no": po.po_no if po else "",
                    "warehouse": w.name if w else "", "status": r.status,
                    "qc_pass": r.qc_pass, "operator": r.operator,
                    "created_at": r.created_at.strftime("%m-%d %H:%M")})
    return out


@router.get("/supply-suggest")
def supply_suggest(db: Session = Depends(get_db)):
    """智能补货建议：可用 < 安全库存 或 可用 < 20 的商品，按建议量排序。"""
    out = []
    for inv in db.query(Inventory).all():
        p = db.get(Product, inv.product_id); w = db.get(Warehouse, inv.warehouse_id)
        need = max((inv.safety_stock or 0) * 3, 50)
        if inv.available >= min(need, 30):
            continue
        gap = max(need - inv.available - (inv.inbound or 0), 0)
        if gap <= 0:
            continue
        sup = db.query(Supplier).order_by(func.random()).first()
        out.append({"sku": p.sku, "name": p.name, "warehouse": w.name,
                    "available": inv.available, "safety": inv.safety_stock,
                    "inbound": inv.inbound, "suggest": int(gap),
                    "cost": p.cost_price, "amount": round(gap * p.cost_price, 2),
                    "supplier": sup.name if sup else "", "supplier_id": sup.id if sup else 0,
                    "lead_days": sup.lead_days if sup else 7})
    out.sort(key=lambda x: -x["amount"])
    return out[:30]


# ==================== 仓储作业 WMS ====================
@router.get("/locations")
def locations(db: Session = Depends(get_db), warehouse_id: int = 0):
    q = db.query(Location)
    if warehouse_id:
        q = q.filter_by(warehouse_id=warehouse_id)
    out = []
    for l in q.all():
        w = db.get(Warehouse, l.warehouse_id)
        out.append({"id": l.id, "code": l.code, "warehouse": w.name if w else "",
                    "warehouse_id": l.warehouse_id, "zone": l.zone,
                    "ltype": l.ltype, "enabled": l.enabled})
    return out


@router.get("/batches")
def batches(db: Session = Depends(get_db)):
    out = []
    for b in db.query(StockBatch).all():
        p = db.get(Product, b.product_id); w = db.get(Warehouse, b.warehouse_id)
        days = (b.expire_at - datetime.now()).days if b.expire_at else 999
        out.append({"id": b.id, "batch_no": b.batch_no, "warehouse": w.name if w else "",
                    "sku": p.sku, "name": p.name, "qty": b.qty,
                    "cost_price": b.cost_price, "location_code": b.location_code,
                    "produced_at": b.produced_at.strftime("%Y-%m-%d") if b.produced_at else "",
                    "expire_at": b.expire_at.strftime("%Y-%m-%d") if b.expire_at else "",
                    "expire_days": days,
                    "alert": days < 90})
    out.sort(key=lambda x: x["expire_days"])
    return out


class WaveIn(BaseModel):
    warehouse_id: int
    order_ids: List[int]
    strategy: str = "摘果式"


@router.post("/waves")
def create_wave(body: WaveIn, db: Session = Depends(get_db)):
    r = ops.create_wave(db, body.warehouse_id, body.order_ids, body.strategy)
    svc.log(db, "仓管", "生成波次", str(r.get("wave_no", "")), str(r.get("msg")))
    db.commit()
    return r


@router.get("/waves")
def waves(db: Session = Depends(get_db)):
    out = []
    for w in db.query(PickWave).order_by(PickWave.id.desc()).all():
        wh = db.get(Warehouse, w.warehouse_id)
        out.append({"id": w.id, "wave_no": w.wave_no, "warehouse": wh.name if wh else "",
                    "strategy": w.strategy, "order_count": w.order_count,
                    "sku_count": w.sku_count, "qty_total": w.qty_total,
                    "status": w.status, "picker": w.picker,
                    "created_at": w.created_at.strftime("%m-%d %H:%M")})
    return out


@router.get("/waves/{wid}/tasks")
def wave_tasks(wid: int, db: Session = Depends(get_db)):
    out = []
    for t in db.query(PickTask).filter_by(wave_id=wid).all():
        o = db.get(Order, t.order_id)
        out.append({"id": t.id, "order_id": t.order_id, "order_no": o.order_no if o else "", "sku": t.sku,
                    "name": t.name, "location_code": t.location_code,
                    "qty": t.qty, "picked_qty": t.picked_qty, "status": t.status})
    out.sort(key=lambda x: x["location_code"])
    return out


@router.post("/waves/{wid}/pick")
def pick(wid: int, db: Session = Depends(get_db)):
    r = ops.pick_wave(db, wid)
    db.commit()
    return r


class PackIn(BaseModel):
    order_id: int
    weight_kg: float


@router.post("/waves/{wid}/pack")
def pack(wid: int, body: PackIn, db: Session = Depends(get_db)):
    r = ops.pack_weigh(db, body.order_id, wid, body.weight_kg)
    db.commit()
    return r


@router.get("/pack-checks")
def pack_checks(db: Session = Depends(get_db)):
    out = []
    for c in db.query(PackCheck).order_by(PackCheck.id.desc()).limit(60).all():
        o = db.get(Order, c.order_id); car = db.get(Carrier, c.carrier_id) if c.carrier_id else None
        out.append({"id": c.id, "order_no": o.order_no if o else "",
                    "weight_kg": c.weight_kg, "freight": c.freight,
                    "carrier": car.name if car else "", "waybill_no": c.waybill_no,
                    "result": c.result, "operator": c.operator,
                    "checked_at": c.checked_at.strftime("%m-%d %H:%M")})
    return out


class StocktakeIn(BaseModel):
    warehouse_id: int
    mode: str = "明盘"
    limit: int = 30


@router.post("/stocktakes")
def create_st(body: StocktakeIn, db: Session = Depends(get_db)):
    r = ops.create_stocktake(db, body.warehouse_id, body.mode, body.limit)
    db.commit()
    return r


@router.get("/stocktakes")
def stocktakes(db: Session = Depends(get_db)):
    out = []
    for s in db.query(Stocktake).order_by(Stocktake.id.desc()).all():
        w = db.get(Warehouse, s.warehouse_id)
        out.append({"id": s.id, "st_no": s.st_no, "warehouse": w.name if w else "",
                    "mode": s.mode, "status": s.status, "sku_count": s.sku_count,
                    "diff_qty": s.diff_qty, "diff_amount": s.diff_amount,
                    "operator": s.operator, "created_at": s.created_at.strftime("%m-%d %H:%M")})
    return out


@router.get("/stocktakes/{sid}/items")
def stocktake_items(sid: int, db: Session = Depends(get_db)):
    st = db.get(Stocktake, sid)
    return {"st_no": st.st_no, "mode": st.mode, "status": st.status,
            "items": [{"id": i.id, "sku": i.sku, "name": i.name,
                       "location_code": i.location_code, "book_qty": i.book_qty,
                       "real_qty": i.real_qty, "diff": i.diff, "cost_price": i.cost_price}
                      for i in db.query(StocktakeItem).filter_by(st_id=sid).all()]}


class RealQtyIn(BaseModel):
    items: List[dict]


@router.post("/stocktakes/{sid}/items")
def save_real(sid: int, body: RealQtyIn, db: Session = Depends(get_db)):
    for it in body.items:
        row = db.get(StocktakeItem, it.get("id"))
        if row:
            row.real_qty = int(it.get("real_qty", row.real_qty))
    db.commit()
    return {"msg": "实盘数已保存"}


@router.post("/stocktakes/{sid}/submit")
def submit_st(sid: int, db: Session = Depends(get_db)):
    r = ops.submit_stocktake(db, sid)
    svc.log(db, "仓管", "提交盘点", str(sid), str(r.get("msg")))
    db.commit()
    return r


class TransferIn(BaseModel):
    from_warehouse_id: int
    to_warehouse_id: int
    product_id: int
    qty: int


@router.post("/transfers")
def do_transfer(body: TransferIn, db: Session = Depends(get_db)):
    r = ops.do_transfer(db, body.from_warehouse_id, body.to_warehouse_id,
                        body.product_id, body.qty)
    db.commit()
    return r


@router.get("/transfers")
def transfers(db: Session = Depends(get_db)):
    out = []
    for t in db.query(Transfer).order_by(Transfer.id.desc()).all():
        fw = db.get(Warehouse, t.from_warehouse_id); tw = db.get(Warehouse, t.to_warehouse_id)
        p = db.get(Product, t.product_id)
        out.append({"id": t.id, "tf_no": t.tf_no, "from": fw.name if fw else "",
                    "to": tw.name if tw else "", "sku": p.sku if p else "",
                    "name": p.name if p else "", "qty": t.qty, "status": t.status,
                    "operator": t.operator, "created_at": t.created_at.strftime("%m-%d %H:%M")})
    return out
