from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, text as sa_text
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import (Bundle, Inventory, OpLog, Order, OrderItem, Platform, Product,
                      Shop, ShopListing, StockLedger, StockRule, Warehouse)
from .. import services as svc

router = APIRouter(prefix="/api", tags=["catalog"])


def d(o, extra=None):
    return o


@router.get("/platforms")
def list_platforms(db: Session = Depends(get_db)):
    return [{"id": p.id, "code": p.code, "name": p.name, "auth_type": p.auth_type,
             "enabled": p.enabled} for p in db.query(Platform).all()]


@router.get("/shops")
def list_shops(db: Session = Depends(get_db)):
    rows = []
    for s in db.query(Shop).all():
        p = db.get(Platform, s.platform_id)
        n_listing = db.query(func.count(ShopListing.id)).filter_by(shop_id=s.id).scalar()
        n_order = db.query(func.count(Order.id)).filter_by(shop_id=s.id).scalar()
        rows.append({"id": s.id, "code": s.code, "name": s.name,
                     "platform": p.name if p else "", "platform_id": s.platform_id,
                     "entity": s.entity, "group": s.shop_group,
                     "auth_type": s.auth_type, "auth_status": s.auth_status,
                     "authorized_at": s.authorized_at.strftime("%Y-%m-%d") if s.authorized_at else "",
                     "enabled": s.enabled, "listings": n_listing, "orders": n_order,
                     "api_used": s.api_used_day, "api_quota": s.api_quota_day})
    return rows


class ShopIn(BaseModel):
    code: str
    name: str
    platform_id: int
    entity: str = ""
    group: str = "默认分组"


@router.post("/shops")
def create_shop(body: ShopIn, db: Session = Depends(get_db)):
    if db.query(Shop).filter_by(code=body.code).first():
        raise HTTPException(400, "店铺编码已存在")
    s = Shop(code=body.code, name=body.name, platform_id=body.platform_id,
             entity=body.entity, shop_group=body.group, auth_status="unauthorized")
    db.add(s); db.flush()
    svc.log(db, "admin", "新增店铺", s.code, body.name)
    db.commit()
    return {"id": s.id, "msg": "已创建，待授权"}


@router.post("/shops/{sid}/auth")
def auth_shop(sid: int, db: Session = Depends(get_db)):
    s = db.get(Shop, sid)
    if not s:
        raise HTTPException(404, "店铺不存在")
    s.auth_status = "authorized"
    s.authorized_at = datetime.now()
    svc.log(db, "admin", "店铺授权", s.code, "OAuth 授权成功")
    db.commit()
    return {"msg": f"{s.name} 授权成功"}


@router.post("/shops/{sid}/revoke")
def revoke_shop(sid: int, db: Session = Depends(get_db)):
    s = db.get(Shop, sid)
    s.auth_status = "expired"
    svc.log(db, "admin", "解除授权", s.code, "授权已失效")
    db.commit()
    return {"msg": f"{s.name} 授权已解除"}


@router.get("/products")
def list_products(db: Session = Depends(get_db), kw: str = "", cat: str = ""):
    q = db.query(Product)
    if kw:
        q = q.filter(Product.name.like(f"%{kw}%") | Product.sku.like(f"%{kw}%"))
    if cat:
        q = q.filter(Product.category == cat)
    out = []
    for p in q.all():
        subs = db.query(Bundle).filter_by(parent_id=p.id).all()
        total = sum(i.available for i in db.query(Inventory).filter_by(product_id=p.id).all())
        n_shop = db.query(func.count(ShopListing.id)).filter_by(product_id=p.id).scalar()
        out.append({"id": p.id, "sku": p.sku, "name": p.name, "category": p.category,
                    "spec": p.spec, "barcode": p.barcode, "cost_price": p.cost_price,
                    "sale_price": p.sale_price, "weight_kg": p.weight_kg, "status": p.status,
                    "available": total, "shop_count": n_shop,
                    "is_bundle": bool(subs),
                    "bundle": [{"sku": db.get(Product, b.child_id).sku, "qty": b.qty} for b in subs]})
    return out


class ProductIn(BaseModel):
    sku: str
    name: str
    category: str = ""
    spec: str = ""
    cost_price: float = 0
    sale_price: float = 0
    weight_kg: float = 0.5


