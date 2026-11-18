"""Verify a Google Identity Services ID token (Sign in with Google).

Checks Google's signature against its published keys, the audience (our client ID), the
issuer, the expiry, and that Google has verified the email. Returns the email in lower case.
"""

from functools import lru_cache

import jwt

GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")


class GoogleTokenError(Exception):
    pass


@lru_cache
def _jwks() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(GOOGLE_CERTS, cache_keys=True, lifespan=3600)


def verify_google_id_token(credential: str, client_id: str) -> str:
    try:
        key = _jwks().get_signing_key_from_jwt(credential).key
        claims = jwt.decode(credential, key, algorithms=["RS256"], audience=client_id)
    except jwt.PyJWTError as exc:
        raise GoogleTokenError(f"invalid Google token: {exc}") from exc
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise GoogleTokenError("token was not issued by Google")
    if not claims.get("email") or claims.get("email_verified") is not True:
        raise GoogleTokenError("Google has not verified this email address")
    return str(claims["email"]).strip().lower()
