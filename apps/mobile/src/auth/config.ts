import { Platform } from 'react-native';
import { mobileEnvironment } from './mobile-environment';

const baseUrl = Platform.OS === 'web'
  ? `${globalThis.location.origin}/api/v1`
  : process.env.EXPO_PUBLIC_AUTH_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1');
const tenantSlug = process.env.EXPO_PUBLIC_AUTH_TENANT_SLUG ?? '';

export const authConfig = {
  baseUrl,
  tenantSlug,
  environment: mobileEnvironment({
    environment: process.env.EXPO_PUBLIC_APP_ENV,
    baseUrl,
    tenantSlug,
  }),
};
