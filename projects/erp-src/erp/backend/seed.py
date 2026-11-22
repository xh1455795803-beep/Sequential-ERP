"""初始化演示数据：模拟一家经营 12 家店铺、3 个仓的多平台商家。"""
import json
import random
from datetime import datetime, timedelta
from sqlalchemy import text as sa_text
from .db import SessionLocal, engine, Base
from .models import (AuditRule, Bundle, Carrier, Inventory, OpLog, Order, OrderItem,
                     Platform, PrintTemplate, Product, Shop, ShopListing, ShipRule,
                     StockLedger, StockRule, User, Warehouse)
from . import models_ops  # noqa: F401  确保扩展模型注册表参与 create_all
from . import services

PLATFORMS = [
    ("taobao", "淘宝"), ("tmall", "天猫"), ("jd", "京东"), ("pdd", "拼多多"),
    ("douyin", "抖音小店"), ("kuaishou", "快手小店"), ("xhs", "小红书"), ("wxvideo", "视频号小店"),
]

SHOPS = [
    ("TB-001", "云集家居旗舰店", "taobao", "杭州云集电子商务有限公司", "家居事业部"),
    ("TB-002", "云集日用专营店", "taobao", "杭州云集电子商务有限公司", "家居事业部"),
    ("TM-001", "云集家居官方旗舰店", "tmall", "杭州云集电子商务有限公司", "家居事业部"),
    ("JD-001", "云集家居京东自营店", "jd", "杭州云集电子商务有限公司", "家居事业部"),
    ("JD-002", "云集厨具京东店", "jd", "杭州云集供应链管理有限公司", "厨具事业部"),
    ("PDD-001", "云集家居拼多多店", "pdd", "杭州云集供应链管理有限公司", "厨具事业部"),
    ("DY-001", "云集家居抖音旗舰店", "douyin", "杭州云集直播服务有限公司", "直播事业部"),
    ("DY-002", "云集好物抖音店", "douyin", "杭州云集直播服务有限公司", "直播事业部"),
    ("KS-001", "云集快手小店", "kuaishou", "杭州云集直播服务有限公司", "直播事业部"),
    ("XHS-001", "云集生活小红书店", "xhs", "杭州云集电子商务有限公司", "内容事业部"),
    ("WXS-001", "云集视频号小店", "wxvideo", "杭州云集电子商务有限公司", "内容事业部"),
    ("PDD-002", "云集清仓拼多多店", "pdd", "杭州云集供应链管理有限公司", "厨具事业部"),
]

PRODUCTS = [
    ("SKU-1001", "北欧简约收纳箱 大号", "家居收纳", "云集", "灰色/40L", "6901001001001", 28.5, 69, 1.2),
    ("SKU-1002", "北欧简约收纳箱 中号", "家居收纳", "云集", "灰色/25L", "6901001001002", 19.0, 49, 0.8),
    ("SKU-1003", "折叠衣物收纳袋 3只装", "家居收纳", "云集", "米白", "6901001001003", 15.0, 39, 0.4),
    ("SKU-1004", "厨房多层置物架", "厨房用具", "云集", "黑色/3层", "6901001001004", 46.0, 119, 3.5),
    ("SKU-1005", "不锈钢厨具六件套", "厨房用具", "云集", "银色", "6901001001005", 62.0, 158, 2.1),
    ("SKU-1006", "硅胶铲勺套装", "厨房用具", "云集", "莫兰迪色", "6901001001006", 12.0, 35, 0.3),
    ("SKU-1007", "竹木砧板 加厚", "厨房用具", "云集", "原木/大", "6901001001007", 24.0, 59, 1.5),
    ("SKU-1008", "真空保鲜盒 4件套", "厨房用具", "云集", "透明", "6901001001008", 33.0, 89, 1.8),
    ("SKU-1009", "轻奢陶瓷餐具 12头", "餐具", "云集", "白釉", "6901001001009", 88.0, 239, 4.2),
    ("SKU-1010", "马克杯 情侣款 2只", "餐具", "云集", "白+灰", "6901001001010", 18.0, 49, 0.9),
    ("SKU-1011", "棉麻抱枕套 2只装", "家纺", "云集", "豆绿", "6901001001011", 21.0, 59, 0.6),
    ("SKU-1012", "全棉四件套 1.8m", "家纺", "云集", "燕麦色", "6901001001012", 118.0, 299, 2.6),
    ("SKU-1013", "免安装晾衣架", "家居收纳", "云集", "银色/升降", "6901001001013", 55.0, 149, 4.0),
    ("SKU-1014", "浴室防滑地垫", "卫浴", "云集", "灰/40x60", "6901001001014", 14.0, 39, 0.5),
    ("SKU-1015", "电动牙刷 充电款", "个护", "云集", "白", "6901001001015", 68.0, 179, 0.7),
    ("SKU-1016", "香薰蜡烛礼盒", "家居香氛", "云集", "雪松", "6901001001016", 39.0, 99, 0.8),
    ("SKU-1017", "厨房清洁湿巾 5包", "清洁", "云集", "柠檬", "6901001001017", 16.0, 45, 1.1),
    ("SKU-1018", "保温杯 500ml", "杯具", "云集", "哑光黑", "6901001001018", 35.0, 89, 0.6),
    ("BUNDLE-01", "厨房新手套装（组合装）", "组合装", "云集", "套装", "6901001009001", 98.0, 258, 4.0),
    ("BUNDLE-02", "收纳三件套（组合装）", "组合装", "云集", "套装", "6901001009002", 62.5, 157, 2.4),
]

