"""ORM models - match the tables we'll need."""
from sqlalchemy import Column, Integer, String, Text, DateTime, Float, JSON, Boolean, Index
from sqlalchemy.sql import func
from app.db import Base

class ShopPlatformCredential(Base):
    """Per-tenant, per-shop credential row. All secrets encrypted via app.crypto."""
    __tablename__ = "shop_platform_credentials"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    shop_name = Column(String(128), nullable=False, comment="seller-facing alias")
    platform = Column(String(32), nullable=False, comment="e.g. shopify, temu, amazon_spapi")
    
    # Encrypted credential blob - shape varies by platform (see each connector)
    credential = Column(JSON, nullable=False, comment="encrypted dict via crypto.encrypt()")
    
    # OAuth fields
    is_authorized = Column(Boolean, default=False)
    access_token = Column(Text, default="")      # encrypted
    refresh_token = Column(Text, default="")     # encrypted
    token_expires_at = Column(DateTime, nullable=True)
    
    # For API-key style platforms
    api_key = Column(Text, default="")          # encrypted
    api_secret = Column(Text, default="")        # encrypted
    
    # Metadata
    shop_id = Column(String(128), default="", comment="platform-side shop id")
    extra = Column(JSON, default=dict, comment="platform-specific extras like region/marketplace")
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    __table_args__ = (Index("ix_tenant_platform", "tenant_id", "platform"),)

class SyncLog(Base):
    """Append-only audit of pull/push actions."""
    __tablename__ = "sync_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    credential_id = Column(Integer, nullable=False)
    sync_type = Column(String(32), comment="pull_orders / pull_products / push_shipment / test")
    status = Column(String(16), comment="success / failed")
    result = Column(JSON, default=dict)
    error_message = Column(Text, default="")
    created_at = Column(DateTime, server_default=func.now())

class Tenant(Base):
    """Minimal tenant row - expand later."""
    __tablename__ = "tenants"
    
    id = Column(String(64), primary_key=True)
    name = Column(String(128))
    created_at = Column(DateTime, server_default=func.now())
