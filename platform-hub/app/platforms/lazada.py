"""Lazada connector - OAuth + HMAC-SHA256.

Migrated from deploy/backend/src/platforms/lazada.js
API 文档: https://open.lazada.com
东南亚六国使用独立 host，由 shop.extra.country 决定。
"""
import hmac, hashlib, json, re, time, urllib.parse
from typing import Any, Dict, List, Optional, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

API_BASES = {
    "SG": "https://api.lazada.sg/rest",
    "MY": "https://api.lazada.com.my/rest",
    "TH": "https://api.lazada.co.th/rest",
    "VN": "https://api.lazada.vn/rest",
    "PH": "https://api.lazada.com.ph/rest",
    "ID": "https://api.lazada.co.id/rest",
}


def _endpoint(shop: ShopInfo) -> str:
    country = ((shop.extra or {}).get("country") or shop.credential.get("country") or "SG").upper()
    return API_BASES.get(country, API_BASES["SG"])


def _timestamp_iso() -> str:
    """Lazada 要求的时间戳：20240101120000+0800 形式（UTC+8）。"""
    tz = time.strftime("%z") or "+0800"
    return time.strftime("%Y%m%d%H%M%S", time.localtime()) + tz


def _sign(params: Dict[str, str], secret: str, payload: str = "") -> str:
    """HMAC-SHA256(secret, sorted urlencoded params + payload_json)."""
    sorted_pairs = sorted(f"{k}={urllib.parse.quote(v, safe='')}" for k, v in params.items())
    s = "&".join(sorted_pairs) + (payload or "")
    return hmac.new(secret.encode(), s.encode(), hashlib.sha256).hexdigest().upper()


class LazadaConnector(PlatformConnector):
    CLASS_PLATFORM = "lazada"
    CLASS_NAME = "Lazada"
    AUTH_MODE = "oauth"

    def _app_creds(self, shop: ShopInfo) -> Tuple[Optional[str], Optional[str]]:
        k = shop.credential.get("app_key") or (shop.extra or {}).get("app_key")
        s = shop.credential.get("app_secret") or (shop.extra or {}).get("app_secret")
        return k, s

    def _call(
        self,
        shop: ShopInfo,
        action: str,
        common_params: Optional[Dict[str, str]] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        token = shop.access_token or shop.credential.get("access_token")
        app_key, app_secret = self._app_creds(shop)
        if not token:
            raise ConnectorError("Lazada 缺少 access_token", 401)
        if not app_key or not app_secret:
            raise ConnectorError("Lazada 缺少 App Key / App Secret", 401)

        ts = _timestamp_iso()
        # action 去掉开头的 /（Node.js 里显式拼了 '/'）
        action_path = action.lstrip("/")
        params: Dict[str, str] = {
            "action": action_path,
            "app_key": str(app_key),
            "access_token": token,
            "format": "json",
            "timestamp": ts,
            "sign_method": "sha256",
        }
        if common_params:
            for k, v in common_params.items():
                params[k] = str(v)

        payload_str = json.dumps(payload, ensure_ascii=False) if payload else ""
        params["sign"] = _sign(params, str(app_secret), payload_str)

        url = _endpoint(shop) + "/" + action_path
        try:
            if payload is not None:
                r = httpx.post(url, params=params, content=payload_str, headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                }, timeout=20)
            else:
                r = httpx.get(url, params=params, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"Lazada 网络错误: {e}", 502)

        try:
            data = r.json() if r.text else {}
        except Exception:
            raise ConnectorError(f"Lazada 非 JSON 响应: {r.text[:200]}", r.status_code)

        # code 0 / "0000" 都是成功
        code = str(data.get("code", ""))
        if (not r.ok) or (code and code not in ("0", "0000", "00", "")):
            msg = data.get("message") or data.get("error_message") or data.get("msg") or r.text[:200]
            raise ConnectorError(f"Lazada 调用失败: {msg}", r.status_code, payload=data)
        return data

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Optional[Dict]]:
        try:
            data = self._call(shop, "/orders/get", {"limit": "1", "offset": "0", "created_after": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() - 86400))}, None)
            return True, "Lazada 凭据有效", data
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        since_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(since_ts))
        data = self._call(shop, "/orders/get", {
            "created_after": since_str,
            "limit": str(min(limit, 100)),
            "offset": "0",
        }, None)
        orders = ((data.get("data") or {}).get("orders")
                  or (data.get("data") or {}).get("order_list")
                  or [])
        if not isinstance(orders, list):
            orders = []
        out: List[NormalizedOrder] = []
        for o in orders:
            if not isinstance(o, dict):
                continue
            raw_id = str(o.get("order_number") or o.get("order_id") or "")
            raw_id = re.sub(r"[^0-9A-Za-z]", "", raw_id)
            if not raw_id:
                continue
            status_val = o.get("statuses") or o.get("status")
            out.append(NormalizedOrder(
                order_no="LZD" + raw_id,
                platform_order_id=str(o.get("order_id") or raw_id),
                status=self._map_status(status_val),
                total_amount=float(o.get("price") or o.get("paid_price") or 0),
                buyer_name=o.get("customer_first_name") or o.get("buyer_name") or "",
                country=(o.get("address_billing_country") or o.get("country") or "").upper(),
                created_at_ts=iso_to_ts(o.get("created_at") or o.get("create_time")),
            ))
        return out

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        data = self._call(shop, "/products/get", {
            "limit": str(min(limit, 100)),
            "offset": "0",
        }, None)
        products = ((data.get("data") or {}).get("products")
                    or (data.get("data") or {}).get("items")
                    or [])
        if not isinstance(products, list):
            products = []
        out: List[NormalizedProduct] = []
        for it in products:
            if not isinstance(it, dict):
                continue
            item_id = str(it.get("item_id") or it.get("product_id") or "")
            sku = str(it.get("sku") or it.get("seller_sku") or item_id)
            if not item_id and not sku:
                continue
            attrs = it.get("attributes") or {}
            if isinstance(attrs, list):
                # 有些版本 attributes 是列表
                name = next((a.get("value") for a in attrs if isinstance(a, dict) and a.get("name") == "name"), "")
            elif isinstance(attrs, dict):
                name = attrs.get("name") or attrs.get("title") or ""
            else:
                name = ""
            if not name:
                name = it.get("name") or f"Lazada {sku or item_id}"
            sku_list = it.get("skus") or it.get("item_skus") or []
            price = 0.0
            if sku_list and isinstance(sku_list, list):
                first = sku_list[0] or {}
                price = float(first.get("price") or first.get("sale_price") or 0)
            out.append(NormalizedProduct(
                sku="LZD-" + (sku or item_id),
                platform_sku=sku or item_id,
                name=name,
                price=price,
                platform_product_id=str(item_id or ""),
            ))
        return out

    @staticmethod
    def _map_status(statuses: Any) -> str:
        arr = statuses if isinstance(statuses, list) else [statuses] if statuses else []
        lowered = [str(s).lower() for s in arr]
        if any("cancel" in v for v in lowered):
            return "CANCELLED"
        if any("ship" in v for v in lowered):
            return "SHIPPED"
        if any("deliver" in v for v in lowered):
            return "DELIVERED"
        return "PENDING"


def iso_to_ts(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    try:
        return int(time.mktime(time.strptime(s.replace("Z", "+0000").replace("+00:00", "+0000"), "%Y-%m-%dT%H:%M:%S%z")))
    except Exception:
        try:
            return int(time.mktime(time.strptime(str(s)[:19], "%Y-%m-%dT%H:%M:%S")))
        except Exception:
            return None
