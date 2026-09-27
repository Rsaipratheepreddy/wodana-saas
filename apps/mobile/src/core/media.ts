import { Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';

/** A photo on the phone, ready to upload: JPEG, at most 2048px on its long edge. */
export type LocalPhoto = { id: string; uri: string; width: number; height: number; name: string; type: 'image/jpeg' };

export class MediaPermissionError extends Error {
  constructor(public kind: 'camera' | 'library') { super(kind); }
}

const LONG_EDGE = 2048;

/** Re-encode a picked or drawn image as a JPEG that every server accepts (HEIC included) and that fits upload limits. */
export async function preparePhoto(uri: string, width: number, height: number, longEdge = LONG_EDGE): Promise<LocalPhoto> {
  const id = Crypto.randomUUID();
  try {
    const context = ImageManipulator.manipulate(uri);
    if (Math.max(width, height) > longEdge) context.resize(width >= height ? { width: longEdge } : { height: longEdge });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
    return { id, uri: saved.uri, width: saved.width, height: saved.height, name: `photo-${id.slice(0, 8)}.jpg`, type: 'image/jpeg' };
  } catch {
    return { id, uri, width, height, name: `photo-${id.slice(0, 8)}.jpg`, type: 'image/jpeg' };
  }
}

/** Take one photo with the camera. Null when the person cancels. */
export async function takePhoto(options: { front?: boolean; longEdge?: number } = {}): Promise<LocalPhoto | null> {
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new MediaPermissionError('camera');
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'], quality: 0.9, exif: false,
    cameraType: options.front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return preparePhoto(asset.uri, asset.width, asset.height, options.longEdge);
}

/** Choose photos from the library. */
export async function choosePhotos(limit = 10): Promise<LocalPhoto[]> {
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted && permission.accessPrivileges !== 'limited') throw new MediaPermissionError('library');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], quality: 0.9, allowsMultipleSelection: limit > 1, selectionLimit: limit, exif: false, orderedSelection: true,
  });
  if (result.canceled) return [];
  return Promise.all(result.assets.slice(0, limit).map((asset) => preparePhoto(asset.uri, asset.width, asset.height)));
}

export const openSettings = () => { void Linking.openSettings().catch(() => undefined); };
