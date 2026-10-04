"""PlatformConnector - unified interface every platform must implement.

Inspired by the Node.js base.js in deploy/backend/src/platforms/base.js
Every module in this package exports a Connector class subclassing this.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass


@dataclass
class ShopInfo:
    """Normalized shop row - what we extract from the DB credential row."""
    id: int
    tenant_id: str
    shop_name: str
    platform: str
    # decrypted credential blob
    credential: Dict[str, Any]
    # oauth fields (decrypted or None)
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    shop_id: str = ""
    extra: Dict[str, Any] = None


@dataclass
class NormalizedOrder:
    """One platform order mapped into a thalvior-compatible shape."""
    order_no: str           # prefixed, e.g. TEMU12345
    platform_order_id: str  # raw platform id
    status: str             # PENDING | SHIPPED | DELIVERED | CANCELLED
    total_amount: float
    buyer_name: str = ""
    country: str = ""
    created_at_ts: Optional[int] = None  # unix seconds


@dataclass
class NormalizedProduct:
    sku: str                    # prefixed, e.g. AMZ-12345
    platform_sku: str           # raw platform sku
    name: str
    price: float
    platform_product_id: str = ""


class PlatformConnector(ABC):
    """Abstract base for every platform.

    Subclasses must set CLASS_PLATFORM and CLASS_NAME at the top level.
    All methods can raise ConnectorError to signal platform-side failures.
    """
    CLASS_PLATFORM: str = ""   # e.g. "shopify" "temu"
    CLASS_NAME: str = ""       # human label like "Shopify"
    AUTH_MODE: str = "apikey"  # "apikey" | "oauth"

    # ── must implement ───────────────────────────────────────────
    @abstractmethod
    def validate_credentials(self, shop: ShopInfo) -> Tuple[bool, str, Optional[Dict]]:
        """Test connection using the shop credential.

        Returns (ok, message, raw_payload).
        """

    @abstractmethod
    def fetch_orders(self, shop: ShopInfo, since_ts: int, limit: int = 100) -> List[NormalizedOrder]:
        """Pull orders created after since_ts (unix seconds)."""

    @abstractmethod
    def fetch_products(self, shop: ShopInfo, limit: int = 100) -> List[NormalizedProduct]:
        """Pull currently-listed products."""

    # ── optional overrides ──────────────────────────────────────
    def refresh_token(self, shop: ShopInfo) -> Optional[Tuple[str, int]]:
        """Return (new_access_token, expires_in_seconds) or None if not applicable."""
        return None

    def push_shipment(self, shop: ShopInfo, platform_order_id: str, tracking_number: str, carrier: str) -> bool:
        """Push a shipping notification back to the platform. Default no-op."""
        raise NotImplementedError(f"{self.CLASS_NAME} does not support push_shipment yet")

    def push_product(self, shop: ShopInfo, product: NormalizedProduct) -> Optional[str]:
        """Create/update product on platform. Return platform product id."""
        raise NotImplementedError(f"{self.CLASS_NAME} does not support push_product yet")

    # ── default mapping helpers ─────────────────────────────────
    @staticmethod
    def _status_from(s: str) -> str:
        """Liberal default mapper - subclasses override for precision."""
        if not s:
            return "PENDING"
        v = str(s).lower()
        if "cancel" in v or "void" in v or "refund" in v:
            return "CANCELLED"
        if "deliver" in v or "complete" in v or "finish" in v:
            return "DELIVERED"
        if "ship" in v or "dispatch" in v:
            return "SHIPPED"
        if "pay" in v or "wait" in v or "process" in v or "new" in v:
            return "PENDING"
        return "PENDING"


class ConnectorError(Exception):
    """Raised by any connector on platform-side failure.

    status_code = HTTP-equivalent (401 invalid creds, 403 permission, 500 platform down).
    payload     = raw platform response for debugging.
    """
    def __init__(self, message: str, status_code: int = 500, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload
