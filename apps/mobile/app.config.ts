import type { ExpoConfig } from 'expo/config';

/**
 * One generic app. A white-label build sets its name, identifiers and artwork through the environment
 * (EXPO_PUBLIC_APP_NAME, EXPO_PUBLIC_APP_ICON, …); nothing here knows about a particular tenant.
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
const bundleId = env('EXPO_PUBLIC_BUNDLE_ID', 'ai.wodana.mobile');
const scheme = env('EXPO_PUBLIC_APP_SCHEME', 'wodana');
const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';
// Push tokens are issued for the EAS project: a uat or production build without one could never be told
// about work (site alerts, approvals, work given to someone), so it isn't built.
if ((appEnvironment === 'uat' || appEnvironment === 'production') && !process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim()) {
  throw new Error(`Set EXPO_PUBLIC_EAS_PROJECT_ID (expo.dev → the project's Overview) for the ${appEnvironment} build: push notifications need it.`);
}

const config: ExpoConfig = {
  name,
  slug: env('EXPO_PUBLIC_APP_SLUG', 'wodana'),
  owner: env('EXPO_PUBLIC_EXPO_OWNER', 'wodanas-team'),
  scheme,
  version: '0.2.0',
  runtimeVersion: { policy: 'appVersion' },
  updates: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ? {
    url: `https://u.expo.dev/${process.env.EXPO_PUBLIC_EAS_PROJECT_ID}`,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  } : { enabled: false },
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon,
  ios: {
    bundleIdentifier: bundleId,
    supportsTablet: true,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: bundleId,
    adaptiveIcon: { foregroundImage: adaptiveIcon, backgroundColor: splashBackground },
  },
  web: { bundler: 'metro', output: 'single', favicon: icon, name },
  experiments: { typedRoutes: true },
  extra: {
    appEnvironment,
    ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID ? { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } } : {}),
  },
  plugins: [
    'expo-router',
    'expo-updates',
    'expo-font',
    'expo-asset',
    'expo-image',
    'expo-system-ui',
    'expo-secure-store',
    'expo-sharing',
    ['expo-notifications', { color: accent, defaultChannel: 'work' }],
    ['expo-image-picker', { photosPermission: 'Choose photos to attach to your work.', cameraPermission: 'Take photos of your site work and attendance.', microphonePermission: false }],
    ['expo-camera', { cameraPermission: 'Take photos of your site work and attendance.', microphonePermission: false, recordAudioAndroid: false, barcodeScannerEnabled: false }],
    ['expo-location', { locationWhenInUsePermission: 'Confirm where you are when you record attendance or a crew day.' }],
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
  ],
};

export default config;
