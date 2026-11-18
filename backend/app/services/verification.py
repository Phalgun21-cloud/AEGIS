"""Email verification: build the link and send it."""

from html import escape

from app.core.config import get_settings
from app.core.security import create_email_verification_token
from app.services.mailer import send_email


def verification_link(user_id: int, email: str) -> str:
    token = create_email_verification_token(user_id, email)
    return f"{get_settings().public_base_url}/verify-email?token={token}"


def send_verification_email(user_id: int, email: str, full_name: str) -> bool:
    link = verification_link(user_id, email)
    hours = get_settings().email_verify_hours
    text = (
        f"Hello {full_name},\n\n"
        "An AEGIS account has been created for you by your examination administrator.\n"
        "Please confirm your email address by opening this link:\n\n"
        f"{link}\n\n"
        f"The link expires in {hours} hours. If you weren't expecting this, you can ignore it.\n\n"
        "AEGIS - Integrity in Every Examination"
    )
    html = (
        f"<p>Hello {escape(full_name)},</p>"
        "<p>An AEGIS account has been created for you by your examination administrator. "
        "Please confirm your email address:</p>"
        f'<p><a href="{escape(link)}" style="display:inline-block;padding:10px 18px;'
        'background:#06b6d4;color:#020617;border-radius:8px;text-decoration:none;font-weight:600">'
        "Verify my email</a></p>"
        f"<p>The link expires in {hours} hours. If you weren't expecting this, you can ignore it.</p>"
        "<p>AEGIS - Integrity in Every Examination</p>"
    )
    return send_email(email, "Verify your AEGIS account email", text, html)
