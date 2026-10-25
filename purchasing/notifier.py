"""Gửi form báo giá cho sếp qua SMTP. Chỉ được gọi khi người dùng bấm xác nhận gửi trên UI."""

import smtplib
from email.message import EmailMessage
from pathlib import Path

from . import settings_store


class MailNotConfigured(RuntimeError):
    pass


def send_quote(to_address, subject, body, attachment_path):
    host = settings_store.get("SMTP_HOST")
    user = settings_store.get("SMTP_USER")
    password = settings_store.get("SMTP_PASSWORD")
    sender = settings_store.get("SMTP_FROM") or user
    port = int(settings_store.get("SMTP_PORT", "587"))
    if not (host and user and password and sender):
        raise MailNotConfigured("Chưa cấu hình SMTP (tab Cài đặt)")

    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to_address
    msg["Subject"] = subject
    msg.set_content(body)
    data = Path(attachment_path).read_bytes()
    msg.add_attachment(
        data,
        maintype="application",
        subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=Path(attachment_path).name,
    )
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(msg)
