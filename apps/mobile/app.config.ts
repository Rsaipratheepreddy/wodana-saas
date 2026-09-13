import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Wodana',
  slug: 'wodana-mobile',
  scheme: 'wodana',
  version: '0.1.0',
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
  web: { favicon: './assets/brand/woddy-mark-v4.png', name: 'Wodana' },
  plugins: [
    'expo-font',
    'expo-asset',
    'expo-system-ui',
    'expo-secure-store',
    'expo-sharing',
    ['expo-image-picker',{photosPermission:'Choose photos for your site survey and client brief.',cameraPermission:'Take photos for site surveys and attendance.',microphonePermission:false}],
    ['expo-camera', { cameraPermission: 'Take photos for site surveys and attendance.', microphonePermission: false, recordAudioAndroid: false, barcodeScannerEnabled: false }],
    ['expo-location', { locationWhenInUsePermission: 'Check your location when you record attendance at an office or project site.' }],
    ['expo-splash-screen', {
      // The launch surface introduces the lilac used by the welcome gradient.
      backgroundColor: '#d6b9f3',
      image: './assets/brand/wodana-logo-v4.png',
      imageWidth: 186,
      resizeMode: 'contain',
      dark: { backgroundColor: '#d6b9f3', image: './assets/brand/wodana-logo-v4.png' },
      // Android 12+ masks splash images; the compact mascot fits the safe zone.
      android: {
        image: './assets/brand/woddy-mark-v4.png', imageWidth: 160,
        dark: { backgroundColor: '#d6b9f3', image: './assets/brand/woddy-mark-v4.png' },
      },
    }],
  ],
};

export default config;
