"""AliExpress connector - OAuth + HMAC-SHA256 signature.

Migrated from deploy/backend/src/platforms/aliexpress.js
API doc: https://openservice.aliexpress.com
"""
import hmac, hashlib, time, json, re
from typing import Any, Dict, List, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

API_BASE = "https://api-sg.aliexpress.com/sync"


def _sign(params: Dict[str, str], secret: str) -> str:
    sorted_pairs = sorted(f"{k}={v}" for k, v in params.items())
    s = "&".join(sorted_pairs)
    return hmac.new(secret.encode(), s.encode(), hashlib.sha256).hexdigest().upper()


class AliExpressConnector(PlatformConnector):
    CLASS_PLATFORM = "aliexpress"
    CLASS_NAME = "AliExpress 速卖通"
    AUTH_MODE = "oauth"

    def _app_creds(self, shop: ShopInfo):
        """App key/secret may live either in credential or shop.extra."""
        k = shop.credential.get("app_key") or shop.extra.get("app_key") if shop.extra else None
        s = shop.credential.get("app_secret") or shop.extra.get("app_secret") if shop.extra else None
        return k, s

    def _call(self, shop: ShopInfo, method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        token = shop.access_token or shop.credential.get("access_token")
        app_key, app_secret = self._app_creds(shop)
        if not token:
            raise ConnectorError("AliExpress 缺少 access_token，请先完成 OAuth 授权", 401)
        if not app_key or not app_secret:
            raise ConnectorError("AliExpress 缺少 App Key/Secret", 401)

        ts = str(int(time.time() * 1000))
        base_params = {
            "method": method,
            "app_key": str(app_key),
            "access_token": token,
            "sign_method": "sha256",
            "timestamp": ts,
        }
        all_params = {**base_params, **{k: json.dumps(v) if isinstance(v, (dict, list)) else str(v)
                                       for k, v in payload.items()}}
        all_params["sign"] = _sign(all_params, str(app_secret))

        try:
            r = httpx.post(API_BASE, data=all_params, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"AliExpress 网络错误: {e}", 502)

        try:
            data = r.json() if r.text else {}
        except Exception:
            raise ConnectorError(f"AliExpress 非 JSON 响应: {r.text[:200]}", r.status_code)

        if not r.ok or data.get("error_response"):
            err = data.get("error_response") or {}
            raise ConnectorError(
                f"AliExpress 调用失败: {err.get('msg') or err.get('code') or r.text[:200]}",
                r.status_code, payload=data,
            )
        return data

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Any]:
        try:
            self._call(shop, "aliexpress.solution.product.list.get",
                       {"page_size": 1, "current_page": 1})
            return True, "AliExpress 凭据有效", None
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        since_s = since_ts
        to_s = int(time.time())
        data = self._call(shop, "aliexpress.solution.order.get", {
            "param": {"order_query": {
                "create_date_start": since_s,
                "create_date_end": to_s,
                "page_size": limit,
                "page": 1,
            }},
        })
        root = data.get("aliexpress_solution_order_get_response", {})
        result = (root.get("result") or {}).get("target_list", {}).get("order_dto", [])
        if not isinstance(result, list):
            result = []
        orders = []
        for o in result:
            raw_id = re.sub(r"[^0-9]", "", str(o.get("order_id") or ""))
            if not raw_id:
                continue
            amt = (o.get("order_amount") or {}).get("amount", 0) if isinstance(o.get("order_amount"), dict) else 0
            orders.append(NormalizedOrder(
                order_no="AE" + raw_id,
                platform_order_id=raw_id,
                status=self._status_from(o.get("order_status")),
                total_amount=float(amt or 0),
                buyer_name=o.get("login_id") or "",
                country=((o.get("logistics_address") or {}).get("country")) or "",
                created_at_ts=int(o.get("gmt_create") or 0) // 1000 if o.get("gmt_create") else None,
            ))
        return orders

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        data = self._call(shop, "aliexpress.solution.product.list.get",
                          {"param": {"page_size": limit, "current_page": 1}})
        root = data.get("aliexpress_solution_product_list_get_response", {})
        products_raw = (root.get("result") or {}).get("products") or []
        if not isinstance(products_raw, list):
            products_raw = []
        out = []
        for it in products_raw:
            sku = str(it.get("product_id") or it.get("sku_code") or "")
            if not sku:
                continue
            price_info = (it.get("simple_product_info") or {}).get("product_price") if isinstance(it.get("simple_product_info"), dict) else it.get("product_price")
            out.append(NormalizedProduct(
                sku="AE-" + sku,
                platform_sku=sku,
                name=it.get("subject") or f"AliExpress {sku}",
                price=float(price_info or 0),
                platform_product_id=sku,
            ))
        return out