@router.post("/products")
def create_product(body: ProductIn, db: Session = Depends(get_db)):
    if db.query(Product).filter_by(sku=body.sku).first():
        raise HTTPException(400, "SKU 已存在")
    p = Product(**body.dict())
    db.add(p); db.flush()
    for w in db.query(Warehouse).all():
        db.add(Inventory(warehouse_id=w.id, product_id=p.id))
    svc.log(db, "admin", "新增商品", body.sku, body.name)
    db.commit()
    return {"id": p.id}


@router.get("/listings")
def list_listings(db: Session = Depends(get_db), shop_id: int = 0, product_id: int = 0):
    q = db.query(ShopListing)
    if shop_id:
        q = q.filter_by(shop_id=shop_id)
    if product_id:
        q = q.filter_by(product_id=product_id)
    out = []
    for l in q.limit(400).all():
        s = db.get(Shop, l.shop_id); p = db.get(Product, l.product_id)
        out.append({"id": l.id, "shop": s.name if s else "", "shop_id": l.shop_id,
                    "sku": p.sku if p else "", "name": p.name if p else "",
                    "platform_item_id": l.platform_item_id, "platform_sku_id": l.platform_sku_id,
                    "platform_title": l.platform_title, "platform_price": l.platform_price,
                    "platform_stock": l.platform_stock, "online_status": l.online_status,
                    "diff_price": round(l.platform_price - (p.sale_price if p else 0), 2)})
    return out


@router.get("/inventory")
def list_inventory(db: Session = Depends(get_db), kw: str = "", alert_only: bool = False):
    rows = []
    for inv in db.query(Inventory).all():
        p = db.get(Product, inv.product_id); w = db.get(Warehouse, inv.warehouse_id)
        if kw and kw not in (p.name + p.sku):
            continue
        if alert_only and inv.available >= inv.safety_stock:
            continue
        rows.append({"id": inv.id, "warehouse": w.name if w else "", "sku": p.sku,
                     "name": p.name, "on_hand": inv.on_hand, "locked": inv.locked,
                     "reserved": inv.reserved, "inbound": inv.inbound,
                     "safety_stock": inv.safety_stock, "available": inv.available,
                     "alert": inv.available < inv.safety_stock})
    rows.sort(key=lambda x: (not x["alert"], -x["available"]))
    return rows


class AdjustIn(BaseModel):
    warehouse_id: int
    product_id: int
    qty: int
    note: str = ""


@router.post("/inventory/adjust")
def adjust(body: AdjustIn, db: Session = Depends(get_db)):
    inv = svc.get_inv(db, body.warehouse_id, body.product_id)
    before = inv.available
    inv.on_hand = max(inv.on_hand + body.qty, 0)
    db.add(StockLedger(warehouse_id=inv.warehouse_id, product_id=body.product_id,
                       change_type="adjust", qty_change=body.qty,
                       before_available=before, after_available=inv.available,
                       ref_type="manual", ref_no=body.note or "手工调整", operator="admin"))
    svc.log(db, "admin", "库存调整", db.get(Product, body.product_id).sku, f"{body.qty:+d}")
    db.commit()
    return {"available": inv.available}


@router.get("/stock-ledger")
def stock_ledger(db: Session = Depends(get_db), limit: int = 80):
    rows = []
    for l in (db.query(StockLedger).order_by(StockLedger.id.desc()).limit(limit).all()):
        p = db.get(Product, l.product_id); w = db.get(Warehouse, l.warehouse_id)
        rows.append({"id": l.id, "time": l.created_at.strftime("%m-%d %H:%M"),
                     "warehouse": w.name if w else "", "sku": p.sku if p else "",
                     "name": p.name if p else "", "type": l.change_type,
                     "qty": l.qty_change, "before": l.before_available,
                     "after": l.after_available, "ref": l.ref_no, "operator": l.operator})
    return rows


@router.get("/warehouses")
def warehouses(db: Session = Depends(get_db)):
    out = []
    for w in db.query(Warehouse).all():
        invs = db.query(Inventory).filter_by(warehouse_id=w.id).all()
        out.append({"id": w.id, "code": w.code, "name": w.name, "wtype": w.wtype,
                    "city": w.city, "priority": w.priority, "enabled": w.enabled,
                    "skus": len(invs), "on_hand": sum(i.on_hand for i in invs),
                    "locked": sum(i.locked for i in invs),
                    "available": sum(i.available for i in invs)})
    return out


