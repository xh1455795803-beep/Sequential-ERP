import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import AuditRule, Carrier, OpLog, Order, PrintTemplate, ShipRule, Shop, User
from .. import services as svc

router = APIRouter(prefix="/api", tags=["config"])


# ---------- 快递 ----------
@router.get("/carriers")
def carriers(db: Session = Depends(get_db)):
    return [{"id": c.id, "code": c.code, "name": c.name, "base_fee": c.base_fee,
             "per_kg_fee": c.per_kg_fee, "remote_surcharge": c.remote_surcharge,
             "enabled": c.enabled} for c in db.query(Carrier).all()]


@router.get("/ship-rules")
def ship_rules(db: Session = Depends(get_db)):
    out = []
    for r in db.query(ShipRule).order_by(ShipRule.priority).all():
        c = db.get(Carrier, r.carrier_id); s = db.get(Shop, r.shop_id) if r.shop_id else None
        out.append({"id": r.id, "name": r.name, "priority": r.priority,
                    "province_key": r.province_key, "max_weight": r.max_weight,
                    "min_amount": r.min_amount, "shop": s.name if s else "全部店铺",
                    "carrier": c.name if c else "", "enabled": r.enabled})
    return out


class ShipRuleIn(BaseModel):
    name: str
    priority: int = 10
    province_key: str = ""
    max_weight: float = 9999
    min_amount: float = 0
    shop_id: int = 0
    carrier_id: int


@router.post("/ship-rules")
def add_ship_rule(body: ShipRuleIn, db: Session = Depends(get_db)):
    db.add(ShipRule(**body.dict())); db.commit()
    return {"msg": "ok"}


@router.delete("/ship-rules/{rid}")
def del_ship_rule(rid: int, db: Session = Depends(get_db)):
    db.query(ShipRule).filter_by(id=rid).delete(); db.commit()
    return {"msg": "ok"}


# ---------- 审单规则 ----------
@router.get("/audit-rules")
def audit_rules(db: Session = Depends(get_db)):
    return [{"id": r.id, "name": r.name, "priority": r.priority, "cond_type": r.cond_type,
             "cond_value": r.cond_value, "action": r.action, "reason": r.reason,
             "enabled": r.enabled} for r in db.query(AuditRule).order_by(AuditRule.priority).all()]


class AuditRuleIn(BaseModel):
    name: str
    priority: int = 10
    cond_type: str
    cond_value: str = ""
    action: str
    reason: str = ""


@router.post("/audit-rules")
def add_audit_rule(body: AuditRuleIn, db: Session = Depends(get_db)):
    db.add(AuditRule(**body.dict())); db.commit()
    return {"msg": "ok"}


@router.delete("/audit-rules/{rid}")
def del_audit_rule(rid: int, db: Session = Depends(get_db)):
    db.query(AuditRule).filter_by(id=rid).delete(); db.commit()
    return {"msg": "ok"}


# ---------- 打印模板 ----------
@router.get("/templates")
def templates(db: Session = Depends(get_db)):
    return [{"id": t.id, "code": t.code, "name": t.name, "ttype": t.ttype,
             "paper": t.paper, "width_mm": t.width_mm, "height_mm": t.height_mm,
             "is_default": t.is_default, "enabled": t.enabled,
             "updated_at": t.updated_at.strftime("%m-%d %H:%M") if t.updated_at else ""}
            for t in db.query(PrintTemplate).all()]


@router.get("/templates/{tid}")
def get_template(tid: int, db: Session = Depends(get_db)):
    t = db.get(PrintTemplate, tid)
    if not t:
        raise HTTPException(404, "模板不存在")
    return {"id": t.id, "code": t.code, "name": t.name, "ttype": t.ttype,
            "width_mm": t.width_mm, "height_mm": t.height_mm, "content": t.content,
            "variables": json.loads(t.variables or "[]")}


class TplIn(BaseModel):
    name: str = ""
    content: str = ""
    width_mm: int = 100
    height_mm: int = 150


@router.put("/templates/{tid}")
def update_template(tid: int, body: TplIn, db: Session = Depends(get_db)):
    t = db.get(PrintTemplate, tid)
    if not t:
        raise HTTPException(404, "模板不存在")
    if body.name:
        t.name = body.name
    t.content = body.content
    t.width_mm, t.height_mm = body.width_mm, body.height_mm
    t.paper = f"{body.width_mm}x{body.height_mm}"
    t.updated_at = datetime.now()
    svc.log(db, "admin", "修改打印模板", t.code, t.name)
    db.commit()
    return {"msg": "已保存"}


