"""DHgate connector - OAuth + HMAC-SHA256 (阿里系 API 网关).

DHgate 与 AliExpress 同属阿里系开放平台，API 风格 / 签名算法高度一致。
参考 deploy/backend/src/platforms/aliexpress.js 签名模式。
API 文档: https://www.dhgate.com/open
"""
import hmac, hashlib, json, re, time
from typing import Any, Dict, List, Optional, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

API_BASE = "https://api.dhgate.com/sync"


def _sign(params: Dict[str, str], secret: str) -> str:
    """DHgate 签名：与 AliExpress 完全相同 —— HMAC-SHA256(secret, sorted k=v&k=v)."""
    sorted_pairs = sorted(f"{k}={v}" for k, v in params.items())
    s = "&".join(sorted_pairs)
    return hmac.new(secret.encode(), s.encode(), hashlib.sha256).hexdigest().upper()


class DhgateConnector(PlatformConnector):
    CLASS_PLATFORM = "dhgate"
    CLASS_NAME = "DHgate 敦煌网"
    AUTH_MODE = "oauth"

    def _app_creds(self, shop: ShopInfo) -> Tuple[Optional[str], Optional[str]]:
        k = shop.credential.get("app_key") or (shop.extra or {}).get("app_key")
        s = shop.credential.get("app_secret") or (shop.extra or {}).get("app_secret")
        return k, s

    def _call(self, shop: ShopInfo, method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        token = shop.access_token or shop.credential.get("access_token")
        app_key, app_secret = self._app_creds(shop)
        if not token:
            raise ConnectorError("DHgate 缺少 access_token，请先完成 OAuth 授权", 401)
        if not app_key or not app_secret:
            raise ConnectorError("DHgate 缺少 App Key / App Secret", 401)

        ts = str(int(time.time() * 1000))
        base_params = {
            "method": method,
            "app_key": str(app_key),
            "access_token": token,
            "sign_method": "sha256",
            "timestamp": ts,
        }
        # 参数：list / dict 需 JSON 序列化（与 AliExpress 风格保持一致）
        payload_flat = {
            k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v)
            for k, v in payload.items()
        }
        all_params = {**base_params, **payload_flat}
        all_params["sign"] = _sign(all_params, str(app_secret))

        try:
            r = httpx.post(API_BASE, data=all_params, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"DHgate 网络错误: {e}", 502)

        try:
            data = r.json() if r.text else {}
        except Exception:
            raise ConnectorError(f"DHgate 非 JSON 响应: {r.text[:200]}", r.status_code)

        if not r.ok or data.get("error_response") or data.get("error_code"):
            err = data.get("error_response") or {}
            msg = err.get("msg") or err.get("error_msg") or data.get("error_message") or r.text[:200]
            raise ConnectorError(f"DHgate 调用失败: {msg}", r.status_code, payload=data)
        return data

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Optional[Dict]]:
        try:
            # 试拉一条商品
            self._call(shop, "dh.product.list.get", {"param": {"page_size": 1, "page": 1}})
            return True, "DHgate 凭据有效", None
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        to_s = int(time.time())
        data = self._call(shop, "dh.order.list.get", {
            "param": {
                "create_date_start": since_ts,
                "create_date_end": to_s,
                "page_size": limit,
                "page": 1,
            },
        })
        # DHgate 返回结构与 AliExpress 近似：{ dh_order_list_get_response: { result: { ... } } }
        root_key = next((k for k in data.keys() if "response" in k and "order" in k), None)
        root = data.get(root_key or "dh_order_list_get_response", {})
        result = (root.get("result") or {}).get("target_list") or (root.get("result") or {}).get("orders") or []
        if isinstance(result, dict):
            # 有些版本 result.target_list.order_dto
            result = result.get("order_dto") or result.get("orders") or []
        if not isinstance(result, list):
            result = []

        out: List[NormalizedOrder] = []
        for o in result:
            if not isinstance(o, dict):
                continue
            raw_id = str(o.get("order_id") or o.get("order_no") or "")
            raw_id = re.sub(r"[^0-9A-Za-z]", "", raw_id)
            if not raw_id:
                continue
            amt = 0.0
            amt_obj = o.get("order_amount")
            if isinstance(amt_obj, dict):
                amt = float(amt_obj.get("amount", 0))
            elif amt_obj:
                amt = float(amt_obj)
            addr = o.get("logistics_address") or o.get("address") or {}
            out.append(NormalizedOrder(
                order_no="DH" + raw_id,
                platform_order_id=str(o.get("order_id")),
                status=self._status_from(o.get("order_status") or o.get("status")),
                total_amount=amt,
                buyer_name=o.get("buyer_login_id") or o.get("buyer_name") or "",
                country=(addr.get("country") or addr.get("country_code") or "").upper(),
                created_at_ts=int(str(o.get("gmt_create") or o.get("create_time") or 0)) // 1000 if o.get("gmt_create") or o.get("create_time") else None,
            ))
        return out

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        data = self._call(shop, "dh.product.list.get", {
            "param": {"page_size": limit, "page": 1},
        })
        root_key = next((k for k in data.keys() if "response" in k and "product" in k), None)
        root = data.get(root_key or "dh_product_list_get_response", {})
        products_raw = (root.get("result") or {}).get("target_list") or (root.get("result") or {}).get("products") or []
        if isinstance(products_raw, dict):
            products_raw = products_raw.get("simple_product_info_list") or products_raw.get("products") or []
        if not isinstance(products_raw, list):
            products_raw = []

        out: List[NormalizedProduct] = []
        for it in products_raw:
            if not isinstance(it, dict):
                continue
            pid = str(it.get("product_id") or it.get("sku_code") or "")
            if not pid:
                continue
            # 价格可能在 simple_product_info.product_price 或顶层 product_price
            price_info = it.get("product_price")
            simple = it.get("simple_product_info")
            if isinstance(simple, dict):
                price_info = simple.get("product_price") or price_info
            try:
                price = float(price_info or 0)
            except (ValueError, TypeError):
                price = 0.0
            out.append(NormalizedProduct(
                sku="DH-" + pid,
                platform_sku=pid,
                name=it.get("subject") or it.get("subject_multi_language") or f"DHgate {pid}",
                price=price,
                platform_product_id=str(it.get("product_id") or pid),
            ))
        return out