BUNDLES = [
    ("BUNDLE-01", [("SKU-1004", 1), ("SKU-1006", 1), ("SKU-1007", 1)]),
    ("BUNDLE-02", [("SKU-1001", 1), ("SKU-1002", 1), ("SKU-1003", 1)]),
]

WAREHOUSES = [
    ("WH-HZ", "杭州萧山主仓", "自营", "浙江", "杭州", 1),
    ("WH-GZ", "广州白云分仓", "自营", "广东", "广州", 2),
    ("WH-CD", "成都三方云仓", "三方云仓", "四川", "成都", 3),
]

CARRIERS = [
    ("sf", "顺丰速运", 12, 2, 10), ("zto", "中通快递", 5.5, 1.2, 8),
    ("yto", "圆通速递", 5.2, 1.1, 8), ("yunda", "韵达快递", 5.0, 1.1, 8),
    ("sto", "申通快递", 5.0, 1.0, 9), ("jt", "极兔速递", 4.5, 1.0, 9),
    ("ems", "中国邮政", 6.0, 1.5, 5),
]

NAMES = ["张伟", "李娜", "王芳", "刘洋", "陈静", "杨帆", "赵敏", "孙磊", "周婷", "吴昊",
         "徐晶", "马超", "朱琳", "胡军", "郭强", "林曦", "何洁", "高鹏", "罗雪", "谢宇"]
PROV = [("浙江", "杭州", "西湖区文三路"), ("广东", "广州", "天河区珠江新城"),
        ("江苏", "南京", "鼓楼区中山北路"), ("四川", "成都", "武侯区天府大道"),
        ("北京", "北京", "朝阳区建国路"), ("上海", "上海", "浦东新区世纪大道"),
        ("山东", "青岛", "市南区香港中路"), ("湖北", "武汉", "洪山区珞喻路"),
        ("新疆", "乌鲁木齐", "天山区解放北路"), ("西藏", "拉萨", "城关区北京中路")]
REMARKS = ["", "", "", "请发顺丰", "尽快发货", "工作日送达", "需要发票", "改地址联系我", "送礼勿放价格单"]


def db_listings(sess, shop_id):
    return sess.query(ShopListing).filter_by(shop_id=shop_id, online_status="online").all()