@router.post("/templates/{tid}/preview")
def preview_template(tid: int, db: Session = Depends(get_db)):
    """用一笔真实订单渲染模板，所见即所得。"""
    t = db.get(PrintTemplate, tid)
    if not t:
        raise HTTPException(404, "模板不存在")
    o = (db.query(Order).filter_by(status="shipped").order_by(Order.id.desc()).first()
         or db.query(Order).order_by(Order.id.desc()).first())
    if not o:
        raise HTTPException(400, "暂无订单可预览")
    ctx = svc.build_print_ctx(db, o)
    return {"html": svc.render_template(t.content, ctx), "name": t.name,
            "w": t.width_mm, "h": t.height_mm, "order_no": o.order_no}


@router.get("/template-vars")
def template_vars():
    return [
        {"key": "shop_name", "desc": "店铺名称", "sample": "云集家居旗舰店"},
        {"key": "order_no", "desc": "平台订单号", "sample": "TB-00126102912345"},
        {"key": "buyer_nick", "desc": "买家昵称", "sample": "买家1024"},
        {"key": "receiver_name", "desc": "收件人", "sample": "张伟"},
        {"key": "receiver_phone", "desc": "收件电话(隐私号)", "sample": "138****8888"},
        {"key": "province", "desc": "省份", "sample": "浙江"},
        {"key": "city", "desc": "城市", "sample": "杭州"},
        {"key": "address", "desc": "详细地址", "sample": "西湖区文三路100号"},
        {"key": "warehouse_name", "desc": "发货仓", "sample": "杭州萧山主仓"},
        {"key": "carrier_name", "desc": "快递公司", "sample": "中通快递"},
        {"key": "waybill_no", "desc": "运单号", "sample": "ZTO881726610293"},
        {"key": "buyer_remark", "desc": "买家备注", "sample": "请发顺丰"},
        {"key": "date", "desc": "打印日期", "sample": "2026-10-29 20:30"},
        {"key": "amount", "desc": "订单金额", "sample": "258.00"},
        {"key": "freight", "desc": "运费", "sample": "8.00"},
        {"key": "__items", "desc": "商品明细循环块 {{#items}}…{{/items}}", "sample": "区块"},
    ]


# ---------- 系统 ----------
@router.get("/users")
def users(db: Session = Depends(get_db)):
    ROLE = {"admin": "超级管理员", "warehouse": "仓库主管", "cs": "客服组长", "finance": "财务专员"}
    return [{"id": u.id, "username": u.username, "name": u.name, "role": u.role,
             "role_label": ROLE.get(u.role, u.role), "enabled": u.enabled}
            for u in db.query(User).all()]


@router.get("/logs")
def logs(db: Session = Depends(get_db), limit: int = 60):
    return [{"id": l.id, "time": l.created_at.strftime("%m-%d %H:%M:%S"),
             "user": l.user, "action": l.action, "target": l.target, "detail": l.detail}
            for l in db.query(OpLog).order_by(OpLog.id.desc()).limit(limit).all()]


@router.get("/openapi-spec")
def openapi_spec(db: Session = Depends(get_db)):
    """对外接口清单（模拟开放平台文档）"""
    return [
        {"path": "POST /api/orders/{id}/audit", "desc": "订单审单（自动规则引擎）", "qps": "60次/分"},
        {"path": "POST /api/orders/{id}/ship", "desc": "订单发货并扣减库存", "qps": "60次/分"},
        {"path": "POST /api/orders/batch-audit", "desc": "批量审单", "qps": "10次/分"},
        {"path": "POST /api/simulate/inbound", "desc": "模拟平台推单（抓单）", "qps": "10次/分"},
        {"path": "GET  /api/inventory", "desc": "查询库存池与可用量", "qps": "300次/分"},
        {"path": "POST /api/inventory/adjust", "desc": "库存调整并写流水", "qps": "60次/分"},
        {"path": "GET  /api/orders", "desc": "订单池查询（支持状态/店铺/关键字）", "qps": "300次/分"},
        {"path": "GET  /api/listings", "desc": "平台商品映射查询", "qps": "300次/分"},
        {"path": "GET  /api/orders/{id}/print", "desc": "按模板渲染单据", "qps": "120次/分"},
    ]
