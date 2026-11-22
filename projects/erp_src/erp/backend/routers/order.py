import random
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import (Carrier, Inventory, Order, OrderItem, Product, Shop, ShopListing,
                      Platform, Warehouse)
from .. import services as svc

router = APIRouter(prefix="/api", tags=["order"])

STATUS_LABEL = {"pending": "待审单", "auditing": "审单中/挂起", "waiting": "待发货",
                "shipped": "已发货", "intercepted": "已拦截", "cancelled": "已取消",
                "merged": "已合并"}


def order_dict(db, o, with_items=False):
    s = db.get(Shop, o.shop_id)
    p = db.get(Platform, s.platform_id) if s else None
    w = db.get(Warehouse, o.warehouse_id) if o.warehouse_id else None
    c = db.get(Carrier, o.carrier_id) if o.carrier_id else None
    d = {"id": o.id, "order_no": o.order_no, "shop": s.name if s else "",
         "shop_id": o.shop_id, "platform": p.name if p else "",
         "buyer_nick": o.buyer_nick, "receiver": o.receiver_name,
         "phone": o.receiver_phone, "province": o.province, "city": o.city,
         "address": o.address, "amount": o.amount, "freight": o.freight,
         "discount": o.discount, "weight": o.weight_kg, "status": o.status,
         "status_label": STATUS_LABEL.get(o.status, o.status),
         "audit_result": o.audit_result, "audit_msg": o.audit_msg,
         "warehouse": w.name if w else "", "warehouse_id": o.warehouse_id or 0,
         "carrier": c.name if c else "",
         "waybill_no": o.waybill_no, "remark": o.buyer_remark,
         "is_presale": o.is_presale,
         "created_at": o.created_at.strftime("%m-%d %H:%M") if o.created_at else "",
         "shipped_at": o.shipped_at.strftime("%m-%d %H:%M") if o.shipped_at else ""}
    if with_items:
        d["items"] = [{"sku": i.sku, "name": i.name, "qty": i.qty, "price": i.price}
                      for i in db.query(OrderItem).filter_by(order_id=o.id).all()]
    return d


@router.get("/orders")
def list_orders(db: Session = Depends(get_db), status: str = "", shop_id: int = 0,
                kw: str = "", limit: int = 200):
    q = db.query(Order)
    if status:
        q = q.filter_by(status=status)
    if shop_id:
        q = q.filter_by(shop_id=shop_id)
    if kw:
        q = q.filter(Order.order_no.like(f"%{kw}%") | Order.receiver_name.like(f"%{kw}%")
                     | Order.buyer_nick.like(f"%{kw}%"))
    rows = [order_dict(db, o) for o in q.order_by(Order.id.desc()).limit(limit).all()]
    return rows


@router.get("/orders/{oid}")
def get_order(oid: int, db: Session = Depends(get_db)):
    o = db.get(Order, oid)
    if not o:
        raise HTTPException(404, "订单不存在")
    return order_dict(db, o, with_items=True)


def _do_audit(db, o, manual_pass=False):
    """审单：命中规则 → 挂起/拦截；通过 → 锁库存并分配仓与快递。"""
    if o.status not in ("pending", "auditing"):
        return {"ok": False, "msg": f"当前状态 {STATUS_LABEL.get(o.status)} 不可审单"}
    if manual_pass:
        res = {"action": "pass", "rule": "人工放行", "reason": "人工审核通过"}
    else:
        res = svc.run_audit(db, o)
    o.audit_result = res["action"]
    if res["action"] == "block":
        o.status = "intercepted"
        o.audit_msg = f"[{res['rule']}] {res['reason']}"
        db.commit()
        return {"ok": True, "action": "block", "msg": o.audit_msg}
    if res["action"] == "hold":
        o.status = "auditing"
        o.audit_msg = f"[{res['rule']}] {res['reason']}"
        db.commit()
        return {"ok": True, "action": "hold", "msg": o.audit_msg}

    ok, detail = svc.try_lock(db, o)
    if not ok:
        o.status = "auditing"
        o.audit_msg = f"库存不足：{detail.get('error')}"
        db.commit()
        return {"ok": True, "action": "hold", "msg": o.audit_msg}
    o.status = "waiting"
    o.audited_at = datetime.now()
    o.audit_msg = f"[{res['rule']}] 审单通过，已锁定库存"
    cid, cname = svc.match_carrier(db, o)
    o.carrier_id = cid
    o.freight = svc.calc_freight(db, o, cid)
    db.flush()
    svc.log(db, "system", "审单通过", o.order_no, f"仓={db.get(Warehouse, o.warehouse_id).name}")
    db.commit()
    return {"ok": True, "action": "pass", "msg": o.audit_msg,
            "warehouse": db.get(Warehouse, o.warehouse_id).name, "carrier": cname}


