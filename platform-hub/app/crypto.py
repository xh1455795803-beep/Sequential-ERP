"""AES-256-GCM encrypt/decrypt for credential storage.

Never log these values. All platform keys/tokens flow through encrypt()
before hitting the DB and decrypt() when loaded.
"""
import os, base64, hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.config import settings

def _master_key() -> bytes:
    """Derive a 32-byte key from the configured ENCRYPTION_KEY."""
    return hashlib.sha256(settings.ENCRYPTION_KEY.encode()).digest()

def encrypt(plaintext: str) -> str:
    """Return base64( nonce + ciphertext+tag )."""
    if plaintext is None:
        return ""
    key = _master_key()
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()

def decrypt(blob: str) -> str:
    if not blob:
        return ""
    key = _master_key()
    raw = base64.b64decode(blob)
    nonce, ct = raw[:12], raw[12:]
    return AESGCM(key).decrypt(nonce, ct, None).decode()

def mask(value: str, keep: int = 4) -> str:
    """For logs - show last N chars, hide rest."""
    if not value:
        return ""
    if len(value) <= keep + 2:
        return "*" * len(value)
    return "*" * (len(value) - keep) + value[-keep:]
