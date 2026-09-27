import * as Location from 'expo-location';

export type Position = { latitude: number; longitude: number; accuracyM: number; capturedAt: string; mock: boolean };

/**
 * Where the phone is, asked only at the moment of an action (never tracked). Null when the person
 * declines or no fix arrives in time; the server then asks for a reason instead.
 */
export async function currentPosition(timeoutMs = 15_000): Promise<Position | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!fix) return null;
    return {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracyM: Math.min(100000, Math.max(0, fix.coords.accuracy ?? 100000)),
      capturedAt: new Date(fix.timestamp || Date.now()).toISOString(),
      mock: Boolean((fix as { mocked?: boolean }).mocked),
    };
  } catch {
    return null;
  }
}
