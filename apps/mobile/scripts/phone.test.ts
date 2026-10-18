import assert from 'node:assert/strict';
import test from 'node:test';
import { translate } from '../src/core/i18n';
import { callingCode, defaultPhoneCountry, groupNational, ltrText, phoneCountryOptions, phoneForText, phoneProblem, regionOf, splitPhone, toE164 } from '../src/core/phone';

const text = {
  tooShort: (country: string, code: string, digits: number) => `short ${country} ${code} ${digits}`,
  tooLong: (country: string, code: string, digits: number) => `long ${country} ${code} ${digits}`,
  invalid: (country: string) => `invalid ${country}`,
  notMobile: (country: string) => `not mobile ${country}`,
  chooseCountry: 'choose',
};

test('the phone step starts on the firm\'s country (its portal region), else this phone\'s region', () => {
  assert.equal(defaultPhoneCountry({ country: 'AE', locale: 'ar-AE' }, 'en-IN'), 'AE');
  assert.equal(defaultPhoneCountry({ country: null, locale: 'en-IN' }, 'en-US'), 'IN', 'no country: the region of the portal locale');
  assert.equal(defaultPhoneCountry({ country: null, locale: 'en' }, 'fr-FR'), 'FR', 'no region on the portal: the device locale');
  assert.equal(defaultPhoneCountry(null, 'en_GB'), 'GB');
  assert.equal(defaultPhoneCountry({ country: 'XX', locale: 'en' }, 'en'), '', 'nothing known: no country is assumed');
  assert.equal(regionOf('zh-Hant-TW'), 'TW');
  assert.equal(regionOf('ar-AE-u-nu-latn'), 'AE');
  assert.equal(regionOf('en'), undefined);
});

test('the number is sent as E.164, however it was typed or pasted', () => {
  assert.equal(toE164('050 123 4567', 'AE'), '+971501234567', 'the trunk 0 goes');
  assert.equal(toE164('98765 43210', 'IN'), '+919876543210');
  assert.equal(toE164('(201) 555-0123', 'US'), '+12015550123');
  assert.deepEqual(splitPhone('+971 50 123 4567', 'IN'), { country: 'AE', national: '501234567' }, 'a pasted international number picks its country');
  assert.deepEqual(splitPhone('00971501234567', 'AE'), { country: 'AE', national: '501234567' });
  assert.deepEqual(splitPhone('971501234567', 'AE'), { country: 'AE', national: '501234567' }, 'the calling code typed without +');
  assert.deepEqual(splitPhone('+12015550123', 'CA'), { country: 'CA', national: '2015550123' }, 'a shared code keeps the chosen country');
  const { country, national } = splitPhone('+919876543210', 'AE');
  assert.equal(toE164(national, country), '+919876543210', 'an invited number round-trips');
});

test('an invalid number is refused with a message the person can act on', () => {
  assert.equal(phoneProblem('50', 'AE', text, { mobile: true }), 'short United Arab Emirates +971 9');
  assert.equal(phoneProblem('50123456789012', 'AE', text, { mobile: true }), 'long United Arab Emirates +971 9');
  assert.equal(phoneProblem('42345678', 'AE', text, { mobile: true }), 'not mobile United Arab Emirates', 'a landline is not a mobile');
  assert.equal(phoneProblem('501234567', '', text, { mobile: true }), 'choose');
  assert.equal(phoneProblem('501234567', 'AE', text, { mobile: true }), null);
  assert.equal(toE164('123', 'AE'), null);
  assert.equal(toE164('501234567', ''), null);
});

test('in RTL the number and its code still read left to right', () => {
  const shown = phoneForText('+971501234567');
  assert.equal(shown, '⁦+971 50 123 4567⁩', 'isolated left to right inside a sentence');
  const sentence = translate({ 'If {phone} has access, a 6-digit code is on its way by WhatsApp.': 'إذا كان {phone} مسجلاً، فسيصلك رمز من 6 أرقام عبر واتساب.' },
    'If {phone} has access, a 6-digit code is on its way by WhatsApp.', { phone: shown });
  const isolated = sentence.slice(sentence.indexOf('⁦') + 1, sentence.indexOf('⁩'));
  assert.equal(isolated, '+971 50 123 4567', 'the Arabic sentence keeps the number whole, "+" first');
  assert.equal(isolated.replace(/\D/g, ''), '971501234567', 'digits in the order typed');
  assert.equal(groupNational('501234567', 'AE'), '50 123 4567');
  assert.equal(groupNational('501234567', 'AE').replace(/\D/g, ''), '501234567');
  const ae = phoneCountryOptions('ar-AE').find((option) => option.id === 'AE');
  assert.equal(ae?.label, ltrText('🇦🇪 +971'), 'the picker shows flag and code as one left-to-right run');
  assert.equal(callingCode('AE'), '+971');
});
