"""FastAPI entry point + all REST routes.

Run: uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload
"""
from __future__ import annotations
import asyncio, json, time, os
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Depends, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import engine, SessionLocal, Base, get_db, init_db
from app import models, schemas, crypto
from app.platforms import get_connector, list_platforms
from app.platforms.base import ShopInfo, ConnectorError, NormalizedOrder, NormalizedProduct

app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    description="Multi-platform seller credential hub (Shopify/Temu/Amazon/速卖通...). Each seller brings their own platform dev creds.",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
def _startup():
    init_db()


# ─────────────── Health ───────────────
@app.get("/healthz")
def healthz():
    return {"ok": True, "env": settings.APP_ENV, "platforms": list(list_platforms().keys())}


# ─────────────── Platform catalog ───────────────
@app.get("/api/platforms", response_model=List[schemas.PlatformInfo])
def platforms_list():
    infos = []
    for code, info in list_platforms().items():
        infos.append(schemas.PlatformInfo(
            code=code,
            name=info["name"],
            auth_mode=info["auth_mode"],
            description=info.get("description", ""),
            credential_fields=_hint_fields(code),
        ))
    return infos


def _hint_fields(platform: str) -> Dict[str, str]:
    """Hint dict shown in frontend form so the seller knows what to paste where."""
    hints = {
        "shopify": {"shop_domain": "Shop 域名，如 xxx.myshopify.com"},
        "temu": {"access_id": "Temu 后台生成的 Access ID", "access_secret": "对应的 Access Secret / Token"},
        "aliexpress": {"app_key": "AliExpress 开放平台 AppKey", "app_secret": "AppSecret"},
        "amazon_spapi": {"client_id": "SP-API Private Developer Client ID",
                         "client_secret": "Client Secret",
                         "marketplace_id": "Marketplace 如 ATVPDKIKX0DER（美国站）",
                         "region": "NA | EU | FE"},
        "woocommerce": {"store_url": "WooCommerce 网址，如 https://yourdomain.com",
                        "consumer_key": "wp-json/wc/v3 Consumer Key",
                        "consumer_secret": "Consumer Secret"},
    }
    return hints.get(platform, {"note": "凭据字段按平台文档填入"})


# ─────────────── Credentials CRUD ───────────────
def _to_shop_info(row: models.ShopPlatformCredential) -> ShopInfo:
    return ShopInfo(
        id=row.id,
        tenant_id=row.tenant_id,
        shop_name=row.shop_name,
        platform=row.platform,
        credential=row.credential or {},
        access_token=crypto.decrypt(row.access_token) if row.access_token else None,
        refresh_token=crypto.decrypt(row.refresh_token) if row.refresh_token else None,
        api_key=crypto.decrypt(row.api_key) if row.api_key else None,
        api_secret=crypto.decrypt(row.api_secret) if row.api_secret else None,
        shop_id=row.shop_id or "",
        extra=row.extra or {},
    )


@app.get("/api/credentials", response_model=List[schemas.CredentialOut])
def credentials_list(tenant_id: str = "default", db: Session = Depends(get_db)):
    rows = db.query(models.ShopPlatformCredential)\
             .filter(models.ShopPlatformCredential.tenant_id == tenant_id)\
             .order_by(models.ShopPlatformCredential.created_at.desc())\
             .all()
    out = []
    for r in rows:
        out.append(schemas.CredentialOut(
            id=r.id,
            tenant_id=r.tenant_id,
            shop_name=r.shop_name,
            platform=r.platform,
            shop_id=r.shop_id or "",
            is_authorized=r.is_authorized or False,
            token_expires_at=r.token_expires_at,
            extra=r.extra or {},
        ))
    return out


