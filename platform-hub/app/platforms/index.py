"""Platform registry - list all supported connectors."""
from typing import Dict, Type
from app.platforms.base import PlatformConnector
from app.platforms.temu import TemuConnector
from app.platforms.aliexpress import AliExpressConnector
from app.platforms.shopify import ShopifyConnector
from app.platforms.amazon_spapi import AmazonSpapiConnector

# Lazy imports for not-yet-implemented connectors
_REGISTRY: Dict[str, Type[PlatformConnector]] = {
    TemuConnector.CLASS_PLATFORM: TemuConnector,
    AliExpressConnector.CLASS_PLATFORM: AliExpressConnector,
    ShopifyConnector.CLASS_PLATFORM: ShopifyConnector,
    AmazonSpapiConnector.CLASS_PLATFORM: AmazonSpapiConnector,
}

# Try to import optional ones - they will be added as they are written
_OPTIONAL = [
    ("woocommerce", "app.platforms.woocommerce", "WooCommerceConnector"),
    ("dhgate", "app.platforms.dhgate", "DhgateConnector"),
    ("lazada", "app.platforms.lazada", "LazadaConnector"),
    ("tiktok_shop", "app.platforms.tiktok_shop", "TiktokShopConnector"),
    ("walmart", "app.platforms.walmart", "WalmartConnector"),
    ("ebay", "app.platforms.ebay", "EbayConnector"),
    ("shein", "app.platforms.shein", "SheinConnector"),
    ("ozon", "app.platforms.ozon", "OzonConnector"),
    ("wildberries", "app.platforms.wildberries", "WildberriesConnector"),
    ("coupang", "app.platforms.coupang", "CoupangConnector"),
]

for code, module_path, cls_name in _OPTIONAL:
    try:
        import importlib
        mod = importlib.import_module(module_path)
        cls = getattr(mod, cls_name)
        _REGISTRY[cls.CLASS_PLATFORM] = cls
    except Exception:
        # Not implemented yet - skip silently
        pass


def get_connector(platform: str) -> PlatformConnector:
    cls = _REGISTRY.get(platform)
    if cls is None:
        raise ValueError(f"Unsupported platform: {platform}. Available: {list(_REGISTRY.keys())}")
    return cls()


def list_platforms() -> Dict[str, dict]:
    """Return {code: {name, auth_mode, description}} for each registered connector."""
    result = {}
    for code, cls in _REGISTRY.items():
        result[code] = {
            "code": code,
            "name": cls.CLASS_NAME,
            "auth_mode": cls.AUTH_MODE,
            "description": _DESCRIPTIONS.get(code, ""),
        }
    return result


_DESCRIPTIONS: Dict[str, str] = {
    "temu": "Temu 半托管/全托管平台，Access ID + Secret（HMAC-SHA256 签名）",
    "aliexpress": "AliExpress 速卖通，OAuth + 签名",
    "shopify": "Shopify 独立站，OAuth + Admin REST API",
    "amazon_spapi": "亚马逊 Selling Partner API v0（Private Developer / 卖家自助）",
    "woocommerce": "WooCommerce 独立站插件，REST API v3 + Basic Auth",
    "dhgate": "敦煌网 DHgate，阿里系 API 网关风格",
    "lazada": "Lazada 东南亚电商，HMAC-SHA256 签名",
    "tiktok_shop": "TikTok Shop 商家中心，Bearer token 直连",
    "walmart": "Walmart 沃尔玛 Seller Center，OAuth 2.0",
    "ebay": "eBay Marketplace，OAuth + X-EBAY-API-IAF-TOKEN",
    "shein": "SHEIN 希音平台",
    "ozon": "Ozon 俄罗斯电商",
}
