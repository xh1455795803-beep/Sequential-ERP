"""核心业务引擎：库存池与防超卖 / 审单规则 / 快递分配 / 拆合单 / 打印渲染"""
import json
import random
import re
import string
from datetime import datetime
from sqlalchemy import text as sa_text
from .models import (AuditRule, Bundle, Carrier, Inventory, OpLog, Order, OrderItem,
                     PrintTemplate, Product, ShipRule, Shop, ShopListing, StockLedger,
                     StockRule, Warehouse)

REMOTE_PROVINCES = ["新疆", "西藏", "内蒙古", "青海", "甘肃", "宁夏"]


# ---------------- 库存池 ----------------
def get_inv(db, warehouse_id, product_id, create=True):
    inv = db.query(Inventory).filter_by(warehouse_id=warehouse_id, product_id=product_id).first()
    if not inv and create:
        inv = Inventory(warehouse_id=warehouse_id, product_id=product_id)
        db.add(inv)
        db.flush()
    return inv


def available_qty(db, warehouse_id, product_id):
    inv = get_inv(db, warehouse_id, product_id, create=False)
    return inv.available if inv else 0


def global_available(db, product_id, warehouse_ids=None):
    q = db.query(Inventory).filter(Inventory.product_id == product_id)
    if warehouse_ids:
        q = q.filter(Inventory.warehouse_id.in_(warehouse_ids))
    return sum(i.available for i in q.all())


def pick_warehouses(db, shop_id, platform_id):
    """按库存分配规则选出候选仓（优先级升序），并应用共享比例。"""
    rules = (db.query(StockRule)
             .filter(StockRule.enabled.is_(True))
             .order_by(StockRule.scope_type.desc(), StockRule.priority.asc())
             .all())
    scoped = []
    for r in rules:
        if r.scope_type == "shop" and r.scope_id == shop_id:
            scoped.append(r)
        elif r.scope_type == "platform" and r.scope_id == platform_id:
            scoped.append(r)
        elif r.scope_type == "global":
            scoped.append(r)
    if not scoped:
        scoped = [type("R", (), {"warehouse_id": w.id, "share_ratio": 1.0})
                  for w in db.query(Warehouse).filter_by(enabled=True).all()]
    seen, out = set(), []
    for r in scoped:
        if r.warehouse_id not in seen:
            seen.add(r.warehouse_id)
            out.append(r)
    return out


def expand_bundle(db, product_id, qty):
    """组合装展开为子件需求。"""
    subs = db.query(Bundle).filter_by(parent_id=product_id).all()
    if not subs:
        return [(product_id, qty)]
    return [(s.child_id, s.qty * qty) for s in subs]


def try_lock(db, order: Order, operator="system"):
    """按仓分配并锁定库存。返回 (ok, detail)。
    防超卖核心：BEGIN IMMEDIATE 事务内读-判-写，任一商品不足则整单回滚。"""
    db.execute(sa_text("BEGIN IMMEDIATE"))
    items = db.query(OrderItem).filter_by(order_id=order.id).all()
    need = {}
    for it in items:
        for pid, q in expand_bundle(db, it.product_id, it.qty):
            need[pid] = need.get(pid, 0) + q

    whs = pick_warehouses(db, order.shop_id, _platform_of(db, order.shop_id))
    plan, locked_rows = {}, []
    try:
        for pid, qty in need.items():
            remain = qty
            for r in whs:
                if remain <= 0:
                    break
                inv = get_inv(db, r.warehouse_id, pid)
                share_cap = int(inv.on_hand * float(r.share_ratio or 1.0))
                usable = min(inv.available, max(share_cap - inv.locked, 0))
                take = min(usable, remain)
                if take <= 0:
                    continue
                before = inv.available
                inv.locked += take
                inv.updated_at = datetime.now()
                db.add(StockLedger(warehouse_id=inv.warehouse_id, product_id=pid,
                                   change_type="lock", qty_change=-take,
                                   before_available=before, after_available=inv.available,
                                   ref_type="order", ref_no=order.order_no, operator=operator))
                plan.setdefault(inv.warehouse_id, []).append({"product_id": pid, "qty": take})
                locked_rows.append((inv, take))
                remain -= take
            if remain > 0:
                raise ValueError(f"商品 {_sku(db, pid)} 库存不足，缺 {remain} 件")
        # 确定主发货仓：锁货最多的仓
        best_wid, best_n = None, -1
        for wid, rows in plan.items():
            n = sum(x["qty"] for x in rows)
            if n > best_n:
                best_wid, best_n = wid, n
        order.warehouse_id = best_wid
        db.flush()
        return True, {"warehouse_id": best_wid, "plan": plan}
    except ValueError as e:
        for inv, take in locked_rows:
            inv.locked -= take
        db.flush()
        return False, {"error": str(e)}


