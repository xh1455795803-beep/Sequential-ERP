"""eBay connector - OAuth Bearer token.

Migrated from deploy/backend/src/platforms/ebay.js
API 文档: https://developer.ebay.com

- 订单  : Sell Fulfillment API /sell/fulfillment/v1/order
- 商品  : Sell Inventory API  /sell/inventory/v1/inventory_item
- Host  : https://api.ebay.com
Auth    : Authorization: Bearer {access_token}
"""
import re, time
from typing import Any, Dict, List, Optional, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

API_BASE = "https://api.ebay.com"


def _iso_from_ts(ts: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ts))


def _parse_ts(s: Any) -> Optional[int]:
    if not s:
        return None
    try:
        return int(time.mktime(time.strptime(str(s).replace("Z", "+0000").replace("+00:00", "+0000"), "%Y-%m-%dT%H:%M:%S%z")))
    except Exception:
        return None


class EbayConnector(PlatformConnector):
    CLASS_PLATFORM = "ebay"
    CLASS_NAME = "eBay"
    AUTH_MODE = "oauth"

    def _get(self, shop: ShopInfo, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        token = shop.access_token or shop.credential.get("access_token")
        if not token:
            raise ConnectorError("eBay 缺少 access_token，请先完成 OAuth 授权", 401)

        url = API_BASE + path
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        try:
            r = httpx.get(url, headers=headers, params=params, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"eBay 网络错误: {e}", 502)

        try:
            data = r.json() if r.text else {}
        except Exception:
            raise ConnectorError(f"eBay 非 JSON 响应: {r.text[:200]}", r.status_code)

        if r.status_code == 401:
            raise ConnectorError("eBay access_token 无效或已过期", 401)
        if r.status_code == 403:
            raise ConnectorError("eBay 无权限（可能未申请 scope）", 403)
        if not r.ok:
            # eBay 错误格式: { errors: [{ message, ... }] }
            err_msg = ""
            if isinstance(data, dict):
                errs = data.get("errors") or []
                if isinstance(errs, list) and errs:
                    err_msg = errs[0].get("message") or errs[0].get("messageId") or ""
            raise ConnectorError(f"eBay 调用失败: {err_msg or r.text[:200]}", r.status_code, payload=data)
        return data

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Optional[Dict]]:
        try:
            data = self._get(shop, "/sell/fulfillment/v1/order", {
                "filter": f"lastmodifieddate:[{_iso_from_ts(int(time.time()) - 86400 * 7).replace('.000Z', '.000Z')}..]",
                "limit": "1",
            })
            return True, "eBay 凭据有效", data
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        since_iso = _iso_from_ts(since_ts)
        out: List[NormalizedOrder] = []
        max_pages = (min(limit, 200) // 200) + 1
        for page in range(max_pages):
            offset = page * 200
            data = self._get(shop, "/sell/fulfillment/v1/order", {
                "filter": f"lastmodifieddate:[{since_iso[:19]}.000Z..]",
                "limit": "200",
                "offset": str(offset),
            })
            orders = data.get("orders") or []
            if not isinstance(orders, list) or not orders:
                break
            for o in orders:
                if not isinstance(o, dict):
                    continue
                raw_id = str(o.get("orderId") or "")
                raw_id = re.sub(r"[^0-9A-Za-z-]", "", raw_id)
                if not raw_id:
                    continue
                pricing = o.get("pricingSummary") or {}
                total_obj = pricing.get("total") or {}
                try:
                    total = float(total_obj.get("value") or 0)
                except (ValueError, TypeError):
                    total = 0.0
                buyer = o.get("buyer") or {}
                ship_instructions = o.get("fulfillmentStartInstructions") or []
                country = ""
                if isinstance(ship_instructions, list) and ship_instructions:
                    si = ship_instructions[0] or {}
                    ship_step = si.get("shippingStep") or {}
                    ship_to = ship_step.get("shipTo") or {}
                    country = (ship_to.get("countryCode") or "").upper()
                out.append(NormalizedOrder(
                    order_no="EBAY" + raw_id.replace("-", ""),
                    platform_order_id=raw_id,
                    status=self._map_status(o.get("orderFulfillmentStatus"), o.get("orderPaymentStatus")),
                    total_amount=total,
                    buyer_name=buyer.get("username") or "",
                    country=country,
                    created_at_ts=_parse_ts(o.get("creationDate")),
                ))
            if len(orders) < 200:
                break
        return out

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        out: List[NormalizedProduct] = []
        # eBay Inventory API 每页 100，多页
        pages = (min(limit, 100) // 100) + 1
        for page in range(pages):
            data = self._get(shop, "/sell/inventory/v1/inventory_item", {
                "limit": "100",
                "offset": str(page * 100),
            })
            items = data.get("inventoryItems") or []
            if not isinstance(items, list) or not items:
                break
            for it in items:
                if not isinstance(it, dict):
                    continue
                sku = str(it.get("sku") or "")
                if not sku:
                    continue
                product = it.get("product") or {}
                name = product.get("title") or f"eBay {sku}"
                price_obj = it.get("price") or {}
                try:
                    price = float(price_obj.get("value") or 0)
                except (ValueError, TypeError):
                    price = 0.0
                out.append(NormalizedProduct(
                    sku="EBAY-" + sku,
                    platform_sku=sku,
                    name=name,
                    price=price,
                    platform_product_id=sku,
                ))
            if len(items) < 100:
                break
        return out

    @staticmethod
    def _map_status(fulfill: Any, payment: Any) -> str:
        payment_s = str(payment or "").lower()
        fulfill_s = str(fulfill or "").lower()
        if payment_s == "failed":
            return "CANCELLED"
        if "cancel" in fulfill_s:
            return "CANCELLED"
        if "shipped" in fulfill_s or "shippedpartially" in fulfill_s:
            return "SHIPPED"
        if "fulfilled" in fulfill_s:
            return "DELIVERED"
        return "PENDING"
