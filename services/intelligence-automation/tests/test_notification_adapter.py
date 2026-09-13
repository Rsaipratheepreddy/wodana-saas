import pytest

from wodana_intelligence.config import Settings
from wodana_intelligence.worker.adapters import (
    DeterministicTestAdapter,
    UnconfiguredAdapter,
    notification_adapter,
)


def test_default_does_not_simulate_delivery() -> None:
    settings = Settings(_env_file=None)
    assert settings.notification_adapter_mode == "unconfigured"
    assert isinstance(notification_adapter("unconfigured", "production"), UnconfiguredAdapter)


def test_simulated_delivery_requires_explicit_nonproduction_mode() -> None:
    assert isinstance(notification_adapter("test", "development"), DeterministicTestAdapter)
    with pytest.raises(ValueError, match="forbidden"):
        notification_adapter("test", "production")
