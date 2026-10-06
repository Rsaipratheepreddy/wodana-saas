import assert from 'node:assert/strict';
import test from 'node:test';
import { countryName, phoneCountryOptions } from '../src/core/phone';

// Hermes (the phone's JS engine) has no Intl.DisplayNames: names come from the bundled table in the person's language.
test('country names fall back to the bundled table when the engine has no region names', () => {
  const original = (Intl as { DisplayNames?: unknown }).DisplayNames;
  (Intl as { DisplayNames?: unknown }).DisplayNames = undefined;
  try {
    assert.equal(countryName('AE', 'en-AE'), 'United Arab Emirates');
    assert.equal(countryName('ae', 'ar'), 'الإمارات العربية المتحدة');
    assert.equal(countryName('IN', 'hi-IN'), 'भारत');
    // A language without a table reads English, never a bare code.
    assert.equal(countryName('FR', 'sw'), 'France');
    assert.ok(phoneCountryOptions('en').find((option) => option.id === 'SA')?.description === 'Saudi Arabia');
  } finally {
    (Intl as { DisplayNames?: unknown }).DisplayNames = original;
  }
});
