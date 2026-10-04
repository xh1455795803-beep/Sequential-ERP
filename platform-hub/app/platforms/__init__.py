"""Platform connectors - each implements base.PlatformConnector."""
from app.platforms.index import get_connector, list_platforms
from app.platforms.base import PlatformConnector, ShopInfo, NormalizedOrder, NormalizedProduct, ConnectorError

__all__ = [
    "get_connector", "list_platforms",
    "PlatformConnector", "ShopInfo", "NormalizedOrder", "NormalizedProduct", "ConnectorError",
]
