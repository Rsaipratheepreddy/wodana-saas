import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import type { PendingCapture } from "./capture-queue";
const storageKey = (key: string) => `wodana.hrms.pending:${key}`;
export async function readPending(key: string): Promise<PendingCapture | null> {
  const raw = await AsyncStorage.getItem(storageKey(key));
  if (!raw) return null;
  const row = JSON.parse(raw) as PendingCapture;
  if (row.key !== key || !row.input?.actionId)
    throw new Error("The saved attendance capture could not be read.");
  return row;
}
export async function savePending(
  row: PendingCapture,
): Promise<PendingCapture> {
  let photoUri = row.photoUri;
  if (photoUri && Platform.OS !== "web") {
    const folder = new Directory(Paths.document, "attendance-pending");
    folder.create({ idempotent: true });
    const destination = new File(folder, `${row.input.captureId}.jpg`);
    const source = new File(photoUri);
    if (source.size > 6 * 1024 * 1024)
      throw new Error(
        "The photo exceeds 6 MB. Retake the photo at a lower resolution.",
      );
    if (!destination.exists) source.copy(destination);
    photoUri = destination.uri;
  }
  const saved = { ...row, photoUri };
  await AsyncStorage.setItem(storageKey(row.key), JSON.stringify(saved));
  return saved;
}
export async function clearPending(row: PendingCapture) {
  await AsyncStorage.removeItem(storageKey(row.key));
  if (row.photoUri && Platform.OS !== "web") {
    try {
      const file = new File(row.photoUri);
      if (file.exists) file.delete();
    } catch {
      /* The server receipt is already confirmed; local cache cleanup must not replay it. */
    }
  }
}
export async function photoForm(row: PendingCapture) {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(row.photoUri!)).blob();
    form.append("photo", blob, "attendance.jpg");
  } else
    form.append("photo", {
      uri: row.photoUri,
      type: "image/jpeg",
      name: "attendance.jpg",
    } as unknown as Blob);
  return form;
}
