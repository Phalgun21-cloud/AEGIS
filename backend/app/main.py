import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import audit, auth, candidate, exams, health, monitor, questions
from app.core.config import get_settings
from app.services.lifecycle import run_scheduler

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop = asyncio.Event()
    task = asyncio.create_task(run_scheduler(stop)) if settings.scheduler_enabled else None
    yield
    stop.set()
    if task is not None:
        await task


app = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (health, auth, questions, exams, candidate, audit, monitor):
    app.include_router(module.router)
