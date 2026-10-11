from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-insecure-jwt-secret-change-me-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        # Values pasted into a hosting dashboard often carry a trailing newline.
        str_strip_whitespace=True,
        # A bad setting must never print the other (secret) settings in the error.
        hide_input_in_errors=True,
    )

    app_name: str = "AEGIS API"
    environment: str = "development"
    database_url: str = "mysql+pymysql://aegis:aegis@localhost:3306/aegis"
    cors_origins: str = "http://localhost:3000"
    # Connections held open / allowed on top under load. Request handlers run on a pool of
    # 40 threads, so 20 + 20 lets every one of them hold a connection at once.
    # Managed MySQL over TLS: the provider's CA certificate (PEM text). Empty = no TLS.
    database_ssl_ca: str = ""
    db_pool_size: int = 20
    db_max_overflow: int = 20

    jwt_secret: str = DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    # Idle timeout: the browser session cookie is renewed while it's in use.
    access_token_minutes: int = 30

    # Login throttling (per client IP, and per IP + account for failures).
    login_attempts_per_ip_per_minute: int = 60
    login_failures_per_account: int = 5
    login_failure_window_minutes: int = 15

    # Shared with the frontend proxy (AEGIS_PROXY_SECRET there). When set, every request
    # except /health must carry it, and the client IP the proxy reports is trusted.
    proxy_secret: str = ""

    # Requests larger than this are refused before they're read (images are capped lower).
    max_request_bytes: int = 5 * 1024 * 1024
    # Interactive API docs at /docs. Defaults to on, except in production.
    api_docs_enabled: bool | None = None

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

    # Optional blockchain audit anchoring (Phase 4). Testnet or local chain only.
    anchor_enabled: bool = False
    anchor_rpc_url: str = ""  # e.g. http://127.0.0.1:8545 (Hardhat) or a Sepolia RPC URL
    anchor_contract_address: str = ""
    anchor_private_key: str = ""  # key of the account that deployed/owns the contract
    anchor_chain_id: int = 0  # 0 = ask the node
    # Anchor at most this often, and only when critical events happened since the last anchor.
    anchor_min_interval_seconds: int = 60

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def docs_enabled(self) -> bool:
        return (not self.is_production) if self.api_docs_enabled is None else self.api_docs_enabled

    @property
    def secure_cookies(self) -> bool:
        return self.is_production

    @property
    def session_cookie(self) -> str:
        # The __Host- prefix makes browsers insist on Secure, Path=/ and no Domain.
        return "__Host-aegis_session" if self.secure_cookies else "aegis_session"

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
            if len(self.proxy_secret) < 32:
                raise ValueError("PROXY_SECRET must be set to a random value of 32+ chars")
            bad = [o for o in self.cors_origin_list if o == "*" or not o.startswith("https://")]
            if bad or not self.cors_origin_list:
                raise ValueError("CORS_ORIGINS must list only https:// origins in production")
        if self.anchor_enabled and not (
            self.anchor_rpc_url and self.anchor_contract_address and self.anchor_private_key
        ):
            raise ValueError(
                "ANCHOR_ENABLED needs ANCHOR_RPC_URL, ANCHOR_CONTRACT_ADDRESS and ANCHOR_PRIVATE_KEY"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