def build(sess):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    pmap = {}
    for code, name in PLATFORMS:
        p = Platform(code=code, name=name, auth_type="oauth", enabled=True)
        sess.add(p); sess.flush(); pmap[code] = p.id

    smap = {}
    for code, name, pc, ent, grp in SHOPS:
        s = Shop(code=code, name=name, platform_id=pmap[pc], entity=ent, shop_group=grp,
                 auth_type="oauth", auth_status="authorized",
                 authorized_at=datetime.now() - timedelta(days=random.randint(30, 300)))
        sess.add(s); sess.flush(); smap[code] = s.id

    prod = {}
    for sku, name, cat, brand, spec, bar, cost, price, w in PRODUCTS:
        p = Product(sku=sku, name=name, category=cat, brand=brand, spec=spec, barcode=bar,
                    cost_price=cost, sale_price=price, weight_kg=w)
        sess.add(p); sess.flush(); prod[sku] = p

    for psku, childs in BUNDLES:
        for csku, q in childs:
            sess.add(Bundle(parent_id=prod[psku].id, child_id=prod[csku].id, qty=q))

    wmap = {}
    for code, name, wt, pv, ct, pr in WAREHOUSES:
        w = Warehouse(code=code, name=name, wtype=wt, province=pv, city=ct, priority=pr)
        sess.add(w); sess.flush(); wmap[code] = w.id

    # 平台商品映射：每个店铺上架约 12 个 SKU
    for scode, sid in smap.items():
        picks = random.sample(list(prod.values()), 12)
        for p in picks:
            sess.add(ShopListing(
                shop_id=sid, product_id=p.id,
                platform_item_id=f"{scode}-IT{random.randint(100000, 999999)}",
                platform_sku_id=f"{p.sku}-{scode}",
                platform_title=p.name + " " + p.spec,
                platform_price=round(p.sale_price * random.uniform(0.85, 1.15), 2),
                platform_stock=random.randint(0, 500),
                online_status=random.choice(["online", "online", "online", "offline"]),
            ))

    # 库存
    for p in prod.values():
        for wcode, wid in wmap.items():
            base = random.randint(0, 60) if wcode != "WH-CD" else random.randint(0, 30)
            sess.add(Inventory(warehouse_id=wid, product_id=p.id, on_hand=base + 100,
                               locked=0, reserved=0, inbound=random.randint(0, 50),
                               safety_stock=random.choice([0, 5, 10])))
    sess.flush()
    # 人为制造几个紧缺品，用于演示防超卖与缺货拦截
    for sku in ["SKU-1009", "SKU-1013", "BUNDLE-01"]:
        for wid in wmap.values():
            inv = sess.query(Inventory).filter_by(warehouse_id=wid, product_id=prod[sku].id).first()
            inv.on_hand = random.randint(1, 4)
            inv.safety_stock = 5
    # 人为制造跨仓分布：主仓无货、分仓有货 → 用于演示按仓拆单
    for sku, zero_wh, keep_wh in [("SKU-1004", "WH-HZ", "WH-GZ"),
                                  ("SKU-1012", "WH-HZ", "WH-CD"),
                                  ("SKU-1015", "WH-HZ", "WH-GZ")]:
        z = sess.query(Inventory).filter_by(warehouse_id=wmap[zero_wh], product_id=prod[sku].id).first()
        z.on_hand = 0
        k = sess.query(Inventory).filter_by(warehouse_id=wmap[keep_wh], product_id=prod[sku].id).first()
        k.on_hand = max(k.on_hand, 80)
    sess.flush()

    # 库存分配规则
    sess.add(StockRule(name="全局-主仓优先", scope_type="global", scope_id=0,
                       warehouse_id=wmap["WH-HZ"], priority=1, share_ratio=1.0))
    sess.add(StockRule(name="全局-华南就近仓", scope_type="global", scope_id=0,
                       warehouse_id=wmap["WH-GZ"], priority=2, share_ratio=1.0))
    sess.add(StockRule(name="全局-西南云仓兜底", scope_type="global", scope_id=0,
                       warehouse_id=wmap["WH-CD"], priority=3, share_ratio=0.5))
    sess.add(StockRule(name="直播事业部-仅主仓出货", scope_type="shop", scope_id=smap["DY-001"],
                       warehouse_id=wmap["WH-HZ"], priority=1, share_ratio=1.0))

    cmap = {}
    for code, name, bf, pk, rs in CARRIERS:
        c = Carrier(code=code, name=name, base_fee=bf, per_kg_fee=pk, remote_surcharge=rs)
        sess.add(c); sess.flush(); cmap[code] = c.id

    sess.add(ShipRule(name="偏远地区-邮政", priority=1, province_key="新疆,西藏,内蒙古,青海",
                      max_weight=9999, min_amount=0, shop_id=0, carrier_id=cmap["ems"]))
    sess.add(ShipRule(name="高价订单-顺丰", priority=2, province_key="", max_weight=9999,
                      min_amount=150, shop_id=0, carrier_id=cmap["sf"]))
    sess.add(ShipRule(name="抖音直播间-中通", priority=3, province_key="", max_weight=9999,
                      min_amount=0, shop_id=smap["DY-001"], carrier_id=cmap["zto"]))
    sess.add(ShipRule(name="重货-韵达", priority=4, province_key="", max_weight=5,
                      min_amount=0, shop_id=0, carrier_id=cmap["yunda"]))
    sess.add(ShipRule(name="默认-极兔", priority=99, province_key="", max_weight=9999,
                      min_amount=0, shop_id=0, carrier_id=cmap["jt"]))

    sess.add(AuditRule(name="大额订单人工复核", priority=1, cond_type="min_amount",
                       cond_value="1200", action="hold", reason="订单金额≥1200，需人工复核"))
    sess.add(AuditRule(name="指定改地址需确认", priority=2, cond_type="remark_contains",
                       cond_value="改地址", action="hold", reason="买家备注含改地址，转人工确认"))
    sess.add(AuditRule(name="偏远地区运费核算", priority=3, cond_type="address_contains",
                       cond_value="新疆,西藏", action="hold", reason="偏远地区需核算运费"))
    sess.add(AuditRule(name="缺货订单挂起", priority=4, cond_type="out_of_stock",
                       cond_value="", action="hold", reason="库存不足，等待补货"))
    sess.add(AuditRule(name="风控黑名单拦截", priority=0, cond_type="remark_contains",
                       cond_value="测试,刷单", action="block", reason="疑似风险订单，直接拦截"))

    for code, name, tt, w, h, content in services.DEFAULT_TEMPLATES:
        sess.add(PrintTemplate(code=code, name=name, ttype=tt, width_mm=w, height_mm=h,
                               paper=f"{w}x{h}", content=content, is_default=True,
                               variables=json.dumps([
                                   {"key": "shop_name", "desc": "店铺名称"},
                                   {"key": "order_no", "desc": "平台订单号"},
                                   {"key": "receiver_name", "desc": "收件人"},
                                   {"key": "receiver_phone", "desc": "收件电话(隐私号)"},
                                   {"key": "province", "desc": "省份"},
                                   {"key": "address", "desc": "详细地址"},
                                   {"key": "warehouse_name", "desc": "发货仓"},
                                   {"key": "carrier_name", "desc": "快递公司"},
                                   {"key": "waybill_no", "desc": "运单号"},
                                   {"key": "buyer_remark", "desc": "买家备注"},
                               ], ensure_ascii=False)))

    # 用户
    for u, n, r in [("admin", "系统管理员", "admin"), ("warehouse", "仓库主管", "warehouse"),
                    ("cs", "客服组长", "cs"), ("finance", "财务专员", "finance")]:
        sess.add(User(username=u, name=n, role=r))

    sess.flush()

    # 订单：不同状态，覆盖全流程
    status_plan = (["pending"] * 34 + ["auditing"] * 10 + ["waiting"] * 8 +
                   ["shipped"] * 30 + ["intercepted"] * 6 + ["cancelled"] * 6)
    random.shuffle(status_plan)
    for i, st in enumerate(status_plan):
        scode = random.choice(list(smap.keys()))
        sid = smap[scode]
        prov, city, addr = random.choice(PROV)
        listings = (sess.query(ShopListing).filter_by(shop_id=sid, online_status="online").all())
        if not listings:
            continue
        chosen = random.sample(listings, random.randint(1, 3))
        items, amount, weight = [], 0, 0
        for l in chosen:
            p = sess.get(Product, l.product_id)
            q = random.randint(1, 3)
            items.append((p, q, l.platform_price))
            amount += l.platform_price * q
            weight += p.weight_kg * q
        freight = 0 if amount >= 99 else 8
        o = Order(
            order_no=f"{scode}{datetime.now().strftime('%y%m%d')}{str(10000 + i)[-5:]}",
            shop_id=sid, buyer_nick=f"买家{random.randint(1000, 9999)}",
            receiver_name=random.choice(NAMES),
            receiver_phone=f"{random.randint(130, 199)}****{random.randint(1000, 9999)}",
            province=prov, city=city, address=f"{addr}{random.randint(1, 999)}号",
            amount=round(amount + freight, 2), freight=freight,
            discount=round(amount * random.choice([0, 0, 0.05, 0.1]), 2),
            weight_kg=round(weight, 2), status=st,
            buyer_remark=random.choice(REMARKS), is_presale=random.random() < 0.08,
            created_at=datetime.now() - timedelta(hours=random.randint(1, 200)),
        )
        sess.add(o); sess.flush()
        for p, q, pr in items:
            sess.add(OrderItem(order_id=o.id, product_id=p.id, sku=p.sku, name=p.name,
                               qty=q, price=pr))
        if st == "shipped":
            o.warehouse_id = random.choice(list(wmap.values()))
            o.carrier_id = random.choice(list(cmap.values()))
            o.waybill_no = services.gen_waybill_no(
                sess.get(Carrier, o.carrier_id).code)
            o.audited_at = o.created_at + timedelta(minutes=random.randint(3, 40))
            o.shipped_at = o.audited_at + timedelta(hours=random.randint(1, 20))
            o.audit_result = "pass"
        elif st == "auditing":
            o.audit_result = "hold"
            o.audit_msg = "等待人工复核"
        elif st == "waiting":
            o.audit_result = "pass"
            o.audit_msg = "库存不足，等待补货"
        elif st == "intercepted":
            o.audit_result = "block"
            o.audit_msg = "疑似风险订单，已拦截"
        elif st == "cancelled":
            o.audit_result = "pass"
            o.audit_msg = "买家取消订单"

    # 同买家多单：用于演示「同买家合单发货」
    for gi in range(3):
        base_name = random.choice(NAMES)
        base_phone = f"{random.randint(130, 199)}****{random.randint(1000, 9999)}"
        prov, city, addr = random.choice(PROV)
        addr_full = f"{addr}{random.randint(1, 99)}号"
        for k in range(random.randint(2, 3)):
            scode = random.choice(list(smap.keys()))
            sid = smap[scode]
            listings = db_listings(sess, sid)
            if not listings:
                continue
            chosen = random.sample(listings, min(2, len(listings)))
            items, amount, weight = [], 0, 0
            for l in chosen:
                p = sess.get(Product, l.product_id)
                q = 1
                items.append((p, q, l.platform_price))
                amount += l.platform_price * q
                weight += p.weight_kg * q
            o = Order(order_no=f"{scode}{datetime.now().strftime('%y%m%d')}M{gi}{k}",
                      shop_id=sid, buyer_nick=f"同买家{gi}",
                      receiver_name=base_name, receiver_phone=base_phone,
                      province=prov, city=city, address=addr_full,
                      amount=round(amount + 8, 2), freight=8, discount=0,
                      weight_kg=round(weight, 2), status="pending",
                      buyer_remark="希望一起发货", is_presale=False,
                      created_at=datetime.now() - timedelta(hours=random.randint(1, 10)))
            sess.add(o); sess.flush()
            for p, q, pr in items:
                sess.add(OrderItem(order_id=o.id, product_id=p.id, sku=p.sku,
                                   name=p.name, qty=q, price=pr))

    # 跨仓订单：含主仓缺货商品 → 用于演示「按仓拆单」
    for ci in range(4):
        sid = smap[random.choice(list(smap.keys()))]
        prov, city, addr = random.choice(PROV)
        picks = [prod["SKU-1004"], prod["SKU-1012"]] + [random.choice(list(prod.values()))]
        amount, weight, items = 0, 0, []
        for p in picks:
            q = 1
            items.append((p, q, p.sale_price))
            amount += p.sale_price * q
            weight += p.weight_kg * q
        o = Order(order_no=f"SPLIT{datetime.now().strftime('%y%m%d')}{ci}",
                  shop_id=sid, buyer_nick=f"拆单买家{ci}",
                  receiver_name=random.choice(NAMES),
                  receiver_phone=f"{random.randint(130, 199)}****{random.randint(1000, 9999)}",
                  province=prov, city=city, address=f"{addr}{random.randint(1, 999)}号",
                  amount=round(amount + 8, 2), freight=8, discount=0,
                  weight_kg=round(weight, 2), status="pending",
                  buyer_remark="跨仓订单，请按仓发货", is_presale=False,
                  created_at=datetime.now() - timedelta(hours=random.randint(1, 20)))
        sess.add(o); sess.flush()
        for p, q, pr in items:
            sess.add(OrderItem(order_id=o.id, product_id=p.id, sku=p.sku,
                               name=p.name, qty=q, price=pr))

    for i in range(40):
        p = random.choice(list(prod.values()))
        w = random.choice(list(wmap.values()))
        sess.add(StockLedger(warehouse_id=w, product_id=p.id,
                             change_type=random.choice(["purchase", "adjust", "return_in"]),
                             qty_change=random.choice([50, 100, 20, -10]),
                             before_available=random.randint(50, 200),
                             after_available=random.randint(50, 300),
                             ref_type="purchase", ref_no=f"PO2026{1000 + i}",
                             operator="采购部", created_at=datetime.now() - timedelta(hours=i * 6)))

    sess.add(OpLog(user="admin", action="系统初始化", target="seed", detail="载入演示数据集"))
    sess.flush()
    seed_ops(sess, prod, wmap, smap)
    sess.commit()
    print("seed done")




