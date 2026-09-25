import type { ExpoConfig } from 'expo/config';

const palmLiving = process.env.EXPO_PUBLIC_MOBILE_SINGLE_TENANT === 'true'
  && process.env.EXPO_PUBLIC_AUTH_TENANT_SLUG === 'palm-living';
const launchMark = palmLiving ? './assets/brand/palm-living-monogram.png' : './assets/brand/wodana-logo-v4.png';
const launchBackground = palmLiving ? '#fffff5' : '#ffffff';

const config: ExpoConfig = {
  name: palmLiving ? 'Palm Living' : 'Wodana',
  slug: 'wodana-mobile',
  scheme: 'wodana',
  version: '0.1.0',
  runtimeVersion: { policy: 'appVersion' },
  updates: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ? {
    url: `https://u.expo.dev/${process.env.EXPO_PUBLIC_EAS_PROJECT_ID}`,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  } : { enabled: false },
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  icon: './assets/brand/woddy-mark-v4.png',
  ios: {
    bundleIdentifier: 'com.wodana.mobile',
    supportsTablet: true,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: 'com.wodana.mobile',
    adaptiveIcon: {
      foregroundImage: './assets/brand/woddy-mark-v4.png',
      backgroundColor: '#ffffff',
    },
  },
  web: { favicon: palmLiving ? './assets/brand/palm-living-monogram.png' : './assets/brand/woddy-mark-v4.png', name: palmLiving ? 'Palm Living' : 'Wodana' },
  extra: {
    appEnvironment: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID ? { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } } : {}),
  },
  plugins: [
    'expo-updates',
    'expo-font',
    'expo-asset',
    'expo-system-ui',
    'expo-secure-store',
    'expo-sharing',
    ['expo-notifications', { color: '#4F46E5', defaultChannel: 'wodana-work' }],
    ['expo-image-picker',{photosPermission:'Choose photos for your site survey and client brief.',cameraPermission:'Take photos for site surveys and attendance.',microphonePermission:false}],
    ['expo-camera', { cameraPermission: 'Take photos for site surveys and attendance.', microphonePermission: false, recordAudioAndroid: false, barcodeScannerEnabled: false }],
    ['expo-location', { locationWhenInUsePermission: 'Check your location when you record attendance at an office or project site.' }],
    ['expo-splash-screen', {
      backgroundColor: launchBackground,
      image: launchMark,
      imageWidth: palmLiving ? 72 : 186,
      resizeMode: 'contain',
      dark: { backgroundColor: launchBackground, image: launchMark },
      // Android 12+ masks splash images; the compact mascot fits the safe zone.
      android: {
        image: palmLiving ? launchMark : './assets/brand/woddy-mark-v4.png', imageWidth: palmLiving ? 72 : 160,
        dark: { backgroundColor: launchBackground, image: launchMark },
      },
    }],
  ],
};

export default config;
