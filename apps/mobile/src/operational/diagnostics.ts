import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { authConfig } from '../auth/config';
import { mergeDiagnostics, type DeviceDiagnostic } from './diagnostics-model';

const key = 'wodana.mobile.diagnostics.v1';

export async function recordDeviceDiagnostic(input: Pick<DeviceDiagnostic, 'code' | 'durationMs'>) {
  try {
    const raw = await AsyncStorage.getItem(key);
    const rows = raw ? JSON.parse(raw) as DeviceDiagnostic[] : [];
    const next = mergeDiagnostics(Array.isArray(rows) ? rows : [], {
      at: new Date().toISOString(),
      environment: authConfig.environment,
      version: Constants.expoConfig?.version ?? 'unknown',
      ...input,
    });
    await AsyncStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Diagnostics must never replace the user-facing recovery path.
  }
}