def release_stock(db, order, operator="system"):
    items = db.query(OrderItem).filter_by(order_id=order.id).all()
    need = {}
    for it in items:
        for pid, q in expand_bundle(db, it.product_id, it.qty):
            need[pid] = need.get(pid, 0) + q
    for pid, qty in need.items():
        remain = qty
        for inv in (db.query(Inventory).filter_by(product_id=pid)
                    .order_by(Inventory.locked.desc()).all()):
            if remain <= 0:
                break
            take = min(inv.locked, remain)
            if take <= 0:
                continue
            before = inv.available
            inv.locked -= take
            db.add(StockLedger(warehouse_id=inv.warehouse_id, product_id=pid,
                               change_type="unlock", qty_change=take,
                               before_available=before, after_available=inv.available,
                               ref_type="order", ref_no=order.order_no, operator=operator))
            remain -= take


def deduct_on_ship(db, order, operator="system"):
    items = db.query(OrderItem).filter_by(order_id=order.id).all()
    need = {}
    for it in items:
        for pid, q in expand_bundle(db, it.product_id, it.qty):
            need[pid] = need.get(pid, 0) + q
    for pid, qty in need.items():
        remain = qty
        for inv in (db.query(Inventory).filter_by(product_id=pid)
                    .order_by(Inventory.locked.desc()).all()):
            if remain <= 0:
                break
            take = min(inv.locked, remain)
            if take <= 0:
                continue
            before = inv.available
            inv.locked -= take
            inv.on_hand -= take
            db.add(StockLedger(warehouse_id=inv.warehouse_id, product_id=pid,
                               change_type="ship", qty_change=-take,
                               before_available=before, after_available=inv.available,
                               ref_type="order", ref_no=order.order_no, operator=operator))
            remain -= take


def _sku(db, pid):
    p = db.get(Product, pid)
    return p.sku if p else f"#{pid}"


def _platform_of(db, shop_id):
    s = db.get(Shop, shop_id)
    return s.platform_id if s else 0


# ---------------- 审单规则引擎 ----------------
def run_audit(db, order: Order, operator="system") -> dict:
    rules = (db.query(AuditRule).filter(AuditRule.enabled.is_(True))
             .order_by(AuditRule.priority.asc()).all())
    ctx = {
        "amount": order.amount, "province": order.province or "",
        "address": order.address or "", "buyer_remark": order.buyer_remark or "",
        "platform_id": _platform_of(db, order.shop_id), "shop_id": order.shop_id,
    }
    for r in rules:
        hit = False
        if r.cond_type == "min_amount":
            hit = ctx["amount"] >= float(r.cond_value or 0)
        elif r.cond_type == "max_amount":
            hit = ctx["amount"] <= float(r.cond_value or 0)
        elif r.cond_type == "address_contains":
            hit = any(k.strip() and k.strip() in ctx["address"] + ctx["province"]
                      for k in (r.cond_value or "").split(","))
        elif r.cond_type == "remark_contains":
            hit = any(k.strip() and k.strip() in ctx["buyer_remark"]
                      for k in (r.cond_value or "").split(","))
        elif r.cond_type == "platform":
            hit = str(ctx["platform_id"]) == (r.cond_value or "").strip()
        elif r.cond_type == "shop":
            hit = str(ctx["shop_id"]) == (r.cond_value or "").strip()
        elif r.cond_type == "out_of_stock":
            items = db.query(OrderItem).filter_by(order_id=order.id).all()
            hit = any(global_available(db, it.product_id) < it.qty for it in items)
        if hit:
            return {"action": r.action, "rule": r.name, "reason": r.reason}
    return {"action": "pass", "rule": "默认通过", "reason": "未命中任何拦截规则"}


