"""Outgoing email over SMTP (Gmail SMTP in deployment). Sent from a background task so a slow
mail server never delays the request. Without SMTP settings (development), the message is
written to the log instead, so links can still be followed locally."""

import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import get_settings

log = logging.getLogger("aegis.mail")


def send_email(to: str, subject: str, text: str, html: str | None = None) -> bool:
    s = get_settings()
    if not s.mail_enabled:
        log.warning("SMTP not configured; email to %s not sent. Subject: %s\n%s", to, subject, text)
        return False
    msg = EmailMessage()
    msg["From"] = s.smtp_from or s.smtp_user
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    context = ssl.create_default_context()
    try:
        if s.smtp_port == 465:
            with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=context, timeout=20) as smtp:
                smtp.login(s.smtp_user, s.smtp_password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
                smtp.starttls(context=context)
                smtp.login(s.smtp_user, s.smtp_password)
                smtp.send_message(msg)
        return True
    except (smtplib.SMTPException, OSError) as exc:  # never fail the request over email
        log.error("sending email to %s failed: %s", to, exc)
        return False
