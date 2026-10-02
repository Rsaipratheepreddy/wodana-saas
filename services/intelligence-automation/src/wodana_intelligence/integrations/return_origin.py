"""Where a provider's sign-in sends the person back: the firm's own Wodana address, never another."""

from urllib.parse import urlsplit

from wodana_intelligence.config import get_settings


def default_web_base() -> str:
    return get_settings().web_origin.split(",", 1)[0].rstrip("/")


def web_base(origin: str = "") -> str:
    """The page's own origin when it is one of Wodana's (any *.wodana.ai), else the default."""
    default = default_web_base()
    allowed = {
        item.strip().rstrip("/") for item in get_settings().web_origin.split(",") if item.strip()
    }
    candidate = (origin or "").strip().rstrip("/")
    if not candidate:
        return default
    if candidate in allowed:
        return candidate
    parts = urlsplit(candidate)
    extra = parts.path or parts.query or parts.username or parts.password
    if parts.scheme != "https" or not parts.hostname or extra:
        return default
    labels = (urlsplit(default).hostname or "").split(".")
    parent = ".".join(labels[1:]) if len(labels) > 2 else ".".join(labels)
    host = parts.hostname.lower()
    if parent and (host == parent or host.endswith("." + parent)):
        return f"https://{parts.netloc.lower()}"
    return default
