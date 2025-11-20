import os
import smtplib
from email.mime.text import MIMEText


def send_email(to_addr: str, subject: str, body: str):
    host = os.getenv("SMTP_HOST", "")
    port = int(os.getenv("SMTP_PORT", "0") or "0")
    user = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASSWORD", "")
    from_addr = os.getenv("SMTP_FROM_EMAIL", user or "")
    use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
    if not host or not port or not user or not password or not from_addr:
        if os.getenv("DEV_MODE", "false").lower() == "true":
            return
        raise RuntimeError("smtp_not_configured")
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    if use_ssl:
        server = smtplib.SMTP_SSL(host, port or 465)
    else:
        server = smtplib.SMTP(host, port or 587)
        server.ehlo()
        try:
            server.starttls()
        except Exception:
            pass
    server.login(user, password)
    server.sendmail(from_addr, [to_addr], msg.as_string())
    server.quit()
