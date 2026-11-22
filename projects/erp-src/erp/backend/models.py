from datetime import datetime
from sqlalchemy import (Boolean, Column, DateTime, Float, ForeignKey, Integer,
                        String, Text, UniqueConstraint, Index)
from .db import Base


def now():
    return datetime.now()


class Platform(Base):
    """电商平台"""
    __tablename__ = "platform"
    id = Column(Integer, primary_key=True)
    code = Column(String(32), unique=True, nullable=False)      # taobao / jd / pdd / douyin
    name = Column(String(64), nullable=False)
    auth_type = Column(String(16), default="oauth")
    enabled = Column(Boolean, default=True)


class Shop(Base):
    """店铺：多店铺管理的核心实体"""
    __tablename__ = "shop"
    id = Column(Integer, primary_key=True)
    code = Column(String(48), unique=True, nullable=False)
    name = Column(String(128), nullable=False)
    platform_id = Column(Integer, ForeignKey("platform.id"), nullable=False)
    entity = Column(String(128), default="")                    # 经营主体/法人
    shop_group = Column(String(64), default="默认分组")           # 店铺分组
    auth_type = Column(String(16), default="oauth")
    auth_status = Column(String(16), default="authorized")      # authorized/expired/unauthorized
    authorized_at = Column(DateTime, default=now)
    expires_at = Column(DateTime, nullable=True)
    enabled = Column(Boolean, default=True)
    api_quota_day = Column(Integer, default=100000)
    api_used_day = Column(Integer, default=0)


class Product(Base):
    """系统商品 / SPU-SKU（统一商品池）"""
    __tablename__ = "product"
    id = Column(Integer, primary_key=True)
    sku = Column(String(64), unique=True, nullable=False)       # 系统SKU编码
    name = Column(String(200), nullable=False)
    category = Column(String(64), default="")
    brand = Column(String(64), default="")
    spec = Column(String(128), default="")                      # 多规格
    barcode = Column(String(64), default="")
    cost_price = Column(Float, default=0)
    sale_price = Column(Float, default=0)
    weight_kg = Column(Float, default=0.5)
    status = Column(String(16), default="active")               # active/inactive
    created_at = Column(DateTime, default=now)


