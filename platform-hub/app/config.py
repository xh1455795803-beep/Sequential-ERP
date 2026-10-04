"""Global config - loaded from env vars with safe defaults for local dev."""
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # App
    APP_NAME: str = "Platform Hub"
    APP_ENV: str = "dev"
    APP_PORT: int = 8787
    
    # DB (SQLite for local; switch to PostgreSQL in prod)
    DATABASE_URL: str = "sqlite:///./platform_hub.db"
    
    # Encryption - set a real key in prod! 32 bytes base64
    ENCRYPTION_KEY: str = "dev-not-real-key-please-change-me-32b-key!!"
    
    # OAuth
    OAUTH_REDIRECT_BASE: str = "http://localhost:8787"
    
    # Scheduler
    SYNC_INTERVAL_MINUTES: int = 60  # how often to auto-pull orders/products
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
