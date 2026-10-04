"""Shopify connector - OAuth + Admin REST API 2024-01.

Shopify is NOT in the existing Node.js deploy code (it was a stub).
Built fresh against Shopify Partners / Admin API docs.

OAuth flow is handled via app/routers/oauth.py → /api/oauth/shopify/start and /callback
This module takes an already-authorized shop (with access_token stored).
"""
import time
from typing import Any, Dict, List, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

API_VERSION = "2024-01"


def _base_url(shop_domain: str) -> str:
    domain = shop_domain.replace("https://", "").replace("http://", "").rstrip("/")
    return f"https://{domain}/admin/api/{API_VERSION}"


class ShopifyConnector(PlatformConnector):
    CLASS_PLATFORM = "shopify"
    CLASS_NAME = "Shopify"
    AUTH_MODE = "oauth"

    def _get(self, shop: ShopInfo, path: str, params: Dict[str, Any] | None = None) -> Dict[str, Any]:
        token = shop.access_token or shop.credential.get("access_token")
        domain = shop.credential.get("shop_domain") or shop.credential.get("store_domain")
        if not token:
            raise ConnectorError("Shopify 缺少 access_token，请先完成 OAuth 授权", 401)
        if not domain:
            raise ConnectorError("Shopify 缺少 shop_domain (如 xxx.myshopify.com)", 400)

        url = _base_url(domain) + path
        headers = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}
        try:
            r = httpx.get(url, headers=headers, params=params, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"Shopify 网络错误: {e}", 502)

        if r.status_code == 401:
            raise ConnectorError("Shopify access_token 无效或已撤销，请重新授权", 401)
        if r.status_code == 429:
            raise ConnectorError("Shopify 速率限制 (429)，稍后再试", 429)
        if not r.ok:
            raise ConnectorError(f"Shopify {r.status_code}: {r.text[:300]}", r.status_code)
        data = r.json() if r.text else {}
        if not isinstance(data, dict):
            return {}
        return data

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Any]:
        try:
            data = self._get(shop, "/shop.json")
            shop_info = data.get("shop", {})
            return True, f"Shopify 连接成功: {shop_info.get('name', shop.credential.get('shop_domain'))}", shop_info
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        # Shopify uses ISO 8601 for updated_at_min
        iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(since_ts))
        data = self._get(shop, "/orders.json", params={
            "status": "any",
            "updated_at_min": iso,
            "limit": min(limit, 250),
            "fields": "id,order_number,financial_status,fulfillment_status,total_price,currency_code,billing_address,customer,created_at,updated_at",
        })
        raw = data.get("orders") or []
        out = []
        for o in raw:
            # prefer shipping address country, fallback to billing
            ship = o.get("shipping_address") or {}
            bill = o.get("billing_address") or {}
            country = ship.get("country_code") or ship.get("country") or bill.get("country_code") or bill.get("country") or ""
            cust = o.get("customer") or {}
            buyer_name = cust.get("first_name", "") + " " + cust.get("last_name", "")
            buyer_name = buyer_name.strip() or bill.get("name") or cust.get("email", "")

            status = self._map_status(
                financial=o.get("financial_status"),
                fulfillment=o.get("fulfillment_status"),
            )
            out.append(NormalizedOrder(
                order_no="SHOP" + str(o.get("order_number") or o.get("id") or ""),
                platform_order_id=str(o.get("id")),
                status=status,
                total_amount=float(o.get("total_price") or 0),
                buyer_name=buyer_name,
                country=country,
                created_at_ts=iso_to_ts(o.get("created_at")),
            ))
        return out

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        data = self._get(shop, "/products.json", params={
            "status": "active",
            "limit": min(limit, 250),
            "fields": "id,title,variants,options,images",
        })
        raw = data.get("products") or []
        out = []
        for p in raw:
            variants = p.get("variants") or []
            if variants:
                v = variants[0]
                out.append(NormalizedProduct(
                    sku="SHOP-" + str(v.get("sku") or v.get("id") or p.get("id")),
                    platform_sku=str(v.get("sku") or v.get("id")),
                    name=p.get("title", ""),
                    price=float(v.get("price") or 0),
                    platform_product_id=str(p.get("id")),
                ))
            else:
                out.append(NormalizedProduct(
                    sku="SHOP-" + str(p.get("id")),
                    platform_sku=str(p.get("id")),
                    name=p.get("title", ""),
                    price=0.0,
                    platform_product_id=str(p.get("id")),
                ))
        return out

    @staticmethod
    def _map_status(financial: str | None, fulfillment: str | None) -> str:
        """Shopify reports two statuses - combine into single order status."""
        financial = (financial or "").lower()
        fulfillment = (fulfillment or "").lower()
        if "void" in financial or "refunded" in financial:
            return "CANCELLED"
        if fulfillment in ("shipped", "partial") or fulfillment == "fulfilled":
            return "SHIPPED"
        if financial in ("authorized", "pending", "partial_refund"):
            return "PENDING"
        if financial in ("paid", "refunded"):
            return "SHIPPED" if fulfillment else "PENDING"
        return "PENDING"


def iso_to_ts(s: str | None) -> int | None:
    if not s:
        return None
    try:
        return int(time.mktime(time.strptime(s.replace("Z", "+0000"), "%Y-%m-%dT%H:%M:%S%z")))
    except Exception:
        return None
