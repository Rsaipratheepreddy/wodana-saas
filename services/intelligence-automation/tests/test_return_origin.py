from wodana_intelligence.config import get_settings
from wodana_intelligence.integrations.return_origin import web_base


def test_sign_in_returns_to_the_firms_own_wodana_address(monkeypatch):
    monkeypatch.setattr(get_settings(), "web_origin", "https://admin.wodana.ai")
    assert web_base("https://plm.wodana.ai") == "https://plm.wodana.ai"
    assert web_base("https://wodana.ai") == "https://wodana.ai"
    assert web_base("") == "https://admin.wodana.ai"
    # Never an outside address, plain http, or a path smuggled in.
    assert web_base("https://evil.example") == "https://admin.wodana.ai"
    assert web_base("https://wodana.ai.evil.example") == "https://admin.wodana.ai"
    assert web_base("http://plm.wodana.ai") == "https://admin.wodana.ai"
    assert web_base("https://plm.wodana.ai/steal") == "https://admin.wodana.ai"