@router.post("/orders/{oid}/audit")
def audit_order(oid: int, db: Session = Depends(get_db)):
    o = db.get(Order, oid)
    if not o:
        raise HTTPException(404, "订单不存在")
    return _do_audit(db, o)


@router.post("/orders/{oid}/approve")
def approve_order(oid: int, db: Session = Depends(get_db)):
    o = db.get(Order, oid)
    if not o:
        raise HTTPException(404, "订单不存在")
    return _do_audit(db, o, manual_pass=True)


@router.post("/orders/{oid}/intercept")
def intercept_order(oid: int, db: Session = Depends(get_db)):
    o = db.get(Order, oid)
    if o.status == "waiting":
        svc.release_stock(db, o)
    o.status, o.audit_result, o.audit_msg = "intercepted", "block", "人工拦截"
    svc.log(db, "admin", "人工拦截", o.order_no, "")
    db.commit()
    return {"msg": "已拦截，库存已释放" if o.status == "intercepted" else ""}


@router.post("/orders/{oid}/cancel")
def cancel_order(oid: int, db: Session = Depends(get_db)):
    o = db.get(Order, oid)
    if o.status == "waiting":
        svc.release_stock(db, o)
    o.status, o.audit_msg = "cancelled", "取消订单，库存已释放"
    db.commit()
    return {"msg": "已取消"}


@router.post("/orders/{oid}/ship")
def ship_order(oid: int, db: Session = Depends(get_db)):
    o = db.get(Order, oid)
    if not o:
        raise HTTPException(404, "订单不存在")
    if o.status != "waiting":
        return {"ok": False, "msg": "只有待发货订单可发货"}
    c = db.get(Carrier, o.carrier_id) if o.carrier_id else None
    if not c:
        cid, _ = svc.match_carrier(db, o)
        o.carrier_id = cid
        c = db.get(Carrier, cid)
    o.waybill_no = o.waybill_no or svc.gen_waybill_no(c.code)
    svc.deduct_on_ship(db, o)
    o.status = "shipped"
    o.shipped_at = datetime.now()
    o.audit_msg = f"已发货，{c.name} {o.waybill_no}"
    svc.log(db, "warehouse", "发货", o.order_no, o.waybill_no)
    db.commit()
    # 回写平台库存（模拟）
    _sync_platform_stock(db, o)
    return {"ok": True, "waybill": o.waybill_no, "carrier": c.name}


def _sync_platform_stock(db, o):
    for it in db.query(OrderItem).filter_by(order_id=o.id).all():
        ls = db.query(ShopListing).filter_by(shop_id=o.shop_id, product_id=it.product_id).all()
        for l in ls:
            avail = svc.global_available(db, it.product_id)
            l.platform_stock = avail
            l.last_sync_at = datetime.now()
    db.commit()


class BatchIn(BaseModel):
    ids: List[int]


@router.post("/orders/batch-audit")
def batch_audit(body: BatchIn, db: Session = Depends(get_db)):
    r = {"pass": 0, "hold": 0, "block": 0, "skip": 0, "msgs": []}
    for oid in body.ids:
        o = db.get(Order, oid)
        if not o or o.status not in ("pending", "auditing"):
            r["skip"] += 1
            continue
        res = _do_audit(db, o)
        r[res.get("action", "hold")] = r.get(res.get("action", "hold"), 0) + 1
        if len(r["msgs"]) < 8:
            r["msgs"].append(f"{o.order_no}: {res.get('msg')}")
    return r


@router.post("/orders/batch-ship")
def batch_ship(body: BatchIn, db: Session = Depends(get_db)):
    ok, fail = 0, 0
    for oid in body.ids:
        o = db.get(Order, oid)
        if not o or o.status != "waiting":
            fail += 1
            continue
        c = db.get(Carrier, o.carrier_id) if o.carrier_id else db.query(Carrier).first()
        o.carrier_id = c.id
        o.waybill_no = svc.gen_waybill_no(c.code)
        svc.deduct_on_ship(db, o)
        o.status, o.shipped_at = "shipped", datetime.now()
        ok += 1
    db.commit()
    return {"ok": ok, "fail": fail}