# ---------------- 快递分配 ----------------
def match_carrier(db, order: Order):
    rules = (db.query(ShipRule).filter(ShipRule.enabled.is_(True))
             .order_by(ShipRule.priority.asc()).all())
    for r in rules:
        if r.shop_id and r.shop_id != order.shop_id:
            continue
        if order.weight_kg and order.weight_kg > float(r.max_weight or 9999):
            continue
        if order.amount and order.amount < float(r.min_amount or 0):
            continue
        if r.province_key:
            keys = [k.strip() for k in r.province_key.split(",") if k.strip()]
            if keys and not any(k in (order.province or "") for k in keys):
                continue
        return r.carrier_id, r.name
    c = db.query(Carrier).filter_by(enabled=True).first()
    return (c.id if c else None), "默认承运商"


def calc_freight(db, order, carrier_id):
    c = db.get(Carrier, carrier_id)
    if not c:
        return 0
    fee = float(c.base_fee) + max(order.weight_kg or 0.5, 0) * float(c.per_kg_fee)
    if any(p in (order.province or "") for p in REMOTE_PROVINCES):
        fee += float(c.remote_surcharge)
    return round(fee, 2)


def gen_waybill_no(carrier_code):
    rnd = "".join(random.choices(string.digits, k=12))
    return f"{carrier_code.upper()}{rnd}"


# ---------------- 打印模板渲染 ----------------
DEFAULT_TEMPLATES = [
    ("waybill_default", "标准电子面单 100x150", "waybill", 100, 150,
     """<div class="wb">
  <div class="row"><b>{{carrier_name}}</b> <span class="barcode">{{waybill_no}}</span></div>
  <div class="hr"></div>
  <div class="row"><span class="lab">收件人</span> {{receiver_name}} {{receiver_phone}}</div>
  <div class="row addr">{{province}}{{city}} {{address}}</div>
  <div class="hr"></div>
  <div class="row"><span class="lab">寄件人</span> {{warehouse_name}} {{warehouse_phone}}</div>
  <div class="hr"></div>
  <div class="row"><span class="lab">店铺</span> {{shop_name}} <span class="lab">订单</span> {{order_no}}</div>
  {{#items}}
  <div class="row it">· {{name}} × {{qty}}</div>
  {{/items}}
  <div class="row"><span class="lab">备注</span> {{buyer_remark}}</div>
</div>"""),
    ("picking_default", "标准拣货单 A4", "picking", 210, 297,
     """<div class="pk">
  <h3>拣货单 · {{warehouse_name}}</h3>
  <div class="meta">波次：{{order_no}} ｜ 店铺：{{shop_name}} ｜ 快递：{{carrier_name}}</div>
  <table class="tb"><thead><tr><th>库位</th><th>SKU</th><th>商品</th><th>数量</th><th>✓</th></tr></thead>
  <tbody>{{#items}}<tr><td>{{location}}</td><td>{{sku}}</td><td>{{name}}</td><td>{{qty}}</td><td></td></tr>{{/items}}</tbody></table>
  <div class="foot">拣货人：__________ 复核：__________ 日期：{{date}}</div>
</div>"""),
    ("invoice_default", "发货单 A5", "invoice", 148, 210,
     """<div class="iv">
  <h3>发货单</h3>
  <div class="meta">订单号：{{order_no}} ｜ {{shop_name}} ｜ {{date}}</div>
  <div class="row">买家：{{buyer_nick}} ｜ 收件：{{receiver_name}} {{receiver_phone}}</div>
  <div class="row addr">{{province}}{{city}} {{address}}</div>
  <table class="tb"><thead><tr><th>SKU</th><th>商品</th><th>单价</th><th>数量</th><th>小计</th></tr></thead>
  <tbody>{{#items}}<tr><td>{{sku}}</td><td>{{name}}</td><td>{{price}}</td><td>{{qty}}</td><td>{{subtotal}}</td></tr>{{/items}}</tbody></table>
  <div class="row">运费：{{freight}} ｜ 优惠：{{discount}} ｜ <b>合计：{{amount}}</b></div>
</div>"""),
    ("label_default", "商品条码标签 50x30", "label", 50, 30,
     """<div class="lb"><div class="nm">{{name}}</div><div class="bc">{{sku}}</div><div class="pr">￥{{price}}</div></div>"""),
    ("stocktake_default", "盘点单 A4", "stocktake", 210, 297,
     """<div class="st"><h3>盘点单 · {{warehouse_name}}</h3>
  <div class="meta">单号：{{order_no}} ｜ 日期：{{date}}</div>
  <table class="tb"><thead><tr><th>库位</th><th>SKU</th><th>商品</th><th>账面</th><th>实盘</th><th>差异</th></tr></thead>
  <tbody>{{#items}}<tr><td>{{location}}</td><td>{{sku}}</td><td>{{name}}</td><td>{{qty}}</td><td></td><td></td></tr>{{/items}}</tbody></table>
</div>"""),
]


