import type { ExpoConfig } from 'expo/config';

/**
 * One generic app. A white-label build sets its name, identifiers and artwork through the environment
 * (EXPO_PUBLIC_APP_NAME, EXPO_PUBLIC_APP_ICON, …); nothing here knows about a particular tenant.
 * Store release steps: RELEASE.md.
 */
const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

const name = env('EXPO_PUBLIC_APP_NAME', 'Wodana');
const icon = env('EXPO_PUBLIC_APP_ICON', './assets/brand/logo/wodana-icon.png');
// Android's adaptive foreground keeps the house inside the safe zone on a transparent layer.
const adaptiveIcon = env('EXPO_PUBLIC_ADAPTIVE_ICON', './assets/brand/logo/wodana-adaptive-icon.png');
const splashImage = env('EXPO_PUBLIC_SPLASH_IMAGE', './assets/brand/logo/wodana-logo.png');
const splashDarkImage = env('EXPO_PUBLIC_SPLASH_DARK_IMAGE', './assets/brand/logo/wodana-logo-dark.png');
const splashBackground = env('EXPO_PUBLIC_SPLASH_BACKGROUND', '#ffffff');
const splashDarkBackground = env('EXPO_PUBLIC_SPLASH_DARK_BACKGROUND', splashBackground);
const splashWidth = Number(env('EXPO_PUBLIC_SPLASH_IMAGE_WIDTH', '186'));
const androidSplashImage = env('EXPO_PUBLIC_ANDROID_SPLASH_IMAGE', adaptiveIcon);
const accent = env('EXPO_PUBLIC_APP_ACCENT', '#292d32');
// The old store app's ids (ai.wodana.mobile): this build replaces it in both stores.
const bundleId = env('EXPO_PUBLIC_BUNDLE_ID', 'ai.wodana.mobile');
const scheme = env('EXPO_PUBLIC_APP_SCHEME', 'wodana');
const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';
const release = appEnvironment === 'uat' || appEnvironment === 'production';
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() || '';
// Push tokens are issued for the EAS project: a uat or production build without one could never be told
// about work (site alerts, approvals, work given to someone), so it isn't built.
if (release && !easProjectId) {
  throw new Error(`Set EXPO_PUBLIC_EAS_PROJECT_ID (expo.dev → the project's Overview) for the ${appEnvironment} build: push notifications need it.`);
}
if (easProjectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(easProjectId)) {
  throw new Error('EXPO_PUBLIC_EAS_PROJECT_ID must be the project UUID from expo.dev: replace REPLACE_WITH_EAS_PROJECT_ID in eas.json (RELEASE.md, step 1).');
}
// A store build talks to a real HTTPS API (eas.json sets it per profile); the phone refuses anything else.
if (release) {
  let api: URL | null = null;
  try { api = new URL(process.env.EXPO_PUBLIC_AUTH_API_URL ?? ''); } catch { api = null; }
  if (!api || api.protocol !== 'https:' || ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(api.hostname)) {
    throw new Error(`Set EXPO_PUBLIC_AUTH_API_URL to the HTTPS API (for example https://plm.wodana.ai/api/v1) for the ${appEnvironment} build.`);
  }
}

// Store versions. The old Flutter app shipped 1.0.1 (build 2026090101) under the same ids, so this app starts
// above both. EAS keeps the build number (eas.json: appVersionSource remote) and raises it on every store
// build; the number here is the floor for a local build.
const version = '2.0.0';
const buildNumber = env('EXPO_PUBLIC_BUILD_NUMBER', '2026092800');
if (!/^\d{1,10}$/.test(buildNumber) || Number(buildNumber) <= 2026090101 || Number(buildNumber) > 2100000000) {
  throw new Error('EXPO_PUBLIC_BUILD_NUMBER must be a whole number above 2026090101 (the old store build) and at most 2100000000.');
}

// What the phone says before it asks; the app never asks for more than these.
const cameraPermission = `${name} uses the camera to photograph site progress, measurements, snags and deliveries, and to scan the code on a delivery to receive it.`;
const photosPermission = `${name} lets you attach photos from your library to site reports, snags and other work records.`;
const locationPermission = `${name} uses your location to confirm where you are when you check in or out and when you record a crew day.`;

const config: ExpoConfig = {
  name,
  slug: env('EXPO_PUBLIC_APP_SLUG', 'wodana'),
  owner: env('EXPO_PUBLIC_EXPO_OWNER', 'wodanas-team'),
  scheme,
  version,
  runtimeVersion: { policy: 'appVersion' },
  updates: easProjectId ? {
    url: `https://u.expo.dev/${easProjectId}`,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  } : { enabled: false },
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon,
  ios: {
    bundleIdentifier: bundleId,
    buildNumber,
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: bundleId,
    versionCode: Number(buildNumber),
    adaptiveIcon: { foregroundImage: adaptiveIcon, backgroundColor: splashBackground },
    // The same set the old store app declared, and nothing that needs a Play policy declaration.
    permissions: ['android.permission.CAMERA', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.POST_NOTIFICATIONS'],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO', 'android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO', 'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    // Android pushes travel through Firebase Cloud Messaging. google-services.json for ai.wodana.mobile is an
    // EAS file variable (GOOGLE_SERVICES_JSON), never a committed file.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
  web: { bundler: 'metro', output: 'single', favicon: icon, name },
  experiments: { typedRoutes: true },
  extra: {
    appEnvironment,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
  plugins: [
    'expo-router',
    'expo-updates',
    'expo-font',
    'expo-asset',
    'expo-image',
    'expo-system-ui',
    // The sign-in is kept in the keychain without biometrics, so the app declares no Face ID use.
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-sharing',
    // Store builds use the production APNs environment; the white house is Android's status-bar icon.
    ['expo-notifications', { color: accent, defaultChannel: 'work', icon: './assets/notification-icon.png', mode: release ? 'production' : 'development', enableBackgroundRemoteNotifications: true }],
    ['expo-image-picker', { photosPermission, cameraPermission, microphonePermission: false }],
    ['expo-camera', { cameraPermission, microphonePermission: false, recordAudioAndroid: false, barcodeScannerEnabled: true }],
    ['expo-location', { locationWhenInUsePermission: locationPermission, locationAlwaysAndWhenInUsePermission: false, locationAlwaysPermission: false, isIosBackgroundLocationEnabled: false, isAndroidBackgroundLocationEnabled: false }],
    ['@react-native-community/datetimepicker', {}],
    ['expo-splash-screen', {
      backgroundColor: splashBackground,
      image: splashImage,
      imageWidth: Number.isFinite(splashWidth) ? splashWidth : 186,
      resizeMode: 'contain',
      dark: { backgroundColor: splashDarkBackground, image: splashDarkImage },
      // Android 12+ masks the splash image; the compact mark fits its safe zone.
      android: { image: androidSplashImage, imageWidth: 160, dark: { backgroundColor: splashDarkBackground, image: androidSplashImage } },
    }],
    // A local release build signs with the upload key named in ~/.gradle/gradle.properties (RELEASE.md).
    './plugins/with-release-signing.js',
  ],
};

export default config;
