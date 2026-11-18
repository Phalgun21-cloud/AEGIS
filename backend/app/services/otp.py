import logging
import os
import secrets
import smtplib
import ssl
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Any

from app.core.config import get_settings

log = logging.getLogger("aegis.otp")

_STORE: dict[str, dict[str, Any]] = {}

OTP_EXPIRY_MINUTES = 10
TOKEN_EXPIRY_MINUTES = 30
MAX_ATTEMPTS = 5


def _now() -> datetime:
    return datetime.now(UTC)


def send_otp_to_email(to_email: str, code: str) -> bool:
    subject = f"Your AEGIS Email Verification Code: {code}"
    text = (
        f"Your AEGIS verification code is: {code}\n\n"
        f"Enter this code in the portal to verify your email address.\n"
        f"This code will expire in {OTP_EXPIRY_MINUTES} minutes.\n\n"
        "AEGIS - Integrity in Every Examination"
    )
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #06b6d4; border-radius: 8px;">
      <h2 style="color: #0891b2; margin-top: 0;">AEGIS Email Verification</h2>
      <p>Enter the following security code in the portal to verify your email address:</p>
      <div style="background: #f0fdfa; border: 1px dashed #06b6d4; border-radius: 6px; padding: 16px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #0e7490;">
        {code}
      </div>
      <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
        This code is valid for {OTP_EXPIRY_MINUTES} minutes. If you did not request this code, please disregard this email.
      </p>
    </div>
    """
    print(f"\n[AEGIS OTP DISPATCH] Email: {to_email} | Code: {code}\n", flush=True)
    log.info("[OTP DISPATCH] Email: %s | Code: %s", to_email, code)

    smtp_host = os.environ.get("SMTP_HOST", "")
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_password = os.environ.get("SMTP_PASSWORD", "")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_from = os.environ.get("SMTP_FROM", smtp_user or "noreply@aegis-exams.org")

    if not (smtp_host and smtp_user and smtp_password):
        return True

    try:
        msg = EmailMessage()
        msg["From"] = smtp_from
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.set_content(text)
        msg.add_alternative(html, subtype="html")

        context = ssl.create_default_context()
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context, timeout=15) as server:
                server.login(smtp_user, smtp_password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                server.starttls(context=context)
                server.login(smtp_user, smtp_password)
                server.send_message(msg)
        return True
    except Exception as exc:
        log.warning("Sending email to %s failed: %s", to_email, exc)
        return False


def request_otp(email: str) -> dict[str, Any]:
    clean_email = email.strip().lower()
    code = f"{secrets.randbelow(900000) + 100000:06d}"
    expires_at = _now() + timedelta(minutes=OTP_EXPIRY_MINUTES)

    _STORE[clean_email] = {
        "code": code,
        "expires_at": expires_at,
        "attempts": 0,
        "verified": False,
        "verification_token": None,
        "token_expires_at": None,
    }

    send_otp_to_email(clean_email, code)

    settings = get_settings()
    res: dict[str, Any] = {
        "ok": True,
        "message": f"Verification code sent to {clean_email}",
        "email": clean_email,
        "expires_in_minutes": OTP_EXPIRY_MINUTES,
    }
    if not settings.is_production:
        res["dev_otp"] = code

    return res


def verify_otp_code(email: str, code: str) -> dict[str, Any]:
    clean_email = email.strip().lower()
    record = _STORE.get(clean_email)

    if not record:
        return {"ok": False, "error": "No OTP was requested for this email. Please click 'Send OTP' first."}

    if _now() > record["expires_at"]:
        return {"ok": False, "error": "Verification code has expired. Please request a new code."}

    if record["attempts"] >= MAX_ATTEMPTS:
        return {"ok": False, "error": "Too many failed attempts. Please request a new code."}

    record["attempts"] += 1

    if record["code"] != code.strip():
        remaining = MAX_ATTEMPTS - record["attempts"]
        return {"ok": False, "error": f"Invalid code. {remaining} attempt(s) remaining."}

    token = secrets.token_urlsafe(32)
    record["verified"] = True
    record["verification_token"] = token
    record["token_expires_at"] = _now() + timedelta(minutes=TOKEN_EXPIRY_MINUTES)

    return {
        "ok": True,
        "message": "Email verified successfully.",
        "verification_token": token,
    }


def validate_verification_token(email: str, token: str | None) -> bool:
    clean_email = email.strip().lower()
    record = _STORE.get(clean_email)
    if not record:
        return False
    if not record.get("verified"):
        return False
    if not token or record.get("verification_token") != token:
        return False
    return not bool(record.get("token_expires_at") and _now() > record["token_expires_at"])