def seed_ops(sess, prod, wmap, smap, sess_shops=None):
    """扩展模块演示数据：供应商、采购、库位、批次、波次、盘点、售后、账单、利润。"""
    import random
    from datetime import datetime, timedelta
    from .models_ops import (AfterSale, AfterSaleItem, ApAr, BillFee, Location, PackCheck,
                             PickTask, PickWave, PlatformBill, ProfitRecord, PurchaseItem,
                             PurchaseOrder, PurchaseReturn, Receipt, StockBatch,
                             Stocktake, StocktakeItem, Supplier, Transfer)
    from . import services_ops as ops

    SUPS = [("SUP-01", "宁波佳居家用品厂", "陈建国", "13857410001", "91330200MA2AB1X3XG", "月结30天", 7),
            ("SUP-02", "广东顺德五金制品", "林志明", "13924820002", "91440606MA4XY2K11P", "月结45天", 12),
            ("SUP-03", "义乌市日用百货贸易", "王雪梅", "13705790003", "91330782MA29Q8L42R", "款到发货", 3),
            ("SUP-04", "江苏南通家纺实业", "赵明华", "13606290004", "91320600MA1MW3N55T", "月结30天", 15),
            ("SUP-05", "潮州陶瓷工艺厂", "陈燕玲", "13507680005", "91445100MA4W6P7X8Y", "月结30天", 20)]
    sups = {}
    for code, name, ct, ph, tax, term, lead in SUPS:
        s = Supplier(code=code, name=name, contact=ct, phone=ph, tax_no=tax,
                     pay_term=term, lead_days=lead,
                     credit_limit=random.choice([100000, 200000, 500000]),
                     score=random.randint(82, 98))
        sess.add(s); sess.flush(); sups[code] = s

    # 库位
    for wcode, wid in wmap.items():
        for z in "ABCD":
            for r in range(1, 4):
                for c in range(1, 5):
                    sess.add(Location(warehouse_id=wid, code=f"{z}-{r:02d}-{c:02d}",
                                      zone=f"{z}区",
                                      ltype=random.choice(["拣货位", "拣货位", "存储位", "暂存位"])))
    sess.flush()

    # 采购单
    for i in range(8):
        sup = random.choice(list(sups.values()))
        wid = random.choice(list(wmap.values()))
        po_no = f"PO20261{str(9000 + i)}"
        if sess.query(PurchaseOrder).filter_by(po_no=po_no).first():
            continue
        p = PurchaseOrder(po_no=po_no, supplier_id=sup.id, warehouse_id=wid,
                          status=random.choice(["approved", "partial", "received", "draft"]),
                          expect_date=datetime.now() + timedelta(days=random.randint(1, 20)),
                          buyer="采购部", created_at=datetime.now() - timedelta(days=random.randint(1, 40)))
        sess.add(p); sess.flush()
        amount = 0
        for prod_obj in random.sample(list(prod.values()), random.randint(2, 5)):
            qty = random.randint(50, 300)
            price = round(prod_obj.cost_price * random.uniform(0.9, 1.1), 2)
            rec = qty if p.status == "received" else (int(qty * random.uniform(0.2, 0.8)) if p.status == "partial" else 0)
            sess.add(PurchaseItem(po_id=p.id, product_id=prod_obj.id, sku=prod_obj.sku,
                                  name=prod_obj.name, qty=qty, received_qty=rec, price=price))
            amount += qty * price
        p.amount = round(amount, 2)
        if p.status == "received":
            p.received_at = p.created_at + timedelta(days=random.randint(3, 15))
    sess.flush()

    # 对未入库的采购单执行一次收货，生成入库单与批次
    for po in sess.query(PurchaseOrder).filter(
            PurchaseOrder.status.in_(["draft", "approved", "partial"])).all():
        ops.receive_purchase(sess, po.id)
    sess.flush()

    # 批次效期
    for p in list(prod.values())[:14]:
        for wid in list(wmap.values())[:2]:
            sess.add(StockBatch(warehouse_id=wid, product_id=p.id,
                                batch_no=f"B{random.randint(202501, 202612)}{random.randint(100, 999)}",
                                qty=random.randint(20, 200), cost_price=p.cost_price,
                                produced_at=datetime.now() - timedelta(days=random.randint(30, 400)),
                                expire_at=datetime.now() + timedelta(days=random.choice([30, 60, 120, 300, 600])),
                                location_code=f"{random.choice('ABCD')}-{random.randint(1,3):02d}-{random.randint(1,4):02d}"))
    sess.flush()

    # 波次 + 拣货任务 + 验货
    wl = list(wmap.values())
    for idx, wid in enumerate(wl[:2]):
        worders = sess.query(Order).filter_by(status="waiting").all()
        worders = worders[idx * 3:(idx + 1) * 3]
        for o in worders:
            o.warehouse_id = wid
        sess.flush()
        if worders:
            r = ops.create_wave(sess, wid, [o.id for o in worders[:4]],
                                random.choice(["摘果式", "播种式"]))
            if r.get("ok"):
                ops.pick_wave(sess, r["wave_id"], random.choice(["张拣", "李拣"]))
                for t in sess.query(PickTask).filter_by(wave_id=r["wave_id"]).all():
                    ops.pack_weigh(sess, t.order_id, r["wave_id"],
                                   round(random.uniform(0.3, 5), 2))
    sess.flush()

    # 盘点单
    for wcode, wid in list(wmap.items())[:2]:
        r = ops.create_stocktake(sess, wid, random.choice(["明盘", "暗盘"]), 12)
        if r.get("ok"):
            for it in sess.query(StocktakeItem).filter_by(st_id=r["st_id"]).all():
                if random.random() < 0.35:
                    it.real_qty = max(it.book_qty + random.choice([-3, -2, -1, 1, 2, 5]), 0)
            if random.random() < 0.5:
                ops.submit_stocktake(sess, r["st_id"])
    sess.flush()

    # 调拨
    wl = list(wmap.values())
    for _ in range(4):
        p = random.choice(list(prod.values()))
        ops.do_transfer(sess, wl[0], wl[1], p.id, random.randint(5, 30))
    sess.flush()

    # 售后
    shipped = sess.query(Order).filter_by(status="shipped").all()
    for o in random.sample(shipped, min(14, len(shipped))):
        r = ops.create_after_sale(sess, o.id,
                                  random.choice(["refund", "return", "return", "exchange", "resend"]),
                                  random.choice(["七天无理由", "商品破损", "尺码不合适",
                                                 "发错货", "质量问题", "物流延误"]))
        if not r.get("ok"):
            continue
        a = sess.get(AfterSale, r["as_id"])
        for it in sess.query(AfterSaleItem).filter_by(as_id=a.id).all():
            it.quality = random.choice(["good", "good", "bad"])
        act = random.choice(["approve", "reject", "done", "return_received", "pending"])
        if act == "pending":
            a.status = "pending"
        else:
            ops.process_after_sale(sess, a.id, act)
            if act == "return_received" and random.random() < 0.6:
                ops.process_after_sale(sess, a.id, "done")
    sess.flush()

    # 平台账单
    for sid in list(smap.values())[:8]:
        ops.generate_bill(sess, sid, datetime.now().strftime("%Y-%m"))
    sess.flush()

    # 利润核算
    ops.batch_calc_profit(sess)
    sess.flush()

    # 应收应付（供应商侧）
    for po in sess.query(PurchaseOrder).filter(PurchaseOrder.status.in_(["approved", "partial"])).all():
        sup = sess.get(Supplier, po.supplier_id)
        sess.add(ApAr(direction="ap", partner_type="supplier", partner_id=sup.id,
                      partner_name=sup.name, ref_no=po.po_no,
                      amount=round(po.amount * random.uniform(0.3, 1), 2),
                      settled_amount=0, status="open",
                      due_date=datetime.now() + timedelta(days=random.randint(7, 60))))
    sess.flush()
    print("seed_ops done")


if __name__ == "__main__":
    s = SessionLocal()
    build(s)
    s.close()