def render_template(content: str, ctx: dict) -> str:
    """支持 {{var}} 与 {{#items}}...{{/items}} 区块循环。"""
    def loop_block(tpl, key, rows):
        pat = re.compile(r"\{\{#%s\}\}(.*?)\{\{/%s\}\}" % (key, key), re.S)
        m = pat.search(tpl)
        if not m:
            return tpl
        inner = m.group(1)
        out = "".join(_fill(inner, r) for r in rows) if rows else _fill(inner, {})
        return pat.sub(out, tpl)

    def _fill(s, d):
        return re.sub(r"\{\{(\w+)\}\}", lambda mo: str(d.get(mo.group(1), "")), s)

    out = content or ""
    items = ctx.pop("__items", [])
    out = loop_block(out, "items", items)
    return _fill(out, ctx)


def build_print_ctx(db, order):
    shop = db.get(Shop, order.shop_id)
    wh = db.get(Warehouse, order.warehouse_id) if order.warehouse_id else None
    car = db.get(Carrier, order.carrier_id) if order.carrier_id else None
    items = db.query(OrderItem).filter_by(order_id=order.id).all()
    rows = []
    for it in items:
        p = db.get(Product, it.product_id)
        rows.append({
            "sku": it.sku, "name": it.name, "qty": it.qty,
            "price": f"{it.price:.2f}", "subtotal": f"{it.price * it.qty:.2f}",
            "location": f"{wh.code if wh else 'A'}-{str(it.product_id).zfill(3)}-01",
        })
    return {
        "order_no": order.order_no, "shop_name": shop.name if shop else "",
        "buyer_nick": order.buyer_nick, "receiver_name": order.receiver_name,
        "receiver_phone": order.receiver_phone, "province": order.province,
        "city": order.city, "address": order.address, "amount": f"{order.amount:.2f}",
        "freight": f"{order.freight:.2f}", "discount": f"{order.discount:.2f}",
        "buyer_remark": order.buyer_remark or "无",
        "warehouse_name": wh.name if wh else "", "warehouse_phone": "0571-8888-8888",
        "carrier_name": car.name if car else "", "waybill_no": order.waybill_no or "待生成",
        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "__items": rows,
    }


def log(db, user, action, target="", detail=""):
    db.add(OpLog(user=user, action=action, target=target, detail=detail))
