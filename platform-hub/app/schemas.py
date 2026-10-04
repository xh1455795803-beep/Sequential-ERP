"""Pydantic request/response schemas."""
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime

class CredentialCreate(BaseModel):
    tenant_id: str = "default"
    shop_name: str
    platform: str
    credential: Dict[str, Any] = Field(default_factory=dict, description="platform-specific raw creds (e.g. shop_domain, app_key)")
    shop_id: Optional[str] = None
    extra: Dict[str, Any] = Field(default_factory=dict)

class CredentialUpdate(BaseModel):
    shop_name: Optional[str] = None
    credential: Optional[Dict[str, Any]] = None
    is_authorized: Optional[bool] = None
    extra: Optional[Dict[str, Any]] = None

class CredentialOut(BaseModel):
    id: int
    tenant_id: str
    shop_name: str
    platform: str
    shop_id: str = ""
    is_authorized: bool = False
    token_expires_at: Optional[datetime] = None
    extra: Dict[str, Any] = Field(default_factory=dict)
    
    class Config:
        from_attributes = True

class TestConnectionResponse(BaseModel):
    ok: bool
    message: str
    platform_response: Optional[Dict[str, Any]] = None

class SyncResult(BaseModel):
    platform: str
    orders_imported: int = 0
    orders_skipped: int = 0
    products_created: int = 0
    products_updated: int = 0
    products_total: int = 0
    errors: List[str] = Field(default_factory=list)

class PlatformInfo(BaseModel):
    code: str
    name: str
    auth_mode: str = "apikey"   # apikey | oauth
    description: str = ""
    credential_fields: Dict[str, str] = Field(default_factory=dict, description="field_name → human label")

class OAuthInitiateResponse(BaseModel):
    authorization_url: str
    state: str
    platform: str
