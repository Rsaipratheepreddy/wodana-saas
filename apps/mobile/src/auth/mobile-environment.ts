export type MobileEnvironment = 'development' | 'uat' | 'production';

export function mobileEnvironment(input: {
  environment?: string;
  baseUrl: string;
  tenantSlug: string;
}) {
  const environment = input.environment || 'development';
  if (!['development', 'uat', 'production'].includes(environment))
    throw new Error('EXPO_PUBLIC_APP_ENV must be development, uat, or production.');
  let url: URL;
  try { url = new URL(input.baseUrl); }
  catch { throw new Error('The mobile API URL is invalid.'); }
  const local = ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(url.hostname);
  if (environment !== 'development' && (url.protocol !== 'https:' || local))
    throw new Error(`${environment.toUpperCase()} builds require a reachable HTTPS API.`);
  if (environment === 'production' && !input.tenantSlug)
    throw new Error('Production builds must be locked to one tenant.');
  return environment as MobileEnvironment;
}
