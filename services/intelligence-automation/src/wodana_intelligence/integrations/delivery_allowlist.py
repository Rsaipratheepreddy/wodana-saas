"""The delivery safety guard for local and UAT environments (DELIVERY_ALLOWLIST).

A comma list of exact email addresses, ``*@domain`` patterns and E.164 phone numbers. When it is
set, every external delivery (email, WhatsApp, push) to anyone not on the list is suppressed with
the reason ``not_allowlisted``. Unset or empty means no guard. Production refuses to start with it
set. Business Core applies the same rule before handing deliveries to the worker.
"""

import re
from dataclasses import dataclass, field

NOT_ALLOWLISTED = "not_allowlisted"

_EMAIL = re.compile(r"^[^@\s,]+@[^@\s,]+\.[^@\s,]+$")
_DOMAIN = re.compile(r"^\*@[^@\s,*]+\.[^@\s,*]+$")
_PHONE = re.compile(r"^\+[1-9]\d{6,14}$")


def _phone(value: str) -> str:
    number = re.sub(r"[\s().-]", "", value)
    return number if number.startswith("+") else f"+{number}"


@dataclass(frozen=True)
class DeliveryAllowlist:
    enabled: bool = False
    emails: frozenset[str] = field(default_factory=frozenset)
    domains: frozenset[str] = field(default_factory=frozenset)
    phones: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def parse(cls, raw: str | None) -> "DeliveryAllowlist":
        """Parses the setting; an entry of none of the three forms is refused, never ignored."""
        entries = [entry.strip() for entry in (raw or "").split(",") if entry.strip()]
        emails: set[str] = set()
        domains: set[str] = set()
        phones: set[str] = set()
        for entry in entries:
            lower = entry.lower()
            if _DOMAIN.match(lower):
                domains.add(lower[2:])
            elif _EMAIL.match(lower):
                emails.add(lower)
            elif _PHONE.match(re.sub(r"[\s()-]", "", entry)):
                phones.add(re.sub(r"[\s()-]", "", entry))
            else:
                raise ValueError(
                    f'DELIVERY_ALLOWLIST entry "{entry}" must be an email address, *@domain '
                    "or an E.164 phone number (+ and country code)"
                )
        return cls(bool(entries), frozenset(emails), frozenset(domains), frozenset(phones))

    def allows_email(self, address: str | None) -> bool:
        if not self.enabled:
            return True
        email = (address or "").strip().lower()
        if not _EMAIL.match(email):
            return False
        return email in self.emails or email.rsplit("@", 1)[1] in self.domains

    def allows_phone(self, number: str | None) -> bool:
        if not self.enabled:
            return True
        return bool(number) and _phone(number or "") in self.phones
