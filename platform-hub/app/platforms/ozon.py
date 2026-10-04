"""Ozon connector - API Key (Client-Id + Bearer token / Api-Key).

Migrated from deploy/backend/src/platforms/ozon.js
API 文档: https://docs.ozon.ru/api/seller

Ozon 有两种鉴权模式，本连接器同时兼容：
  1. 旧版（Node.js 原版）: Client-Id + Api-Key 请求头
  2. 新版（用户指定）      : Client-Id + Authorization: Bearer

API Host: https://api-seller.ozon.ru
"""
import re, time
from typing import Any, Dict, List, Optional, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

API_BASE = "https://api-seller.ozon.ru"


def _iso_from_ts(ts: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ts))


def _parse_ts(s: Any) -> Optional[int]:
    if not s:
        return None
    try:
        return int(time.mktime(time.strptime(str(s).replace("Z", "+0000").replace("+00:00", "+0000"), "%Y-%m-%dT%H:%M:%S%z")))
    except Exception:
        return None


class OzonConnector(PlatformConnector):
    CLASS_PLATFORM = "ozon"
    CLASS_NAME = "Ozon"
    AUTH_MODE = "apikey"

    def _creds(self, shop: ShopInfo) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """返回 (client_id, bearer_or_api_key, is_oauth)."""
        client_id = shop.api_key or shop.credential.get("client_id") or shop.credential.get("Client-Id")
        # 新版 OAuth Bearer 优先
        bearer = shop.credential.get("access_token") or shop.access_token or shop.credential.get("bearer_token")
        # 旧版 Api-Key 兼容
        api_key = shop.api_secret or shop.credential.get("api_key") or shop.credential.get("Api-Key")
        return client_id, bearer, api_key

    def _headers(self, shop: ShopInfo) -> Dict[str, str]:
        client_id, bearer, api_key = self._creds(shop)
        if not client_id:
            raise ConnectorError("Ozon 缺少 Client-Id", 401)
        headers = {
            "Client-Id": str(client_id),
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        if api_key:
            headers["Api-Key"] = str(api_key)
        if not bearer and not api_key:
            raise ConnectorError("Ozon 缺少 Api-Key 或 access_token", 401)
        return headers

    def _post(self, shop: ShopInfo, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        headers = self._headers(shop)
        url = API_BASE + path
        try:
            r = httpx.post(url, json=payload, headers=headers, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"Ozon 网络错误: {e}", 502)

        try:
            data = r.json() if r.text else {}
        except Exception:
            raise ConnectorError(f"Ozon 非 JSON 响应: {r.text[:200]}", r.status_code)

        if r.status_code == 401:
            raise ConnectorError("Ozon 鉴权失败，请检查 Client-Id / Api-Key", 401)
        if r.status_code == 403:
            raise ConnectorError("Ozon 无权限", 403)
        if not r.ok:
            # Ozon 错误格式: { code, message, details: [...] }
            err = data.get("message") or data.get("error") or str(data)[:200]
            raise ConnectorError(f"Ozon 调用失败: {err}", r.status_code, payload=data)
        # 业务 code != 0 也算失败
        if data.get("code") not in (0, None):
            msg = data.get("message") or str(data)[:200]
            raise ConnectorError(f"Ozon 业务错误: {msg}", r.status_code, payload=data)
        return data

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Optional[Dict]]:
        try:
            data = self._post(shop, "/v3/order/list", {
                "dir": "ASC",
                "filter": {
                    "since": _iso_from_ts(int(time.time()) - 86400),
                    "to": _iso_from_ts(int(time.time())),
                },
                "limit": 1,
            })
            return True, "Ozon 凭据有效", data
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        data = self._post(shop, "/v3/order/list", {
            "dir": "ASC",
            "filter": {
                "since": _iso_from_ts(since_ts),
                "to": _iso_from_ts(int(time.time())),
            },
            "limit": min(limit, 100),
        })
        postings = (data.get("result") or {}).get("postings") or []
        if not isinstance(postings, list):
            postings = []
        out: List[NormalizedOrder] = []
        for o in postings:
            if not isinstance(o, dict):
                continue
            raw_id = str(o.get("posting_number") or o.get("order_id") or "")
            raw_id = re.sub(r"[^0-9A-Za-z-]", "", raw_id)
            if not raw_id:
                continue
            total_obj = o.get("total") or {}
            try:
                total = float(total_obj.get("price") or total_obj.get("amount") or 0)
            except (ValueError, TypeError):
                total = 0.0
            buyer = o.get("buyer") or {}
            analytics = o.get("analytics_data") or {}
            out.append(NormalizedOrder(
                order_no="OZN" + raw_id.replace("-", ""),
                platform_order_id=str(o.get("posting_number") or raw_id),
                status=self._map_status(o.get("status")),
                total_amount=total,
                buyer_name=buyer.get("name") or buyer.get("first_name") or "",
                country=(analytics.get("region") or analytics.get("city") or "RU").upper(),
                created_at_ts=_parse_ts(o.get("in_process_at") or o.get("create_time")),
            ))
        return out

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        out: List[NormalizedProduct] = []
        last_item_id = ""
        max_pages = (min(limit, 200) // 100) + 1
        for page in range(max_pages):
            data = self._post(shop, "/v2/product/list", {
                "limit": 100,
                "last_id": last_item_id,
            })
            result = data.get("result") or {}
            items = result.get("items") or []
            if not isinstance(items, list) or not items:
                break
            product_ids = []
            for it in items:
                if isinstance(it, dict):
                    pid = str(it.get("product_id") or it.get("offer_id") or "")
                    if pid:
                        product_ids.append(pid)
            if product_ids:
                detail = self._post(shop, "/v2/product/info/list", {
                    "product_id": product_ids,
                })
                detail_items = (detail.get("result") or {}).get("items") or []
                if not isinstance(detail_items, list):
                    detail_items = []
                for it in detail_items:
                    if not isinstance(it, dict):
                        continue
                    sku = str(it.get("sku") or it.get("offer_id") or it.get("product_id") or "")
                    if not sku:
                        continue
                    name = it.get("name") or f"Ozon {sku}"
                    price_obj = it.get("price") or it.get("old_price") or {}
                    try:
                        price = float(price_obj.get("price") or price_obj.get("amount") or 0) if isinstance(price_obj, dict) else float(price_obj or 0)
                    except (ValueError, TypeError):
                        price = 0.0
                    out.append(NormalizedProduct(
                        sku="OZN-" + sku,
                        platform_sku=sku,
                        name=name,
                        price=price,
                        platform_product_id=str(it.get("product_id") or sku),
                    ))
            last_item_id = str(result.get("last_item_id") or result.get("last_id") or "")
            if not last_item_id or len(items) < 100:
                break
        return out

    @staticmethod
    def _map_status(s: Any) -> str:
        if not s:
            return "PENDING"
        v = str(s).lower()
        if "awaiting" in v or "new" in v or "prepare" in v:
            return "PENDING"
        if "deliver" in v or "shipped" in v or "in_progress" in v:
            return "SHIPPED"
        if "delivered" in v:
            return "DELIVERED"
        if "cancel" in v:
            return "CANCELLED"
        return "PENDING"
