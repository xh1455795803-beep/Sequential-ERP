"""Temu connector - Access ID + Secret + HMAC-SHA256.

Migrated from deploy/backend/src/platforms/temu.js
API doc: https://seller.temu.com/openapi/document
"""
import hmac, hashlib, time, json, re
from typing import Any, Dict, List, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

API_BASE = "https://openapi.temuplatform.com"


def _sign(params: Dict[str, str], secret: str, timestamp: str) -> str:
    """Temu signature: HMAC-SHA256(secret, sorted_params + '&timestamp=' + ts)."""
    sorted_pairs = sorted(f"{k}={v}" for k, v in params.items())
    str_to_sign = "&".join(sorted_pairs) + f"&timestamp={timestamp}"
    return hmac.new(secret.encode(), str_to_sign.encode(), hashlib.sha256).hexdigest()


class TemuConnector(PlatformConnector):
    CLASS_PLATFORM = "temu"
    CLASS_NAME = "Temu"
    AUTH_MODE = "apikey"

    def _call(self, shop: ShopInfo, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        api_key = shop.api_key or shop.credential.get("access_id")
        api_secret = shop.api_secret or shop.credential.get("access_secret")
        if not api_key or not api_secret:
            raise ConnectorError("Temu 缺少 Access ID/Secret，请先在 Temu 后台 Apps And Services 创建 App 并拿 Token/凭据")

        ts = str(int(time.time() * 1000))
        type_param = path.lstrip("/")
        base_params = {
            "appKey": str(api_key),
            "timestamp": ts,
            "signMethod": "HMAC-SHA256",
            "type": type_param,
        }
        signature = _sign(base_params, str(api_secret), ts)

        url = API_BASE + path
        params = dict(base_params)
        params["sign"] = signature

        try:
            r = httpx.post(url, params=params, json=payload, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"Temu 网络错误: {e}", status_code=502)

        try:
            data = r.json() if r.text else {}
        except Exception:
            raise ConnectorError(f"Temu 返回非 JSON: {r.text[:200]}", status_code=r.status_code)

        if not r.ok or data.get("success") is False or (data.get("code") not in (0, "0", None)):
            msg = data.get("message") or data.get("error") or f"HTTP {r.status_code}"
            raise ConnectorError(f"Temu 调用失败: {msg}", status_code=r.status_code, payload=data)
        return data

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Any]:
        try:
            data = self._call(shop, "/bg.product.list.get", {"pageNum": 1, "pageSize": 1})
            return True, "Temu 凭据有效", data
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        # Temu uses seconds since epoch
        since_s = since_ts
        to_s = int(time.time())
        data = self._call(shop, "/bg.order.list.get", {
            "createTimeStart": since_s,
            "createTimeEnd": to_s,
            "pageNum": 1,
            "pageSize": limit,
        })
        list_items = (data.get("result") or {}).get("orderList") or data.get("orderList") or []
        orders: List[NormalizedOrder] = []
        for o in list_items:
            raw_id = re.sub(r"[^A-Za-z0-9]", "", str(o.get("orderId") or o.get("orderSn") or ""))
            if not raw_id:
                continue
            orders.append(NormalizedOrder(
                order_no="TEMU" + raw_id,
                platform_order_id=raw_id,
                status=self._status_from(o.get("orderStatus") or o.get("status")),
                total_amount=float(o.get("totalAmount") or o.get("orderAmount") or 0),
                buyer_name=o.get("buyerName") or "",
                country=o.get("country") or o.get("countryCode") or "",
                created_at_ts=int(o.get("createTime") or 0) // 1000 if o.get("createTime") else None,
            ))
        return orders

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        data = self._call(shop, "/bg.product.list.get", {"pageNum": 1, "pageSize": limit})
        list_items = (data.get("result") or {}).get("productList") or data.get("productList") or []
        products: List[NormalizedProduct] = []
        for it in list_items:
            raw_sku = str(it.get("productSku") or it.get("skuId") or it.get("productId") or "")
            if not raw_sku:
                continue
            products.append(NormalizedProduct(
                sku="TEMU-" + raw_sku,
                platform_sku=raw_sku,
                name=it.get("productName") or it.get("title") or f"Temu {raw_sku}",
                price=float(it.get("price") or it.get("salePrice") or 0),
                platform_product_id=str(it.get("productId") or raw_sku),
            ))
        return products
