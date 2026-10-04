"""SHEIN connector - API Key (App Key/Secret) + MD5 签名.

Migrated from deploy/backend/src/platforms/shein.js
API 文档: https://open.sheincorp.com / openapi.sheingroup.com

签名算法: MD5(app_secret + sorted_k=v&k=v + app_secret).toUpperCase()
请求头  : x-shein-signature: {sign}
"""
import hashlib, json, re, time
from typing import Any, Dict, List, Optional, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

API_BASE = "https://openapi.sheingroup.com"


def _sign(params: Dict[str, str], secret: str) -> str:
    """MD5(secret + sorted k=v + secret).toUpperCase()"""
    sorted_pairs = sorted(f"{k}={params[k]}" for k in params.keys())
    s = secret + "&".join(sorted_pairs) + secret
    return hashlib.md5(s.encode("utf-8")).hexdigest().upper()


def _parse_ts(v: Any) -> Optional[int]:
    if not v:
        return None
    try:
        n = int(str(v))
        if n > 10_000_000_000:  # 毫秒
            return n // 1000
        return n
    except (ValueError, TypeError):
        return None


class SheinConnector(PlatformConnector):
    CLASS_PLATFORM = "shein"
    CLASS_NAME = "SHEIN"
    AUTH_MODE = "apikey"

    def _call(self, shop: ShopInfo, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        api_key = shop.api_key or shop.credential.get("app_key")
        api_secret = shop.api_secret or shop.credential.get("app_secret") or shop.credential.get("appKey") or shop.credential.get("appSecret")
        if not api_key or not api_secret:
            raise ConnectorError("SHEIN 缺少 App Key / App Secret", 401)

        ts = str(int(time.time() * 1000))
        base_params: Dict[str, str] = {
            "appKey": str(api_key),
            "timestamp": ts,
            "signMethod": "MD5",
        }
        # 把 payload 也 flatten 成 str，用于签名（dict/list 要 JSON 序列化）
        for k, v in payload.items():
            if isinstance(v, (dict, list)):
                base_params[k] = json.dumps(v, ensure_ascii=False)
            else:
                base_params[k] = str(v)

        signature = _sign(base_params, str(api_secret))

        body = {**base_params, "sign": signature}
        url = API_BASE + path
        headers = {
            "Content-Type": "application/json",
            "x-shein-signature": signature,
            "Accept": "application/json",
        }
        try:
            r = httpx.post(url, json=body, headers=headers, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"SHEIN 网络错误: {e}", 502)

        try:
            data = r.json() if r.text else {}
        except Exception:
            raise ConnectorError(f"SHEIN 非 JSON 响应: {r.text[:200]}", r.status_code)

        if not r.ok:
            msg = data.get("message") or data.get("msg") or data.get("error") or r.text[:200]
            raise ConnectorError(f"SHEIN 调用失败: {msg}", r.status_code, payload=data)
        code = str(data.get("code", ""))
        if code and code not in ("0", "000000", "00000", "00"):
            msg = data.get("message") or data.get("msg") or str(data)[:200]
            raise ConnectorError(f"SHEIN 业务失败: {msg}", r.status_code, payload=data)
        return data

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Optional[Dict]]:
        try:
            data = self._call(shop, "/open/shop/info", {})
            return True, "SHEIN 凭据有效", data
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        data = self._call(shop, "/open/order/list", {
            "startTime": since_ts,
            "endTime": int(time.time()),
            "pageNum": 1,
            "pageSize": min(limit, 100),
        })
        list_items = ((data.get("data") or {}).get("orderList")
                      or data.get("orderList")
                      or (data.get("result") or {}).get("order_list")
                      or [])
        if not isinstance(list_items, list):
            list_items = []

        out: List[NormalizedOrder] = []
        for o in list_items:
            if not isinstance(o, dict):
                continue
            raw_id = str(o.get("orderNo") or o.get("orderId") or "")
            raw_id = re.sub(r"[^0-9A-Za-z]", "", raw_id)
            if not raw_id:
                continue
            out.append(NormalizedOrder(
                order_no="SHEIN" + raw_id,
                platform_order_id=str(o.get("orderId") or raw_id),
                status=self._map_status(o.get("orderStatus") or o.get("status")),
                total_amount=float(o.get("totalAmount") or o.get("orderAmount") or 0),
                buyer_name=o.get("buyerName") or o.get("buyer") or "",
                country=(o.get("country") or o.get("countryCode") or "").upper(),
                created_at_ts=_parse_ts(o.get("createTime") or o.get("create_time")),
            ))
        return out

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        data = self._call(shop, "/open/product/list", {
            "pageNum": 1,
            "pageSize": min(limit, 100),
        })
        list_items = ((data.get("data") or {}).get("productList")
                      or data.get("productList")
                      or (data.get("result") or {}).get("product_list")
                      or [])
        if not isinstance(list_items, list):
            list_items = []

        out: List[NormalizedProduct] = []
        for it in list_items:
            if not isinstance(it, dict):
                continue
            raw_sku = str(it.get("productSku") or it.get("skuId") or it.get("productId") or "")
            if not raw_sku:
                continue
            out.append(NormalizedProduct(
                sku="SHEIN-" + raw_sku,
                platform_sku=raw_sku,
                name=it.get("productName") or it.get("title") or f"SHEIN {raw_sku}",
                price=float(it.get("salePrice") or it.get("price") or 0),
                platform_product_id=str(it.get("productId") or raw_sku),
            ))
        return out

    @staticmethod
    def _map_status(s: Any) -> str:
        if not s:
            return "PENDING"
        v = str(s).lower()
        if "cancel" in v:
            return "CANCELLED"
        if "shipped" in v or "delivering" in v:
            return "SHIPPED"
        if "deliver" in v or "complete" in v:
            return "DELIVERED"
        return "PENDING"
