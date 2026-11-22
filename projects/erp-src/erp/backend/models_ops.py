"""扩展业务模型：采购供应链 / 仓储作业 WMS / 售后 / 财务对账"""
from datetime import datetime
from sqlalchemy import (Boolean, Column, DateTime, Float, ForeignKey, Integer,
                        String, Text, UniqueConstraint, Index)
from .db import Base


def now():
    return datetime.now()


# ==================== 采购与供应链 ====================
class Supplier(Base):
    """供应商"""
    __tablename__ = "supplier"
    id = Column(Integer, primary_key=True)
    code = Column(String(32), unique=True, nullable=False)
    name = Column(String(128), nullable=False)
    contact = Column(String(64), default="")
    phone = Column(String(32), default="")
    tax_no = Column(String(48), default="")
    bank = Column(String(128), default="")
    pay_term = Column(String(32), default="月结30天")
    lead_days = Column(Integer, default=7)          # 采购提前期
    credit_limit = Column(Float, default=200000)    # 信用额度
    score = Column(Integer, default=90)             # 供应商评分
    status = Column(String(16), default="active")   # active/stop


class PurchaseOrder(Base):
    """采购单"""
    __tablename__ = "purchase_order"
    id = Column(Integer, primary_key=True)
    po_no = Column(String(48), unique=True, nullable=False)
    supplier_id = Column(Integer, ForeignKey("supplier.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=False)
    status = Column(String(16), default="draft")    # draft/approved/partial/received/cancelled
    amount = Column(Float, default=0)
    expect_date = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=True)
    buyer = Column(String(64), default="采购部")
    remark = Column(String(300), default="")
    created_at = Column(DateTime, default=now)


class PurchaseItem(Base):
    __tablename__ = "purchase_item"
    id = Column(Integer, primary_key=True)
    po_id = Column(Integer, ForeignKey("purchase_order.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    sku = Column(String(64), default="")
    name = Column(String(200), default="")
    qty = Column(Integer, default=0)                # 采购量
    received_qty = Column(Integer, default=0)       # 已到货
    price = Column(Float, default=0)                # 采购单价
    tax_rate = Column(Float, default=0.13)


class Receipt(Base):
    """到货入库单"""
    __tablename__ = "receipt"
    id = Column(Integer, primary_key=True)
    rc_no = Column(String(48), unique=True, nullable=False)
    po_id = Column(Integer, ForeignKey("purchase_order.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=False)
    status = Column(String(16), default="pending")  # pending/checked/rejected
    qc_pass = Column(Boolean, default=True)
    operator = Column(String(64), default="仓管")
    created_at = Column(DateTime, default=now)


class PurchaseReturn(Base):
    """采购退货单"""
    __tablename__ = "purchase_return"
    id = Column(Integer, primary_key=True)
    rt_no = Column(String(48), unique=True, nullable=False)
    po_id = Column(Integer, ForeignKey("purchase_order.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    qty = Column(Integer, default=0)
    amount = Column(Float, default=0)
    reason = Column(String(200), default="来料不良")
    status = Column(String(16), default="pending")  # pending/done
    created_at = Column(DateTime, default=now)


# ==================== 仓储作业 WMS ====================
class Location(Base):
    """库位"""
    __tablename__ = "location"
    __table_args__ = (UniqueConstraint("warehouse_id", "code", name="uq_loc"),)
    id = Column(Integer, primary_key=True)
    warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=False)
    code = Column(String(32), nullable=False)       # A-01-02
    zone = Column(String(32), default="A区")         # 库区
    ltype = Column(String(16), default="拣货位")     # 拣货位/存储位/暂存位/不良品位
    enabled = Column(Boolean, default=True)


class StockBatch(Base):
    """批次与效期"""
    __tablename__ = "stock_batch"
    id = Column(Integer, primary_key=True)
    warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    batch_no = Column(String(48), nullable=False)
    qty = Column(Integer, default=0)
    cost_price = Column(Float, default=0)
    produced_at = Column(DateTime, nullable=True)
    expire_at = Column(DateTime, nullable=True)
    location_code = Column(String(32), default="")
    created_at = Column(DateTime, default=now)


class PickWave(Base):
    """拣货波次"""
    __tablename__ = "pick_wave"
    id = Column(Integer, primary_key=True)
    wave_no = Column(String(48), unique=True, nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=False)
    strategy = Column(String(16), default="摘果式")   # 摘果式/播种式
    order_count = Column(Integer, default=0)
    sku_count = Column(Integer, default=0)
    qty_total = Column(Integer, default=0)
    status = Column(String(16), default="created")    # created/picking/packed/done
    picker = Column(String(64), default="")
    created_at = Column(DateTime, default=now)
    finished_at = Column(DateTime, nullable=True)


class PickTask(Base):
    """波次拣货明细任务"""
    __tablename__ = "pick_task"
    id = Column(Integer, primary_key=True)
    wave_id = Column(Integer, ForeignKey("pick_wave.id"), nullable=False)
    order_id = Column(Integer, ForeignKey("order.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    sku = Column(String(64), default="")
    name = Column(String(200), default="")
    location_code = Column(String(32), default="")
    qty = Column(Integer, default=0)
    picked_qty = Column(Integer, default=0)
    status = Column(String(16), default="pending")    # pending/picked/short


class PackCheck(Base):
    """验货打包称重记录"""
    __tablename__ = "pack_check"
    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("order.id"), nullable=False)
    wave_id = Column(Integer, ForeignKey("pick_wave.id"), nullable=True)
    weight_kg = Column(Float, default=0)
    freight = Column(Float, default=0)
    carrier_id = Column(Integer, ForeignKey("carrier.id"), nullable=True)
    waybill_no = Column(String(64), default="")
    result = Column(String(16), default="pass")       # pass/short/damage
    operator = Column(String(64), default="")
    checked_at = Column(DateTime, default=now)


class Stocktake(Base):
    """盘点单"""
    __tablename__ = "stocktake"
    id = Column(Integer, primary_key=True)
    st_no = Column(String(48), unique=True, nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=False)
    mode = Column(String(16), default="明盘")          # 明盘/暗盘
    status = Column(String(16), default="draft")       # draft/counting/review/done
    sku_count = Column(Integer, default=0)
    diff_qty = Column(Integer, default=0)
    diff_amount = Column(Float, default=0)
    operator = Column(String(64), default="")
    created_at = Column(DateTime, default=now)


class StocktakeItem(Base):
    __tablename__ = "stocktake_item"
    id = Column(Integer, primary_key=True)
    st_id = Column(Integer, ForeignKey("stocktake.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    sku = Column(String(64), default="")
    name = Column(String(200), default="")
    location_code = Column(String(32), default="")
    book_qty = Column(Integer, default=0)            # 账面
    real_qty = Column(Integer, default=0)            # 实盘
    cost_price = Column(Float, default=0)

    @property
    def diff(self):
        return (self.real_qty or 0) - (self.book_qty or 0)


class Transfer(Base):
    """库内调拨 / 移仓"""
    __tablename__ = "transfer"
    id = Column(Integer, primary_key=True)
    tf_no = Column(String(48), unique=True, nullable=False)
    from_warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=False)
    to_warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    qty = Column(Integer, default=0)
    status = Column(String(16), default="draft")     # draft/shipped/received
    operator = Column(String(64), default="")
    created_at = Column(DateTime, default=now)


# ==================== 售后 ====================
class AfterSale(Base):
    """售后工单"""
    __tablename__ = "after_sale"
    id = Column(Integer, primary_key=True)
    as_no = Column(String(48), unique=True, nullable=False)
    order_id = Column(Integer, ForeignKey("order.id"), nullable=False)
    order_no = Column(String(64), default="")
    shop_id = Column(Integer, ForeignKey("shop.id"), nullable=False)
    buyer_nick = Column(String(128), default="")
    atype = Column(String(16), default="refund")     # refund(仅退款)/return(退货退款)/exchange(换货)/resend(补发)/repair(维修)
    reason = Column(String(200), default="")
    amount = Column(Float, default=0)                # 退款金额
    status = Column(String(16), default="pending")   # pending/approved/processing/done/rejected
    need_return = Column(Boolean, default=True)
    returned = Column(Boolean, default=False)        # 货是否退回
    restock = Column(Boolean, default=False)         # 是否重新入库
    warehouse_id = Column(Integer, ForeignKey("warehouse.id"), nullable=True)
    handler = Column(String(64), default="")
    created_at = Column(DateTime, default=now)
    finished_at = Column(DateTime, nullable=True)


class AfterSaleItem(Base):
    __tablename__ = "after_sale_item"
    id = Column(Integer, primary_key=True)
    as_id = Column(Integer, ForeignKey("after_sale.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("product.id"), nullable=False)
    sku = Column(String(64), default="")
    name = Column(String(200), default="")
    qty = Column(Integer, default=1)
    price = Column(Float, default=0)
    quality = Column(String(16), default="good")     # good(良品可再售)/bad(次品)


# ==================== 财务与对账 ====================
class PlatformBill(Base):
    """平台账单"""
    __tablename__ = "platform_bill"
    id = Column(Integer, primary_key=True)
    bill_no = Column(String(48), unique=True, nullable=False)
    shop_id = Column(Integer, ForeignKey("shop.id"), nullable=False)
    platform_id = Column(Integer, ForeignKey("platform.id"), nullable=False)
    period = Column(String(16), default="")          # 2026-10
    order_amount = Column(Float, default=0)          # 订单金额
    commission = Column(Float, default=0)            # 平台佣金
    service_fee = Column(Float, default=0)           # 服务费
    ad_fee = Column(Float, default=0)                # 广告费
    refund_amount = Column(Float, default=0)         # 退款
    freight_fee = Column(Float, default=0)           # 运费
    other_fee = Column(Float, default=0)
    settle_amount = Column(Float, default=0)         # 结算金额
    status = Column(String(16), default="pending")   # pending/reconciled/settled
    created_at = Column(DateTime, default=now)


class BillFee(Base):
    """账单费用明细（用于分摊到订单/SKU）"""
    __tablename__ = "bill_fee"
    id = Column(Integer, primary_key=True)
    bill_id = Column(Integer, ForeignKey("platform_bill.id"), nullable=False)
    fee_type = Column(String(32), default="")        # 佣金/服务费/广告/支付手续费/退款
    amount = Column(Float, default=0)
    order_no = Column(String(64), default="")
    remark = Column(String(200), default="")


class ApAr(Base):
    """应收应付"""
    __tablename__ = "ap_ar"
    id = Column(Integer, primary_key=True)
    direction = Column(String(16), default="ar")     # ar应收 / ap应付
    partner_type = Column(String(16), default="platform")  # platform/supplier/customer
    partner_id = Column(Integer, default=0)
    partner_name = Column(String(128), default="")
    ref_no = Column(String(64), default="")          # 关联单号
    amount = Column(Float, default=0)
    settled_amount = Column(Float, default=0)
    due_date = Column(DateTime, nullable=True)
    status = Column(String(16), default="open")      # open/partial/closed
    created_at = Column(DateTime, default=now)


class ProfitRecord(Base):
    """订单利润核算"""
    __tablename__ = "profit_record"
    id = Column(Integer, primary_key=True)
    order_no = Column(String(64), nullable=False)
    shop_id = Column(Integer, ForeignKey("shop.id"), nullable=False)
    order_id = Column(Integer, ForeignKey("order.id"), nullable=True)
    revenue = Column(Float, default=0)               # 收入
    goods_cost = Column(Float, default=0)            # 商品成本
    freight_cost = Column(Float, default=0)          # 运费成本
    platform_fee = Column(Float, default=0)          # 平台费用
    ad_fee = Column(Float, default=0)                # 分摊广告
    pack_cost = Column(Float, default=0)             # 包材
    gross_profit = Column(Float, default=0)          # 毛利
    net_profit = Column(Float, default=0)            # 净利
    margin = Column(Float, default=0)                # 净利率
    created_at = Column(DateTime, default=now)


Index("ix_po_supplier", PurchaseOrder.supplier_id)
Index("ix_as_order", AfterSale.order_id)
Index("ix_bill_shop", PlatformBill.shop_id)
Index("ix_profit_shop", ProfitRecord.shop_id)
