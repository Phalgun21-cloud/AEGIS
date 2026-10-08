"""Live exam monitoring over WebSocket (admin only).

Protocol: connect to /ws/exams/{id}/monitor, send {"token": "<JWT>"} as the first message
(tokens stay out of URLs and access logs), then receive a snapshot whenever it changes.
"""

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.api.deps import user_from_token
from app.api.exams import monitor_snapshot
from app.core.timeutil import utcnow
from app.db import SessionLocal
from app.models import Exam, Role
from app.services.lifecycle import refresh_exam

router = APIRouter()

POLL_SECONDS = 2.0
AUTH_TIMEOUT_SECONDS = 10.0


def _snapshot(exam_id: int) -> dict | None:
    with SessionLocal() as db:
        exam = db.get(Exam, exam_id)
        if exam is None:
            return None
        refresh_exam(db, exam, utcnow())
        db.commit()
        return monitor_snapshot(db, exam)


def _is_admin(token: str) -> bool:
    with SessionLocal() as db:
        user = user_from_token(db, token)
        return user is not None and user.role == Role.ADMIN


@router.websocket("/ws/exams/{exam_id}/monitor")
async def monitor_ws(websocket: WebSocket, exam_id: int) -> None:
    await websocket.accept()
    try:
        first = await asyncio.wait_for(websocket.receive_text(), AUTH_TIMEOUT_SECONDS)
        token = json.loads(first).get("token", "")
    except (TimeoutError, ValueError, AttributeError, WebSocketDisconnect):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if not await asyncio.to_thread(_is_admin, token):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    last_sent = None
    try:
        while True:
            snap = await asyncio.to_thread(_snapshot, exam_id)
            if snap is None:
                await websocket.close(code=4404)
                return
            # server_time changes every tick; compare without it.
            key = {k: v for k, v in snap.items() if k != "server_time"}
            if key != last_sent:
                await websocket.send_json(snap)
                last_sent = key
            await asyncio.sleep(POLL_SECONDS)
    except WebSocketDisconnect:
        return
