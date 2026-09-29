/** The longest side a site photo keeps, and its JPEG quality: sharp on a phone screen, a fraction of the upload. */
const LONG_EDGE = 2048;
const QUALITY = 0.82;

/**
 * Compresses a photo on the device before it's uploaded (a phone's camera photo is often 4–12 MB). A photo the
 * browser can't read (HEIC outside Safari) or one already small is sent as it is.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size < 400_000 || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