class ShopListing(Base):
    """平台商品映射：一个系统SKU 映射多个平台商品"""
    __tablename__ = "shop_listing"
    __table_args__ = (UniqueConstraint("shop_id", "product_id", "platform_sku_id", name="uq_listing"),)
    id = Column(Integer, primary_key=True)
    shop_id = Column(Integer, ForeignKey("shop.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    platform_item_id = Column(String(64), default="")
    platform_sku_id = Column(String(64), default="")
    platform_title = Column(String(200), default="")
    platform_price = Column(Float, default=0)
    platform_stock = Column(Integer, default=0)
    online_status = Column(String(16), default="online")        # online/offline
    last_sync_at = Column(DateTime, default=now)


class Bundle(Base):
    """组合装 / BOM"""
    __tablename__ = "bundle"
    id = Column(Integer, primary_key=True)
    parent_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    child_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    qty = Column(Integer, default=1)


class Warehouse(Base):
    __tablename__ = "warehouse"
    id = Column(Integer, primary_key=True)
    code = Column(String(32), unique=True, nullable=False)
    name = Column(String(128), nullable=False)
    wtype = Column(String(16), default="自营")                   # 自营/三方云仓
    province = Column(String(32), default="")
    city = Column(String(32), default="")
    priority = Column(Integer, default=10)
    enabled = Column(Boolean, default=True)


class Inventory(Base):
    """库存池：可用 = 实物 - 锁定 - 预留 + 在途可按策略计入"""
    __tablename__ = "inventory"
    __table_args__ = (UniqueConstraint("warehouse_id", "product_id", name="uq_inv"),)
    id = Column(Integer, primary_key=True)
    warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    on_hand = Column(Integer, default=0)      # 实物库存
    locked = Column(Integer, default=0)       # 已锁定（已审单未发货）
    reserved = Column(Integer, default=0)     # 预留/安全库存占用
    inbound = Column(Integer, default=0)      # 在途（采购入库途中）
    safety_stock = Column(Integer, default=0) # 安全库存
    updated_at = Column(DateTime, default=now)

    @property
    def available(self):
        return max(self.on_hand - self.locked - self.reserved, 0)


class StockRule(Base):
    """库存分配规则：按店铺/平台/全局 决定从哪个仓出货、共享比例与安全库存"""
    __tablename__ = "stock_rule"
    id = Column(Integer, primary_key=True)
    name = Column(String(128), default="")
    scope_type = Column(String(16), default="global")   # global/platform/shop
    scope_id = Column(Integer, default=0)
    warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=False)
    priority = Column(Integer, default=10)              # 数值小者优先
    share_ratio = Column(Float, default=1.0)            # 该仓可出货比例
    enabled = Column(Boolean, default=True)


class StockLedger(Base):
    """库存流水：所有库存变动可追溯"""
    __tablename__ = "stock_ledger"
    id = Column(Integer, primary_key=True)
    warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    change_type = Column(String(32), nullable=False)    # lock/unlock/ship/cancel/purchase/adjust/transfer_in/transfer_out/return_in
    qty_change = Column(Integer, default=0)
    before_available = Column(Integer, default=0)
    after_available = Column(Integer, default=0)
    ref_type = Column(String(32), default="")
    ref_no = Column(String(64), default="")
    operator = Column(String(64), default="system")
    created_at = Column(DateTime, default=now)


class Carrier(Base):
    """快递公司"""
    __tablename__ = "carrier"
    id = Column(Integer, primary_key=True)
    code = Column(String(32), unique=True, nullable=False)
    name = Column(String(64), nullable=False)
    base_fee = Column(Float, default=6)
    per_kg_fee = Column(Float, default=1)
    remote_surcharge = Column(Float, default=8)         # 偏远地区附加费
    enabled = Column(Boolean, default=True)


class ShipRule(Base):
    """快递分配规则：条件 → 指定承运商"""
    __tablename__ = "ship_rule"
    id = Column(Integer, primary_key=True)
    name = Column(String(128), default="")
    priority = Column(Integer, default=10)
    province_key = Column(String(64), default="")        # 命中省份关键字，逗号分隔；空=不限
    max_weight = Column(Float, default=9999)             # 重量上限
    min_amount = Column(Float, default=0)
    shop_id = Column(Integer, default=0)                 # 0=不限店铺
    carrier_id = Column(Integer, ForeignKey("carrier.id"), nullable=False)
    enabled = Column(Boolean, default=True)


class AuditRule(Base):
    """审单规则：条件 → 通过/挂起/拦截"""
    __tablename__ = "audit_rule"
    id = Column(Integer, primary_key=True)
    name = Column(String(128), default="")
    priority = Column(Integer, default=10)
    cond_type = Column(String(32), default="min_amount")  # min_amount/max_amount/address_contains/remark_contains/out_of_stock/platform/shop
    cond_value = Column(String(200), default="")
    action = Column(String(16), default="hold")           # pass/hold/block
    reason = Column(String(200), default="")
    enabled = Column(Boolean, default=True)


class Order(Base):
    """统一订单池：跨平台跨店铺归集"""
    __tablename__ = "order"
    id = Column(Integer, primary_key=True)
    order_no = Column(String(64), unique=True, nullable=False)   # 平台订单号
    shop_id = Column(Integer, ForeignKey("shop.id"), nullable=False)
    buyer_nick = Column(String(128), default="")
    receiver_name = Column(String(64), default="")
    receiver_phone = Column(String(64), default="")               # 隐私号脱敏
    province = Column(String(32), default="")
    city = Column(String(32), default="")
    address = Column(String(300), default="")
    amount = Column(Float, default=0)
    freight = Column(Float, default=0)
    discount = Column(Float, default=0)
    weight_kg = Column(Float, default=0)
    status = Column(String(16), default="pending")   # pending/auditing/waiting/shipped/cancelled/intercepted
    audit_result = Column(String(16), default="")    # pass/hold/block
    audit_msg = Column(String(300), default="")
    warehouse_id = Column(Integer, nullable=True)
    carrier_id = Column(Integer, nullable=True)
    waybill_no = Column(String(64), default="")
    buyer_remark = Column(String(300), default="")
    is_presale = Column(Boolean, default=False)
    merge_key = Column(String(64), default="")       # 同买家合单键
    created_at = Column(DateTime, default=now)
    audited_at = Column(DateTime, nullable=True)
    shipped_at = Column(DateTime, nullable=True)


class OrderItem(Base):
    __tablename__ = "order_item"
    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("order.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    sku = Column(String(64), default="")
    name = Column(String(200), default="")
    qty = Column(Integer, default=1)
    price = Column(Float, default=0)


class PrintTemplate(Base):
    """打印模板：面单/发货单/拣货单…支持变量与条件打印"""
    __tablename__ = "print_template"
    id = Column(Integer, primary_key=True)
    code = Column(String(48), unique=True, nullable=False)
    name = Column(String(128), nullable=False)
    ttype = Column(String(32), default="waybill")    # waybill/picking/invoice/label/stocktake
    paper = Column(String(32), default="100x150")    # 纸张尺寸 mm
    width_mm = Column(Integer, default=100)
    height_mm = Column(Integer, default=150)
    is_default = Column(Boolean, default=True)
    enabled = Column(Boolean, default=True)
    content = Column(Text, default="")               # HTML + {{变量}}
    variables = Column(Text, default="[]")           # JSON 变量说明
    updated_at = Column(DateTime, default=now)


class OpLog(Base):
    __tablename__ = "op_log"
    id = Column(Integer, primary_key=True)
    user = Column(String(64), default="system")
    action = Column(String(64), default="")
    target = Column(String(128), default="")
    detail = Column(Text, default="")
    created_at = Column(DateTime, default=now)


class User(Base):
    __tablename__ = "user"
    id = Column(Integer, primary_key=True)
    username = Column(String(64), unique=True, nullable=False)
    name = Column(String(64), default="")
    role = Column(String(32), default="operator")    # admin/warehouse/cs/finance
    shop_scope = Column(Text, default="[]")          # JSON: 可访问的 shop_id 列表，空=全部
    enabled = Column(Boolean, default=True)


Index("ix_order_status", Order.status)
Index("ix_order_shop", Order.shop_id)
Index("ix_ledger_product", StockLedger.product_id)
