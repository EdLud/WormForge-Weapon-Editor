/** Natural pixel size of an image URL (object URL, asset URL or data URL). */
export function imagePixelSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('That image could not be decoded.'));
    img.src = url;
  });
}
