"""TikTok Shop connector - OAuth Bearer token.

TikTok Shop Seller Center OpenAPI 文档:
  https://partner.tiktokshop.com/docv2/shop/overview

API Host      : https://open-api.tiktokglobalshop.com
Auth          : Authorization: Bearer {access_token}
必需额外参数    : shop_cipher（店铺加密标识，创建授权时返回）
"""
import re, time
from typing import Any, Dict, List, Optional, Tuple
import httpx
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

API_BASE = "https://open-api.tiktokglobalshop.com"
API_VERSION = "v202409"


def _parse_ts(v: Any) -> Optional[int]:
    """TikTok 返回的时间戳通常是 10 位 unix 秒，有些版本是毫秒。"""
    if not v:
        return None
    try:
        n = int(str(v))
        if n > 10_000_000_000:  # 毫秒
            return n // 1000
        return n
    except (ValueError, TypeError):
        return None


class TiktokShopConnector(PlatformConnector):
    CLASS_PLATFORM = "tiktok_shop"
    CLASS_NAME = "TikTok Shop"
    AUTH_MODE = "oauth"

    def _post(self, shop: ShopInfo, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        token = shop.access_token or shop.credential.get("access_token")
        shop_cipher = shop.credential.get("shop_cipher") or (shop.extra or {}).get("shop_cipher")
        if not token:
            raise ConnectorError("TikTok Shop 缺少 access_token，请先完成 OAuth 授权", 401)
        if not shop_cipher:
            raise ConnectorError("TikTok Shop 缺少 shop_cipher（店铺加密标识）", 400)

        # 入参里必须带 access_token + shop_cipher
        full_payload = {
            "access_token": token,
            "shop_cipher": shop_cipher,
            **payload,
        }

        url = f"{API_BASE}/{API_VERSION}/{path.lstrip('/')}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        try:
            r = httpx.post(url, json=full_payload, headers=headers, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"TikTok Shop 网络错误: {e}", 502)

        try:
            data = r.json() if r.text else {}
        except Exception:
            raise ConnectorError(f"TikTok Shop 非 JSON 响应: {r.text[:200]}", r.status_code)

        # 业务错误码：code == 0 或 success: true
        if not r.ok:
            raise ConnectorError(f"TikTok Shop HTTP {r.status_code}: {r.text[:300]}", r.status_code)
        if data.get("code") not in (0, None) and data.get("success") is not True:
            msg = data.get("message") or data.get("msg") or data.get("error") or str(data)[:200]
            raise ConnectorError(f"TikTok Shop 业务失败: {msg}", r.status_code, payload=data)
        return data

    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Optional[Dict]]:
        try:
            # 试拉一条订单 / 或用 shop/info
            data = self._post(shop, "/shop/search", {"limit": 1, "offset": 0})
            return True, "TikTok Shop 凭据有效", data
        except ConnectorError as e:
            return False, str(e), e.payload

    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        data = self._post(shop, "/order/search", {
            "create_time_from": since_ts,
            "create_time_to": int(time.time()),
            "limit": min(limit, 100),
            "offset": 0,
        })
        orders = (data.get("data") or {}).get("orders") or []
        if not isinstance(orders, list):
            orders = []

        out: List[NormalizedOrder] = []
        for o in orders:
            if not isinstance(o, dict):
                continue
            raw_id = str(o.get("order_id") or o.get("order_no") or "")
            raw_id = re.sub(r"[^0-9A-Za-z]", "", raw_id)
            if not raw_id:
                continue
            amount = o.get("total_amount") or o.get("paid_amount") or 0
            # TikTok 的 amount 有时是字符串，带币种前缀/后缀都要转 float
            try:
                amount_f = float(amount)
            except (ValueError, TypeError):
                if isinstance(amount, dict):
                    try:
                        amount_f = float(amount.get("amount", 0))
                    except (ValueError, TypeError):
                        amount_f = 0.0
                else:
                    amount_f = 0.0
            ship_addr = o.get("shipping_address") or {}
            buyer = o.get("buyer") or {}
            out.append(NormalizedOrder(
                order_no="TTS" + raw_id,
                platform_order_id=str(o.get("order_id") or raw_id),
                status=self._map_status(o.get("order_status")),
                total_amount=amount_f,
                buyer_name=(buyer.get("username") or buyer.get("name") or ""),
                country=(ship_addr.get("country") or ship_addr.get("country_code") or "").upper(),
                created_at_ts=_parse_ts(o.get("create_time")),
            ))
        return out

    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        data = self._post(shop, "/product/search", {
            "limit": min(limit, 100),
            "offset": 0,
            "product_status": [1, 2],  # 1=在售 2=已下架（可选；不同版本字段名略有差异，这里兼容）
        })
        products = (data.get("data") or {}).get("products") or (data.get("data") or {}).get("items") or []
        if not isinstance(products, list):
            products = []
        out: List[NormalizedProduct] = []
        for it in products:
            if not isinstance(it, dict):
                continue
            pid = str(it.get("product_id") or it.get("item_id") or "")
            title = it.get("title") or it.get("name") or ""
            sku_list = it.get("skus") or []
            # 多个 SKU 时导出第一条，或直接 product 级
            product_skus: List[Tuple[str, float]] = []
            if isinstance(sku_list, list):
                for sku in sku_list:
                    if not isinstance(sku, dict):
                        continue
                    sid = str(sku.get("sku_id") or sku.get("seller_sku") or "")
                    price = sku.get("price") or sku.get("sale_price") or 0
                    try:
                        price_f = float(price)
                    except (ValueError, TypeError):
                        if isinstance(price, dict):
                            try:
                                price_f = float(price.get("sale_price") or price.get("amount") or 0)
                            except (ValueError, TypeError):
                                price_f = 0.0
                        else:
                            price_f = 0.0
                    if sid:
                        product_skus.append((sid, price_f))

            if product_skus:
                for sid, price_f in product_skus:
                    out.append(NormalizedProduct(
                        sku="TTS-" + sid,
                        platform_sku=sid,
                        name=title or f"TikTok {sid}",
                        price=price_f,
                        platform_product_id=pid,
                    ))
            else:
                out.append(NormalizedProduct(
                    sku="TTS-" + (pid or ""),
                    platform_sku=pid or "",
                    name=title or f"TikTok {pid}",
                    price=0.0,
                    platform_product_id=pid,
                ))
        return out

    @staticmethod
    def _map_status(s: Any) -> str:
        if not s:
            return "PENDING"
        v = str(s).lower()
        if "cancel" in v or v in ("104", "cancel"):
            return "CANCELLED"
        # 已发货: 300, 303
        if v in ("300", "303") or "ship" in v or "shipped" in v:
            return "SHIPPED"
        # 已完成: 400
        if v in ("400",) or "finish" in v or "complete" in v or "delivered" in v:
            return "DELIVERED"
        # 待处理: 100, 101, 102, 103
        return "PENDING"
