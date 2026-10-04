"""Walmart connector - OAuth Bearer token (新版 Walmart Open API).

旧版 Node.js 实现 deploy/backend/src/platforms/walmart.js 走 WM_CONSUMER.ID / WM_SEC.AUTH_TOKEN 头。
新版 Walmart Open API Gateway 用 OAuth access_token 放 Authorization: Bearer。
这里按用户要求走 OAuth 路线，兼容 refresh_token 流程。

API 文档: https://developer.walmart.com
Host    : https://api-gateway.walmart.com/v3
"""
import re, time, uuid, base64
from typing import Any, Dict, List, Optional, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

API_BASE = "https://api-gateway.walmart.com/v3"
TOKEN_URL = "https://api-gateway.walmart.com/v3/token"


def _new_correlation_id() -> str:
    return str(uuid.uuid4())


def _iso_from_ts(ts: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ts))


def _parse_ts(s: Any) -> Optional[int]:
    if not s:
        return None
    try:
        return int(time.mktime(time.strptime(str(s).replace("Z", "+0000").replace("+00:00", "+0000"), "%Y-%m-%dT%H:%M:%S%z")))
    except Exception:
        return None


class WalmartConnector(PlatformConnector):
    CLASS_PLATFORM = "walmart"
    CLASS_NAME = "Walmart Marketplace"
    AUTH_MODE = "oauth"

    def _app_creds(self, shop: ShopInfo) -> Tuple[Optional[str], Optional[str]]:
        """Walmart OAuth: client_id (aka consumer_id) + client_secret (aka private_key)."""
        cid = shop.credential.get("client_id") or shop.credential.get("consumer_id") or shop.api_key
        secret = shop.credential.get("client_secret") or shop.credential.get("private_key") or shop.api_secret
        return cid, secret

    def refresh_token(self, shop: ShopInfo) -> Optional[Tuple[str, int]]:
        """Walmart OAuth2 client_credentials / refresh_token 流程。"""
        cid, secret = self._app_creds(shop)
        refresh = shop.refresh_token or shop.credential.get("refresh_token")
        if not cid or not secret:
            return None
        # Walmart 新版 OAuth 用 Basic base64(client_id:client_secret) + grant_type=refresh_token
        # 如果没有 refresh_token，则走 client_credentials
        basic = base64.b64encode(f"{cid}:{secret}".encode()).decode()
        data = {"grant_type": "client_credentials"}
        if refresh:
            data = {"grant_type": "refresh_token", "refresh_token": refresh}
        try:
            r = httpx.post(TOKEN_URL, data=data, headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
            }, timeout=20)
            token_data = r.json() if r.text else {}
            if r.ok and token_data.get("access_token"):
                return token_data["access_token"], int(token_data.get("expires_in", 900))
            raise ConnectorError(f"Walmart 刷新令牌失败: {token_data}", r.status_code)
        except httpx.HTTPError as e:
            raise ConnectorError(f"Walmart 网络错误: {e}", 502)

    def _get(self, shop: ShopInfo, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        token = shop.access_token or shop.credential.get("access_token")
        if not token:
            # 尝试 refresh
            refreshed = self.refresh_token(shop)
            if refreshed:
                token = refreshed[0]
            else:
                raise ConnectorError("Walmart 缺少 access_token 且无法刷新，请重新授权", 401)

        url = API_BASE + path
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "WM_QOS.CORRELATION_ID": _new_correlation_id(),
        }
        try:
            r = httpx.get(url, headers=headers, params=params, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"Walmart 网络错误: {e}", 502)

        try:
            data = r.json() if r.text else {}
        except Exception:
            raise ConnectorError(f"Walmart 非 JSON 响应: {r.text[:200]}", r.status_code)

        if r.status_code == 401:
            raise ConnectorError("Walmart access_token 无效或已过期", 401)
        if r.status_code == 403:
            raise ConnectorError("Walmart 无权限", 403)
        if not r.ok:
            err_msg = ""
            if isinstance(data, dict):
                err_obj = data.get("errors") or data.get("error")
                if isinstance(err_obj, list) and err_obj:
                    err_msg = err_obj[0].get("description") or err_obj[0].get("message") or ""
                elif isinstance(err_obj, dict):
                    err_msg = err_obj.get("description") or err_obj.get("message") or ""
                if not err_msg:
                    err_msg = data.get("message") or ""
            raise ConnectorError(f"Walmart 调用失败: {err_msg or r.text[:200]}", r.status_code, payload=data)
        return data

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Optional[Dict]]:
        try:
            data = self._get(shop, "/orders", {
                "createdStartDate": _iso_from_ts(int(time.time()) - 86400),
                "limit": "1",
            })
            return True, "Walmart 凭据有效", data
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        data = self._get(shop, "/orders", {
            "createdStartDate": _iso_from_ts(since_ts),
            "limit": str(min(limit, 200)),
        })
        # Walmart v3 订单列表在 list.elements.order
        order_list = (data.get("list") or {}).get("elements") or data.get("orders") or []
        if isinstance(order_list, dict):
            order_list = order_list.get("order") or []
        if not isinstance(order_list, list):
            order_list = []

        out: List[NormalizedOrder] = []
        for o in order_list:
            if not isinstance(o, dict):
                continue
            raw_id = str(o.get("purchaseOrderId") or o.get("orderId") or "")
            raw_id = re.sub(r"[^0-9A-Za-z]", "", raw_id)
            if not raw_id:
                continue
            # 计算总金额 — Walmart v3 结构: orderLines.orderLine[].charges.charge[].chargeAmount.amount
            total = 0.0
            order_lines = o.get("orderLines")
            if isinstance(order_lines, dict):
                ol = order_lines.get("orderLine") or []
                if isinstance(ol, dict):
                    ol = [ol]
                for line in ol:
                    if not isinstance(line, dict):
                        continue
                    charges = line.get("charges") or {}
                    ch = charges.get("charge") or []
                    if isinstance(ch, dict):
                        ch = [ch]
                    for c in ch:
                        if not isinstance(c, dict):
                            continue
                        amt_obj = c.get("chargeAmount") or {}
                        if isinstance(amt_obj, dict):
                            try:
                                total += float(amt_obj.get("amount", 0))
                            except (ValueError, TypeError):
                                pass
            # shippingInfo.postalAddress
            ship = o.get("shippingInfo") or {}
            postal = ship.get("postalAddress") or {}
            country = (postal.get("country") or "US").upper()
            buyer_name = postal.get("name") or ""
            out.append(NormalizedOrder(
                order_no="WMT" + raw_id,
                platform_order_id=str(o.get("purchaseOrderId") or raw_id),
                status=self._map_status(order_lines),
                total_amount=total,
                buyer_name=buyer_name,
                country=country,
                created_at_ts=_parse_ts(o.get("purchaseDate") or o.get("createDate")),
            ))
        return out

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        data = self._get(shop, "/items", {"limit": str(min(limit, 200))})
        # Walmart v3 items 在 ItemList.Item 或 data.items
        items = data.get("items") or (data.get("ItemList") or {}).get("Item") or []
        if not isinstance(items, list):
            items = []
        out: List[NormalizedProduct] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            sku = str(it.get("sku") or it.get("sellerSku") or "")
            if not sku:
                continue
            name = it.get("productName") or it.get("title") or f"Walmart {sku}"
            price = 0.0
            price_obj = it.get("price") or {}
            if isinstance(price_obj, dict):
                try:
                    price = float(price_obj.get("amount") or price_obj.get("value") or 0)
                except (ValueError, TypeError):
                    pass
            out.append(NormalizedProduct(
                sku="WMT-" + sku,
                platform_sku=sku,
                name=name,
                price=price,
                platform_product_id=str(it.get("productId") or it.get("itemId") or sku),
            ))
        return out

    @staticmethod
    def _map_status(order_lines: Any) -> str:
        if not order_lines:
            return "PENDING"
        arr = order_lines if isinstance(order_lines, list) else [order_lines] if isinstance(order_lines, dict) else []
        statuses: List[str] = []
        for l in arr:
            if not isinstance(l, dict):
                continue
            # Walmart 不同版本 status 字段在 orderLine.status 或 orderLine.orderLineStatus
            status = l.get("status") or l.get("orderLineStatus")
            if status:
                statuses.append(str(status).lower())
        if not statuses:
            return "PENDING"
        if all("cancel" in s for s in statuses):
            return "CANCELLED"
        if any("deliver" in s or "complete" in s or "shipped" in s for s in statuses):
            # 全部已送达才算 DELIVERED？这里宽松处理：任一 DELIVERED 都算 DELIVERED
            if any("deliver" in s or "complete" in s for s in statuses):
                return "DELIVERED"
            return "SHIPPED"
        return "PENDING"
