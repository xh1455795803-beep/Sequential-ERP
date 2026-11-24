import urllib.request, json

BASE = "https://thalvior.icu/rest/v1"
ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

def req(method, path, body=None, prefer="return=representation"):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("apikey", ANON)
    r.add_header("Authorization", f"Bearer {ANON}")
    r.add_header("Content-Type", "application/json")
    r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            raw = resp.read().decode()
            if not raw: return None
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  HTTP {e.code}: {err[:300]}")
        return None

WID = "57ae8979-c77f-4a88-b80a-113f01b5cbee"
M1 = "7e3bf09f-3937-4891-a6f6-75941f39d1b2"
M2 = "c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5"

# 1. 包裹
print("📦 Packages:")
p = req("GET", "/tlv_packages?select=*")
print(f"  before: {len(p) if p else 0}")
samples = [
    {"warehouse_id": WID, "merchant_id": M1, "supplier": "1688-义乌供应商",
     "weight": 2.3, "status": "received", "location": "暂存区-A01",
     "operator_name": "wms@thalvior.dev", "notes": "3 箱混装入库"},
    {"warehouse_id": WID, "merchant_id": M2, "supplier": "深圳华强北",
     "weight": 1.1, "status": "packed", "operator_name": "wms@thalvior.dev",
     "notes": "出库打包中"},
    {"warehouse_id": WID, "merchant_id": M1, "supplier": "东莞工厂直供",
     "weight": 5.8, "status": "shipped", "tracking_no": "SF1234567890123",
     "operator_name": "wms@thalvior.dev", "notes": "COD 件已出库"},
]
r = req("POST", "/tlv_packages", samples)
print(f"  ✅ +{len(r) if r else 0}")

# 2. 问题件
print("\n⚠ Issues:")
samples2 = [
    {"warehouse_id": WID, "merchant_id": M1, "sku": "SKU-001", "location": "A-01-01",
     "issue_type": "wrong_qty", "severity": "high", "description": "实际清点少 2 件",
     "status": "open", "operator_name": "wms@thalvior.dev"},
    {"warehouse_id": WID, "merchant_id": M2, "sku": "SKU-002", "location": "B-02-02",
     "issue_type": "damaged", "severity": "critical", "description": "外箱破损商品可能受损",
     "status": "assigned", "assigned_name": "张三", "operator_name": "wms@thalvior.dev"},
]
r2 = req("POST", "/tlv_issue_items", samples2)
print(f"  ✅ +{len(r2) if r2 else 0}")

# 3. 跟进记录
print("\n📞 Followups:")
samples3 = [
    {"warehouse_id": WID, "merchant_id": M1, "followup_type": "phone",
     "sentiment": "urgent", "content": "客户反馈下月订单量预计上涨 30% 需提前备货",
     "followup_name": "wms@thalvior.dev"},
    {"warehouse_id": WID, "merchant_id": M2, "followup_type": "wechat",
     "sentiment": "positive", "content": "客户对打包速度满意介绍了新客户",
     "followup_name": "wms@thalvior.dev"},
]
r3 = req("POST", "/tlv_customer_followups", samples3)
print(f"  ✅ +{len(r3) if r3 else 0}")

# 4. 验证
print("\n🔍 最终状态:")
for tbl, q in [
    ("packages", "/tlv_packages?select=*"),
    ("issues", "/tlv_issue_items?select=*"),
    ("followups", "/tlv_customer_followups?select=*"),
]:
    d = req("GET", q)
    print(f"  {tbl}: {len(d) if d else 0}")
print("\n🎉 Seed done!")
