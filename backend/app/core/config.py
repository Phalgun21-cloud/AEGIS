from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-insecure-jwt-secret-change-me-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AEGIS API"
    environment: str = "development"
    database_url: str = "mysql+pymysql://aegis:aegis@localhost:3306/aegis"
    cors_origins: str = "http://localhost:3000"

    jwt_secret: str = DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30

    # Vault master key (RSA private key, PEM). Either the PEM itself (production: a
    # platform secret) or a file path. In development a key file is generated if missing.
    vault_private_key: str = ""
    vault_private_key_file: str = "keys/vault_private.pem"

    # Release engine: how often the background loop advances exam lifecycles.
    scheduler_enabled: bool = True
    scheduler_interval_seconds: int = 15

    # AI generator: stems at or above this TF-IDF cosine similarity count as duplicates.
    duplicate_threshold: float = 0.85
    max_image_bytes: int = 2 * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _check_production_secrets(self) -> "Settings":
        if self.is_production:
            if self.jwt_secret == DEV_JWT_SECRET or len(self.jwt_secret) < 32:
                raise ValueError("JWT_SECRET must be set to a random value of 32+ chars")
            if not self.vault_private_key:
                raise ValueError("VAULT_PRIVATE_KEY must be set in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