@app.post("/api/credentials", response_model=schemas.CredentialOut, status_code=201)
def credentials_create(body: schemas.CredentialCreate, db: Session = Depends(get_db)):
    # Encrypt any api_key / api_secret the caller may have provided inside credential blob
    enc_api_key = crypto.encrypt(str(body.credential.get("api_key", ""))) if body.credential.get("api_key") else ""
    enc_api_secret = crypto.encrypt(str(body.credential.get("api_secret", ""))) if body.credential.get("api_secret") else ""
    enc_access = crypto.encrypt(str(body.credential.get("access_token", ""))) if body.credential.get("access_token") else ""
    enc_refresh = crypto.encrypt(str(body.credential.get("refresh_token", ""))) if body.credential.get("refresh_token") else ""

    credential_clean = {k: v for k, v in body.credential.items()
                        if k not in ("api_key", "api_secret", "access_token", "refresh_token")}

    row = models.ShopPlatformCredential(
        tenant_id=body.tenant_id,
        shop_name=body.shop_name,
        platform=body.platform,
        credential=credential_clean,
        api_key=enc_api_key,
        api_secret=enc_api_secret,
        access_token=enc_access,
        refresh_token=enc_refresh,
        shop_id=body.shop_id or "",
        extra=body.extra or {},
        is_authorized=bool(body.credential.get("access_token") or body.credential.get("api_key")),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return schemas.CredentialOut(
        id=row.id, tenant_id=row.tenant_id, shop_name=row.shop_name, platform=row.platform,
        shop_id=row.shop_id or "", is_authorized=row.is_authorized, token_expires_at=row.token_expires_at,
        extra=row.extra or {},
    )


@app.delete("/api/credentials/{cred_id}")
def credentials_delete(cred_id: int, db: Session = Depends(get_db)):
    row = db.query(models.ShopPlatformCredential).get(cred_id)
    if not row:
        raise HTTPException(404, "Credential not found")
    db.delete(row)
    db.commit()
    return {"ok": True, "deleted_id": cred_id}


# ─────────────── Test connection ───────────────
@app.post("/api/credentials/{cred_id}/test", response_model=schemas.TestConnectionResponse)
def credentials_test(cred_id: int, db: Session = Depends(get_db)):
    row = db.query(models.ShopPlatformCredential).get(cred_id)
    if not row:
        raise HTTPException(404, "Credential not found")
    shop = _to_shop_info(row)
    try:
        connector = get_connector(row.platform)
        ok, message, payload = connector.validate_credentials(shop)
        # persist result
        row.is_authorized = ok
        db.commit()
        return schemas.TestConnectionResponse(ok=ok, message=message,
                                               platform_response=payload if isinstance(payload, dict) else None)
    except ConnectorError as e:
        return schemas.TestConnectionResponse(ok=False, message=str(e), platform_response=e.payload if isinstance(e.payload, dict) else None)


# ─────────────── Manual sync ───────────────
def _normalize_orders(orders: List[NormalizedOrder]) -> List[dict]:
    return [dict(o.__dict__) for o in orders]


def _normalize_products(products: List[NormalizedProduct]) -> List[dict]:
    return [dict(p.__dict__) for p in products]


@app.post("/api/credentials/{cred_id}/sync", response_model=schemas.SyncResult)
def credentials_sync(cred_id: int, sync_target: str = Query("all", pattern="^(all|orders|products)$"),
                     since_hours: int = Query(24, ge=1, le=720),
                     db: Session = Depends(get_db)):
    row = db.query(models.ShopPlatformCredential).get(cred_id)
    if not row:
        raise HTTPException(404, "Credential not found")
    shop = _to_shop_info(row)
    connector = get_connector(row.platform)
    result = schemas.SyncResult(platform=row.platform)
    since_ts = int(time.time()) - since_hours * 3600

    # refresh token if needed
    try:
        refreshed = connector.refresh_token(shop)
        if refreshed:
            new_access, expires = refreshed
            row.access_token = crypto.encrypt(new_access)
            row.token_expires_at = __import__("datetime").datetime.utcfromtimestamp(
                int(time.time()) + expires)
            shop.access_token = new_access
            db.commit()
    except Exception as e:
        result.errors.append(f"token refresh: {e}")

    if sync_target in ("all", "orders"):
        try:
            orders = connector.fetch_orders(shop, since_ts=since_ts)
            result.orders_imported = len(orders)
            # optionally persist orders - for now just return them
        except ConnectorError as e:
            result.errors.append(f"orders: {e}")

    if sync_target in ("all", "products"):
        try:
            products = connector.fetch_products(shop)
            result.products_total = len(products)
            result.products_created = result.products_total  # simplified
        except ConnectorError as e:
            result.errors.append(f"products: {e}")

    # audit log
    try:
        db.add(models.SyncLog(
            credential_id=cred_id,
            sync_type="manual",
            status="success" if not result.errors else "failed",
            result=result.model_dump(),
            error_message="; ".join(result.errors) if result.errors else "",
        ))
        db.commit()
    except Exception:
        db.rollback()

    return result


# ─────────────── OAuth (Shopify) ───────────────
import hashlib, urllib.parse, urllib.request

@app.get("/api/oauth/{platform}/start")
def oauth_start(platform: str, shop_domain: Optional[str] = None, state: Optional[str] = None):
    """Generate OAuth authorization URL for platforms that need it.

    For Shopify specifically - requires the seller to set SHOPIFY_APP_KEY / SHOPIFY_APP_SECRET env vars
    (or pass them via the credential row's extra dict, which we don't know here yet).
    """
    if platform != "shopify":
        raise HTTPException(501, f"OAuth flow for {platform} not yet implemented in Platform Hub")

    app_key = os.environ.get("SHOPIFY_APP_KEY")
    app_secret = os.environ.get("SHOPIFY_APP_SECRET")
    redirect = os.environ.get("SHOPIFY_OAUTH_REDIRECT", f"{settings.OAUTH_REDIRECT_BASE}/api/oauth/shopify/callback")
    if not app_key:
        raise HTTPException(400, "SHOPIFY_APP_KEY env var not set - Platform Hub is not registered in Shopify Partners yet")

    if not shop_domain:
        raise HTTPException(400, "shop_domain query param required, e.g. ?shop_domain=xxx.myshopify.com")

    scopes = os.environ.get("SHOPIFY_SCOPES", "read_orders write_orders read_products write_products read_shop_information").split()
    state = state or hashlib.md5(str(time.time()).encode()).hexdigest()

    url = f"https://{shop_domain}/admin/oauth/authorize"
    params = {
        "client_id": app_key,
        "scope": ",".join(scopes),
        "redirect_uri": redirect,
        "state": state,
    }
    full = f"{url}?{urllib.parse.urlencode(params)}"
    return schemas.OAuthInitiateResponse(authorization_url=full, state=state, platform=platform)


@app.get("/api/oauth/shopify/callback")
def oauth_shopify_callback(shop: str, code: str, state: str | None = None):
    """Exchange auth code for permanent access token, return JSON the seller can paste."""
    app_key = os.environ.get("SHOPIFY_APP_KEY")
    app_secret = os.environ.get("SHOPIFY_APP_SECRET")
    if not app_key or not app_secret:
        raise HTTPException(400, "SHOPIFY_APP_KEY / SHOPIFY_APP_SECRET not configured")

    url = f"https://{shop}/admin/oauth/access_token"
    data = urllib.parse.urlencode({
        "client_id": app_key,
        "client_secret": app_secret,
        "code": code,
    }).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read())
    except Exception as e:
        raise HTTPException(502, f"Shopify token exchange failed: {e}")

    access_token = payload.get("access_token", "")
    return {
        "shop": shop,
        "access_token": access_token,
        "message": "把这个 access_token 和 shop_domain 一起填到 Platform Hub 的凭据创建表单里即可",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.APP_PORT, reload=True)