@router.post("/orders/{oid}/split")
def split_order(oid: int, db: Session = Depends(get_db)):
    """按仓库拆单：不同商品从不同仓发出时，拆成多个子单。"""
    o = db.get(Order, oid)
    if o.status == "waiting":
        svc.release_stock(db, o)
    items = db.query(OrderItem).filter_by(order_id=o.id).all()
    if len(items) < 2:
        return {"ok": False, "msg": "单件商品订单无需拆单"}
    whs = svc.pick_warehouses(db, o.shop_id,
                              db.get(Shop, o.shop_id).platform_id if o.shop_id else 0)
    bucket = {}
    for it in items:
        target = None
        for r in whs:
            if svc.available_qty(db, r.warehouse_id, it.product_id) >= it.qty:
                target = r.warehouse_id
                break
        target = target or (whs[0].warehouse_id if whs else None)
        bucket.setdefault(target, []).append(it)
    if len(bucket) < 2:
        return {"ok": False, "msg": "全部商品可由同一仓发出，无需拆单"}
    subs = []
    for idx, (wid, its) in enumerate(bucket.items(), 1):
        amt = sum(i.price * i.qty for i in its)
        sub = Order(order_no=f"{o.order_no}-{idx}", shop_id=o.shop_id,
                    buyer_nick=o.buyer_nick, receiver_name=o.receiver_name,
                    receiver_phone=o.receiver_phone, province=o.province, city=o.city,
                    address=o.address, amount=round(amt + o.freight, 2), freight=o.freight,
                    weight_kg=round(sum(i.qty * (db.get(Product, i.product_id).weight_kg or 0)
                                        for i in its), 2),
                    status="pending", buyer_remark=f"拆单子件（母单 {o.order_no}）",
                    warehouse_id=wid)
        db.add(sub); db.flush()
        for i in its:
            db.add(OrderItem(order_id=sub.id, product_id=i.product_id, sku=i.sku,
                             name=i.name, qty=i.qty, price=i.price))
        w = db.get(Warehouse, wid)
        subs.append({"order_no": sub.order_no, "warehouse": w.name if w else "",
                     "items": len(its)})
    o.status, o.audit_msg = "cancelled", f"已拆分为 {len(subs)} 个子单"
    svc.log(db, "admin", "订单拆分", o.order_no, str(len(subs)) + " 个子单")
    db.commit()
    return {"ok": True, "subs": subs}


class MergeIn(BaseModel):
    ids: List[int]


@router.post("/orders/merge")
def merge_orders(body: MergeIn, db: Session = Depends(get_db)):
    """同一买家的多笔订单合并为一个包裹发货。"""
    if len(body.ids) < 2:
        return {"ok": False, "msg": "至少选择 2 笔订单"}
    os_ = [db.get(Order, i) for i in body.ids]
    os_ = [o for o in os_ if o and o.status in ("pending", "auditing", "waiting")]
    if len(os_) < 2:
        return {"ok": False, "msg": "所选订单状态不支持合并"}
    keys = {(o.receiver_name, o.receiver_phone, o.address) for o in os_}
    if len(keys) > 1:
        return {"ok": False, "msg": "收件人与地址不一致，不能合单"}
    for o in os_:
        if o.status == "waiting":
            svc.release_stock(db, o)
    head = os_[0]
    for o in os_[1:]:
        for it in db.query(OrderItem).filter_by(order_id=o.id).all():
            db.add(OrderItem(order_id=head.id, product_id=it.product_id, sku=it.sku,
                             name=it.name, qty=it.qty, price=it.price))
        o.status, o.audit_msg = "cancelled", f"已合并至 {head.order_no}"
    head.amount = round(sum(i.price * i.qty for i in
                            db.query(OrderItem).filter_by(order_id=head.id).all()) + head.freight, 2)
    head.status, head.audit_result, head.audit_msg = "pending", "", "已合单，待重新审单"
    head.buyer_remark = (head.buyer_remark or "") + "【多单合并发货】"
    svc.log(db, "admin", "订单合并", head.order_no, f"{len(os_)} 单合一")
    db.commit()
    return {"ok": True, "order_no": head.order_no, "count": len(os_)}


