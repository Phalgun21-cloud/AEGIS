"""Moving question and paper content in and out of the vault."""

import base64
from datetime import datetime

from app.models import Exam, Question, VaultItem
from app.services import vault


class PaperNotReleased(Exception):
    """Raised on any attempt to open a paper before its scheduled release time."""


def _question_aad(question_id: int) -> str:
    return f"aegis:question:{question_id}"


def _paper_aad(exam_id: int) -> str:
    return f"aegis:paper:{exam_id}"


def seal_question(q: Question) -> VaultItem:
    """Encrypt an approved question's content into a VaultItem and clear the plaintext."""
    payload = {
        "stem": q.stem,
        "options": q.options,
        "correct_option": q.correct_option,
        "explanation": q.explanation,
        "image": (
            {"mime": q.image_mime, "data": base64.b64encode(q.image).decode()} if q.image else None
        ),
    }
    blob = vault.seal(payload, _question_aad(q.id))
    item = VaultItem(
        question_id=q.id,
        ciphertext=blob.ciphertext,
        nonce=blob.nonce,
        wrapped_key=blob.wrapped_key,
        content_sha256=blob.sha256,
    )
    q.stem = q.options = q.correct_option = q.explanation = None
    q.image = q.image_mime = None
    return item


def open_question(item: VaultItem) -> dict:
    return vault.unseal(
        item.ciphertext, item.nonce, item.wrapped_key, _question_aad(item.question_id)
    )


def seal_paper(exam: Exam, paper: dict) -> None:
    blob = vault.seal(paper, _paper_aad(exam.id))
    exam.paper_ciphertext = blob.ciphertext
    exam.paper_nonce = blob.nonce
    exam.paper_wrapped_key = blob.wrapped_key
    exam.paper_sha256 = blob.sha256


def open_paper(exam: Exam, now: datetime) -> dict:
    """Decrypt the sealed paper. Refuses before `start_at`, whatever the caller's role."""
    if exam.paper_ciphertext is None:
        raise PaperNotReleased("no paper has been generated")
    if now < exam.start_at:
        raise PaperNotReleased("paper is sealed until its scheduled release")
    return vault.unseal(
        exam.paper_ciphertext, exam.paper_nonce, exam.paper_wrapped_key, _paper_aad(exam.id)
    )


def candidate_view(paper: dict) -> list[dict]:
    """Paper questions with answers and explanations removed."""
    return [
        {
            "question_id": q["question_id"],
            "number": i + 1,
            "marks": q["marks"],
            "stem": q["stem"],
            "options": q["options"],
            "image": q["image"],
        }
        for i, q in enumerate(paper["questions"])
    ]
