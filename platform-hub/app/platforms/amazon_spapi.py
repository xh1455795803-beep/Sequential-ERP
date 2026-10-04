"""Amazon SP-API connector - OAuth refresh_token flow + Orders v0 API.

Migrated from deploy/backend/src/platforms/amazon.js
Docs: https://developer-docs.amazon.com/sp-api
Regions: NA / EU / FE → different API host.
"""
import time
from typing import Any, Dict, List, Optional, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
REGION_HOSTS = {
    "NA": "https://sellingpartnerapi.na.amazon.com",
    "EU": "https://sellingpartnerapi.eu.amazon.com",
    "FE": "https://sellingpartnerapi.fe.amazon.com",
}


def _host(shop: ShopInfo) -> str:
    region = (shop.extra or {}).get("region", "NA").upper() if shop.extra else "NA"
    return REGION_HOSTS.get(region, REGION_HOSTS["NA"])


class AmazonSpapiConnector(PlatformConnector):
    CLASS_PLATFORM = "amazon_spapi"
    CLASS_NAME = "Amazon SP-API"
    AUTH_MODE = "oauth"

    def _app_creds(self, shop: ShopInfo):
        """Client_id + client_secret may come from credential or extra."""
        k = shop.credential.get("client_id") or (shop.extra or {}).get("client_id")
        s = shop.credential.get("client_secret") or (shop.extra or {}).get("client_secret")
        marketplace = shop.credential.get("marketplace_id") or (shop.extra or {}).get("marketplace_id")
        return k, s, marketplace

    def refresh_token(self, shop: ShopInfo) -> Optional[Tuple[str, int]]:
        refresh = shop.refresh_token or shop.credential.get("refresh_token")
        client_id, client_secret, _ = self._app_creds(shop)
        if not refresh or not client_id or not client_secret:
            return None
        try:
            r = httpx.post(LWA_TOKEN_URL, data={
                "grant_type": "refresh_token",
                "refresh_token": refresh,
                "client_id": client_id,
                "client_secret": client_secret,
            }, timeout=20)
            data = r.json() if r.text else {}
            if r.ok and data.get("access_token"):
                return data["access_token"], int(data.get("expires_in", 3600))
            raise ConnectorError(f"Amazon 刷新令牌失败: {data}", r.status_code)
        except httpx.HTTPError as e:
            raise ConnectorError(f"Amazon 网络错误: {e}", 502)

    def _ensure_access_token(self, shop: ShopInfo) -> str:
        tok = shop.access_token or shop.credential.get("access_token")
        if tok:
            return tok
        # try refresh
        refreshed = self.refresh_token(shop)
        if refreshed:
            return refreshed[0]
        raise ConnectorError("Amazon 无 access_token，且 refresh_token 刷新失败，请重新授权", 401)

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Any]:
        try:
            tok = self._ensure_access_token(shop)
            host = _host(shop)
            _, _, marketplace = self._app_creds(shop)
            if not marketplace:
                return False, "Amazon 缺少 marketplace_id (例如 ATVPDKIKX0DER)", None
            r = httpx.get(f"{host}/orders/v0/orders", headers={
                "x-amz-access-token": tok,
                "Content-Type": "application/json",
            }, params={
                "MarketplaceIds": marketplace,
                "CreatedAfter": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 86400)),
            }, timeout=20)
            if r.status_code in (401, 403):
                return False, f"Amazon 权限错误 ({r.status_code}): {r.text[:200]}", None
            if r.ok:
                return True, "Amazon SP-API 凭据有效", r.json()
            return False, f"Amazon {r.status_code}: {r.text[:200]}", None
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        tok = self._ensure_access_token(shop)
        host = _host(shop)
        _, _, marketplace = self._app_creds(shop)
        if not marketplace:
            raise ConnectorError("Amazon 缺少 marketplace_id", 400)
        created_after = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(since_ts))

        out: List[NormalizedOrder] = []
        next_token: Optional[str] = None
        max_pages = 10
        for _ in range(max_pages):
            params = {
                "MarketplaceIds": marketplace,
                "CreatedAfter": created_after,
            }
            if next_token:
                params["NextToken"] = next_token
            try:
                r = httpx.get(f"{host}/orders/v0/orders", headers={
                    "x-amz-access-token": tok,
                    "Content-Type": "application/json",
                }, params=params, timeout=30)
            except httpx.HTTPError as e:
                raise ConnectorError(f"Amazon 网络错误: {e}", 502)
            if not r.ok:
                raise ConnectorError(f"Amazon {r.status_code}: {r.text[:300]}", r.status_code)
            data = r.json() if r.text else {}
            payload = data.get("payload") or {}
            for o in payload.get("Orders") or []:
                order_id = str(o.get("AmazonOrderId") or "")
                if not order_id:
                    continue
                shipping = o.get("ShippingAddress") or {}
                total = (o.get("OrderTotal") or {}).get("Amount", 0) if isinstance(o.get("OrderTotal"), dict) else 0
                out.append(NormalizedOrder(
                    order_no="AMZ" + order_id.replace("-", ""),
                    platform_order_id=order_id,
                    status=self._status_from(o.get("OrderStatus")),
                    total_amount=float(total or 0),
                    buyer_name=o.get("BuyerName") or o.get("BuyerEmail") or "",
                    country=shipping.get("CountryCode", ""),
                    created_at_ts=iso_to_ts(o.get("PurchaseDate")),
                ))
            next_token = payload.get("NextToken")
            if not next_token:
                break
        return out

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        # Minimal - relies on seller SKU list passed via shop.extra.skus
        # Real production implementation uses Reports API (asynchronous) to pull seller's full listing.
        raise ConnectorError(
            "Amazon fetch_products 需要 seller_sku 列表（通过 shop.extra.skus 逗号分隔传入）"
            " 或接入异步 Reports API。当前暂不支持自动拉全量 SKU。",
            501,
        )


def iso_to_ts(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    try:
        return int(time.mktime(time.strptime(s.replace("Z", "+0000"), "%Y-%m-%dT%H:%M:%S%z")))
    except Exception:
        return None
