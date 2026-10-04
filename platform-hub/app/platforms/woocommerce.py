"""WooCommerce connector - Basic Auth + wp-json/wc/v3 REST API.

WooCommerce REST API 文档: https://woocommerce.github.io/woocommerce-rest-api-docs/
通过 WordPress 后台 → 设置 → 高级 → REST API → 添加 Key，得到 consumer_key / consumer_secret。
"""
import base64, re, time
from typing import Any, Dict, List, Optional, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError


def _base_url(site_url: str) -> str:
    domain = (site_url or "").replace("https://", "").replace("http://", "").rstrip("/")
    if not domain:
        return ""
    # 允许传入带 / 子路径的完整站点
    return f"https://{domain}/wp-json/wc/v3"


def _auth_header(consumer_key: str, consumer_secret: str) -> str:
    token = base64.b64encode(f"{consumer_key}:{consumer_secret}".encode()).decode()
    return f"Basic {token}"


def _normalize_url(url_or_domain: str) -> str:
    """用户可能传 http:// 或 https:// 或裸域名，统一处理。"""
    if not url_or_domain:
        return ""
    u = url_or_domain.strip().rstrip("/")
    if u.startswith("http://") or u.startswith("https://"):
        return u
    # 默认用 https
    return "https://" + u


class WooCommerceConnector(PlatformConnector):
    CLASS_PLATFORM = "woocommerce"
    CLASS_NAME = "WooCommerce"
    AUTH_MODE = "apikey"

    def _creds(self, shop: ShopInfo) -> Tuple[str, str, str]:
        """返回 (base_url, consumer_key, consumer_secret)."""
        key = shop.api_key or shop.credential.get("consumer_key")
        secret = shop.api_secret or shop.credential.get("consumer_secret")
        site = shop.credential.get("site_url") or shop.credential.get("store_url") or shop.credential.get("shop_domain")
        site = _normalize_url(site)
        if not site:
            raise ConnectorError("WooCommerce 缺少站点 URL (site_url)，例如 https://yourstore.com", 400)
        if not key or not secret:
            raise ConnectorError("WooCommerce 缺少 consumer_key / consumer_secret", 401)
        base = _base_url(site)
        return base, str(key), str(secret)

    def _get(self, shop: ShopInfo, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        base, key, secret = self._creds(shop)
        url = base + path
        headers = {"Authorization": _auth_header(key, secret), "Accept": "application/json"}
        try:
            r = httpx.get(url, headers=headers, params=params, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"WooCommerce 网络错误: {e}", 502)

        if r.status_code == 401:
            raise ConnectorError("WooCommerce consumer_key/secret 无效", 401)
        if r.status_code == 403:
            raise ConnectorError("WooCommerce 无权限，请检查 REST API 权限", 403)
        if r.status_code == 404:
            raise ConnectorError(f"WooCommerce API 路径不存在 (站点未装 WooCommerce？): {r.text[:200]}", 404)
        if r.status_code == 429:
            raise ConnectorError("WooCommerce 速率限制 (429)，稍后再试", 429)
        if not r.ok:
            raise ConnectorError(f"WooCommerce {r.status_code}: {r.text[:300]}", r.status_code)
        try:
            return r.json() if r.text else None
        except Exception:
            raise ConnectorError(f"WooCommerce 非 JSON 响应: {r.text[:200]}", r.status_code)

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Optional[Dict]]:
        try:
            data = self._get(shop, "/system_status")
            # system_status 可能返回整个站点状态对象；简单取一些关键字段
            name = ""
            if isinstance(data, dict):
                name = (data.get("environment") or {}).get("home_url") or data.get("name") or ""
            return True, f"WooCommerce 连接成功: {name or shop.credential.get('site_url')}", (data if isinstance(data, dict) else None)
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        since_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(since_ts))
        data = self._get(shop, "/orders", params={
            "after": since_iso,
            "per_page": min(limit, 100),
            "status": "any",
            "_fields": "id,order_number,status,currency_symbol,total,billing,shipping,date_created,date_modified",
        })
        raw = data if isinstance(data, list) else []
        out: List[NormalizedOrder] = []
        for o in raw:
            if not isinstance(o, dict):
                continue
            raw_id = str(o.get("order_number") or o.get("id") or "")
            if not raw_id:
                continue
            bill = o.get("billing") or {}
            ship = o.get("shipping") or {}
            country = (ship.get("country") or bill.get("country") or "").upper()
            buyer_name = bill.get("first_name", "") + " " + bill.get("last_name", "")
            buyer_name = buyer_name.strip() or bill.get("company") or bill.get("email", "")
            out.append(NormalizedOrder(
                order_no="WC-" + re.sub(r"[^0-9A-Za-z]", "", raw_id),
                platform_order_id=str(o.get("id")),
                status=self._map_status(o.get("status")),
                total_amount=float(o.get("total") or 0),
                buyer_name=buyer_name,
                country=country,
                created_at_ts=iso_to_ts(o.get("date_created")),
            ))
        return out

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        data = self._get(shop, "/products", params={
            "per_page": min(limit, 100),
            "status": "publish",
            "_fields": "id,name,sku,price,regular_price,sale_price,type,variations",
        })
        raw = data if isinstance(data, list) else []
        out: List[NormalizedProduct] = []
        for p in raw:
            if not isinstance(p, dict):
                continue
            variants = p.get("variations") or []
            base_id = str(p.get("id"))
            base_name = p.get("name") or ""
            base_sku = str(p.get("sku") or base_id)
            # 优先取变体的第一条价格
            price_val = p.get("price") or p.get("regular_price") or 0
            out.append(NormalizedProduct(
                sku="WC-" + (base_sku or base_id),
                platform_sku=base_sku or base_id,
                name=base_name or f"WooCommerce {base_id}",
                price=float(price_val or 0),
                platform_product_id=base_id,
            ))
            # 如果有独立 SKU 的变体，可选再额外导出
            for v in variants:
                if not isinstance(v, dict):
                    continue
                v_sku = str(v.get("sku") or "")
                if not v_sku:
                    continue
                v_price = v.get("price") or v.get("regular_price") or 0
                out.append(NormalizedProduct(
                    sku="WC-" + v_sku,
                    platform_sku=v_sku,
                    name=f"{base_name} - {v_sku}",
                    price=float(v_price or 0),
                    platform_product_id=str(v.get("id") or base_id),
                ))
        return out

    @staticmethod
    def _map_status(s: Optional[str]) -> str:
        if not s:
            return "PENDING"
        v = str(s).lower()
        if "cancel" in v or "refunded" in v:
            return "CANCELLED"
        if "complete" in v:
            return "DELIVERED"
        if "processing" in v or "shipped" in v:
            return "SHIPPED"
        return "PENDING"


def iso_to_ts(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    try:
        return int(time.mktime(time.strptime(s.replace("Z", "+0000").replace("+00:00", "+0000"), "%Y-%m-%dT%H:%M:%S%z")))
    except Exception:
        try:
            return int(time.mktime(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")))
        except Exception:
            return None
