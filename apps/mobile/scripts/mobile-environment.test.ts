import assert from 'node:assert/strict';
import test from 'node:test';
import { mobileEnvironment } from '../src/auth/mobile-environment';

test('uat and production builds cannot point at loopback or insecure APIs', () => {
  assert.throws(() => mobileEnvironment({ environment: 'uat', baseUrl: 'http://127.0.0.1:8000/api/v1', tenantSlug: 'palm-living' }), /HTTPS/);
  assert.throws(() => mobileEnvironment({ environment: 'production', baseUrl: 'https://api.example.com', tenantSlug: '' }), /locked/);
  assert.equal(mobileEnvironment({ environment: 'uat', baseUrl: 'https://uat-api.example.com/api/v1', tenantSlug: 'palm-living' }), 'uat');
});

test('development permits emulator loopback and rejects unknown environment names', () => {
  assert.equal(mobileEnvironment({ environment: 'development', baseUrl: 'http://10.0.2.2:8000/api/v1', tenantSlug: '' }), 'development');
  assert.throws(() => mobileEnvironment({ environment: 'preview', baseUrl: 'https://api.example.com', tenantSlug: '' }), /development, uat, or production/);
});