@router.get("/stock-rules")
def stock_rules(db: Session = Depends(get_db)):
    out = []
    for r in db.query(StockRule).all():
        w = db.get(Warehouse, r.warehouse_id)
        scope = "全局"
        if r.scope_type == "shop":
            s = db.get(Shop, r.scope_id); scope = f"店铺：{s.name if s else r.scope_id}"
        elif r.scope_type == "platform":
            p = db.get(Platform, r.scope_id); scope = f"平台：{p.name if p else r.scope_id}"
        out.append({"id": r.id, "name": r.name, "scope": scope, "scope_type": r.scope_type,
                    "warehouse": w.name if w else "", "priority": r.priority,
                    "share_ratio": r.share_ratio, "enabled": r.enabled})
    return out


class StockRuleIn(BaseModel):
    name: str
    scope_type: str = "global"
    scope_id: int = 0
    warehouse_id: int
    priority: int = 10
    share_ratio: float = 1.0


@router.post("/stock-rules")
def add_stock_rule(body: StockRuleIn, db: Session = Depends(get_db)):
    db.add(StockRule(**body.dict())); db.commit()
    return {"msg": "ok"}


@router.delete("/stock-rules/{rid}")
def del_stock_rule(rid: int, db: Session = Depends(get_db)):
    db.query(StockRule).filter_by(id=rid).delete(); db.commit()
    return {"msg": "ok"}


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    shop_rank = []
    for s in db.query(Shop).all():
        p = db.get(Platform, s.platform_id)
        amt = db.query(func.sum(Order.amount)).filter(
            Order.shop_id == s.id, Order.status == "shipped").scalar() or 0
        cnt = db.query(func.count(Order.id)).filter_by(shop_id=s.id).scalar()
        shop_rank.append({"shop": s.name, "platform": p.name if p else "",
                          "amount": round(amt, 2), "orders": cnt})
    shop_rank.sort(key=lambda x: -x["amount"])

    trend = []
    for i in range(6, -1, -1):
        d0 = today - timedelta(days=i)
        d1 = d0 + timedelta(days=1)
        c = db.query(func.count(Order.id)).filter(Order.created_at >= d0, Order.created_at < d1).scalar()
        a = db.query(func.sum(Order.amount)).filter(Order.created_at >= d0, Order.created_at < d1).scalar() or 0
        trend.append({"date": d0.strftime("%m-%d"), "orders": c, "amount": round(a, 2)})

    status_cnt = {}
    for st, c in db.query(Order.status, func.count(Order.id)).group_by(Order.status).all():
        status_cnt[st] = c

    wh_dist = []
    for w in db.query(Warehouse).all():
        invs = db.query(Inventory).filter_by(warehouse_id=w.id).all()
        wh_dist.append({"name": w.name, "on_hand": sum(i.on_hand for i in invs),
                        "locked": sum(i.locked for i in invs),
                        "available": sum(i.available for i in invs)})

    alerts = []
    for inv in db.query(Inventory).all():
        if inv.available < inv.safety_stock:
            p = db.get(Product, inv.product_id); w = db.get(Warehouse, inv.warehouse_id)
            alerts.append({"sku": p.sku, "name": p.name, "warehouse": w.name,
                           "available": inv.available, "safety": inv.safety_stock})

    return {
        "shops": db.query(func.count(Shop.id)).scalar(),
        "platforms": db.query(func.count(Platform.id)).scalar(),
        "skus": db.query(func.count(Product.id)).scalar(),
        "listings": db.query(func.count(ShopListing.id)).scalar(),
        "orders_total": db.query(func.count(Order.id)).scalar(),
        "today_orders": db.query(func.count(Order.id)).filter(Order.created_at >= today).scalar(),
        "pending": status_cnt.get("pending", 0),
        "auditing": status_cnt.get("auditing", 0),
        "waiting": status_cnt.get("waiting", 0),
        "shipped": status_cnt.get("shipped", 0),
        "intercepted": status_cnt.get("intercepted", 0),
        "gmv": round(db.query(func.sum(Order.amount)).filter(Order.status == "shipped").scalar() or 0, 2),
        "shop_rank": shop_rank[:10],
        "trend": trend, "wh_dist": wh_dist, "alerts": alerts[:12],
    }