class SimIn(BaseModel):
    count: int = 1
    shop_id: int = 0
    product_sku: str = ""
    qty: int = 1
    auto_audit: bool = True


@router.post("/simulate/inbound")
def simulate(body: SimIn, db: Session = Depends(get_db)):
    """模拟平台推单：抓单 → 审单 → 锁库存全流程。"""
    results = []
    for _ in range(max(1, min(body.count, 50))):
        sid = body.shop_id or random.choice([s.id for s in db.query(Shop).filter_by(
            auth_status="authorized").all()])
        shop = db.get(Shop, sid)
        listings = db.query(ShopListing).filter_by(shop_id=sid, online_status="online").all()
        if not listings:
            continue
        if body.product_sku:
            p = db.query(Product).filter_by(sku=body.product_sku).first()
            picks = db.query(ShopListing).filter_by(shop_id=sid, product_id=p.id).all() or [random.choice(listings)]
        else:
            picks = random.sample(listings, min(random.randint(1, 3), len(listings)))
        p0 = db.get(Platform, shop.platform_id)
        prov, city, addr = random.choice(
            [("浙江", "杭州", "西湖区文三路"), ("广东", "广州", "天河区珠江新城"),
             ("江苏", "南京", "鼓楼区中山北路"), ("四川", "成都", "武侯区天府大道"),
             ("北京", "北京", "朝阳区建国路"), ("新疆", "乌鲁木齐", "天山区解放北路")])
        now = datetime.now()
        o = Order(order_no=f"{shop.code}{now.strftime('%y%m%d%H%M%S')}{random.randint(100, 999)}",
                  shop_id=sid,
                  buyer_nick=f"买家{random.randint(1000, 9999)}",
                  receiver_name=random.choice(["张伟", "李娜", "王芳", "刘洋", "陈静"]),
                  receiver_phone=f"{random.randint(130, 199)}****{random.randint(1000, 9999)}",
                  province=prov, city=city, address=f"{addr}{random.randint(1, 999)}号",
                  buyer_remark=random.choice(["", "", "", "请发顺丰", "尽快发货", "改地址联系我"]),
                  status="pending", created_at=now)
        amount, weight = 0, 0
        for l in picks:
            p = db.get(Product, l.product_id)
            q = body.qty if body.product_sku else random.randint(1, 3)
            db.flush()
            amount += l.platform_price * q
            weight += (p.weight_kg or 0) * q
            o.__dict__["_pending_items"] = o.__dict__.get("_pending_items", [])
            o.__dict__["_pending_items"].append((p.id, p.sku, p.name, q, l.platform_price))
        o.amount = round(amount + (0 if amount >= 99 else 8), 2)
        o.freight = 0 if amount >= 99 else 8
        o.weight_kg = round(weight, 2)
        db.add(o); db.flush()
        for pid, sku_, nm, q, pr in o.__dict__.get("_pending_items", []):
            db.add(OrderItem(order_id=o.id, product_id=pid, sku=sku_, name=nm, qty=q, price=pr))
        db.flush()
        shop.api_used_day = (shop.api_used_day or 0) + 1
        svc.log(db, "platform", "平台抓单", o.order_no, shop.name)
        db.commit()
        if body.auto_audit:
            res = _do_audit(db, o)
            results.append({"order_no": o.order_no, "shop": shop.name,
                            "platform": p0.name if p0 else "", "amount": o.amount,
                            "action": res.get("action"), "msg": res.get("msg")})
        else:
            results.append({"order_no": o.order_no, "shop": shop.name,
                            "platform": p0.name if p0 else "", "amount": o.amount,
                            "action": "pending", "msg": "已抓单，等待审单"})
    return {"results": results}


@router.get("/orders/{oid}/print")
def print_order(oid: int, tpl: str = "waybill_default", db: Session = Depends(get_db)):
    o = db.get(Order, oid)
    if not o:
        raise HTTPException(404, "订单不存在")
    from ..models import PrintTemplate
    tpl_obj = db.query(PrintTemplate).filter_by(code=tpl).first()
    if not tpl_obj:
        raise HTTPException(404, "模板不存在")
    ctx = svc.build_print_ctx(db, o)
    return {"html": svc.render_template(tpl_obj.content, ctx),
            "name": tpl_obj.name, "w": tpl_obj.width_mm, "h": tpl_obj.height_mm,
            "order_no": o.order_no}
