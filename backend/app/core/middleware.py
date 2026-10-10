"""Security headers and request size limits (pure ASGI, so WebSockets pass through)."""

import hmac

from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# The API only serves JSON and images, so nothing may be scripted, framed or embedded.
_API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
# Swagger UI / ReDoc load their assets from a CDN; they get no CSP (and are off in production).
_DOCS_PATHS = ("/docs", "/redoc")


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, *, hsts: bool):
        self.app = app
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_docs = scope["path"].startswith(_DOCS_PATHS)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                h = MutableHeaders(scope=message)
                h.setdefault("X-Content-Type-Options", "nosniff")
                h.setdefault("X-Frame-Options", "DENY")
                h.setdefault("Referrer-Policy", "no-referrer")
                h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
                h.setdefault("Cross-Origin-Resource-Policy", "same-origin")
                h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
                # Exam data must never sit in a shared or browser cache.
                h.setdefault("Cache-Control", "no-store")
                if not is_docs:
                    h.setdefault("Content-Security-Policy", _API_CSP)
                if self.hsts:
                    h.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
            await send(message)

        await self.app(scope, receive, send_wrapper)


class BodySizeLimitMiddleware:
    """Refuses request bodies over `max_bytes`, whether or not Content-Length is sent."""

    def __init__(self, app: ASGIApp, *, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for name, value in scope["headers"]:
            if name == b"content-length":
                try:
                    too_big = int(value) > self.max_bytes
                except ValueError:
                    too_big = True
                if too_big:
                    await _reject(send)
                    return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # Raised while the route reads its body; FastAPI turns it into a 413.
                    raise HTTPException(413, _TOO_LARGE)
            return message

        await self.app(scope, counting_receive, send)


_TOO_LARGE = "Request body too large"


async def _reject(send: Send) -> None:
    body = b'{"detail":"%s"}' % _TOO_LARGE.encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


_OPEN_PATHS = ("/health", "/health/db")


class ProxyGuardMiddleware:
    """Only accept traffic that came through the frontend proxy (which adds a shared secret),
    and take the client IP from the proxy's header, since every request reaches the API from
    the proxy. The health checks stay open (platform health checks, landing-page status)."""

    def __init__(self, app: ASGIApp, *, secret: str):
        self.app = app
        self.secret = secret.encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self.secret or scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "http" and scope["path"] in _OPEN_PATHS:
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        given = headers.get("x-aegis-proxy-secret", "").encode()
        if not hmac.compare_digest(given, self.secret):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            body = b'{"detail":"Direct access to the API is not allowed"}'
            await send(
                {
                    "type": "http.response.start",
                    "status": 403,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        ip = headers.get("x-aegis-client-ip", "").strip()
        if ip:
            scope = dict(scope, client=(ip, 0))
        await self.app(scope, receive, send)
