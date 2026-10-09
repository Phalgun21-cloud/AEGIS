import asyncio
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import audit, auth, candidate, exams, health, monitor, questions
from app.api.deps import CSRF_HEADER
from app.core.config import get_settings
from app.core.middleware import BodySizeLimitMiddleware, SecurityHeadersMiddleware
from app.services.lifecycle import run_scheduler

settings = get_settings()


def _warm_up() -> None:
    # Load scikit-learn in the background so an admin's first "Generate paper" doesn't wait.
    from app.services.generator import load_sklearn

    load_sklearn()


@asynccontextmanager
async def lifespan(_: FastAPI):
    threading.Thread(target=_warm_up, daemon=True).start()
    stop = asyncio.Event()
    task = asyncio.create_task(run_scheduler(stop)) if settings.scheduler_enabled else None
    yield
    stop.set()
    if task is not None:
        await task


docs = settings.docs_enabled
app = FastAPI(
    title=settings.app_name,
    version="0.3.0",
    lifespan=lifespan,
    docs_url="/docs" if docs else None,
    redoc_url="/redoc" if docs else None,
    openapi_url="/openapi.json" if docs else None,
)

# Added innermost first: security headers wrap everything, including CORS and 413 replies.
app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_bytes)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", CSRF_HEADER],
    max_age=600,
)
app.add_middleware(SecurityHeadersMiddleware, hsts=settings.is_production)

for module in (health, auth, questions, exams, candidate, audit, monitor):
    app.include_router(module.router)
