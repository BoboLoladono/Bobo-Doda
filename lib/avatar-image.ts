/**
 * Avatar rasmlarini mijoz tomonida qayta ishlash va siqish yordamchisi.
 *
 * Upwork uslubida:
 *  - Format tekshiruvi (JPEG, PNG, WebP)
 *  - 1:1 kvadrat qilib markazdan qirqish (buzilmasdan to'g'ri ko'rinishi uchun)
 *  - 320x320 px o'lchamga keltirish (retina ekranlar uchun yetarli)
 *  - Yuqori sifatli JPEG (0.85) ga aylantirib ~20-40 KB hajmda saqlash
 */

export const MAX_AVATAR_RAW_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateAvatarFile(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type.toLowerCase())) {
    return "Faqat JPG, PNG yoki WebP formatdagi rasmlar qabul qilinadi";
  }
  if (file.size > MAX_AVATAR_RAW_BYTES) {
    return "Rasm hajmi 10 MB dan oshmasligi kerak";
  }
  return null;
}

export function processAvatarImage(file: File, targetSize = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    const error = validateAvatarFile(file);
    if (error) {
      return reject(new Error(error));
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return reject(new Error("Canvas context yaratib bo'lmadi"));
        }

        canvas.width = targetSize;
        canvas.height = targetSize;

        // Markazdan kvadrat qirqish
        const minDim = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
        if (minDim <= 0) {
          return reject(new Error("Rasm o'lchamini aniqlab bo'lmadi"));
        }

        const sx = ((img.naturalWidth || img.width) - minDim) / 2;
        const sy = ((img.naturalHeight || img.height) - minDim) / 2;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);

        // Kichik va sifatli data-URL
        const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve(compressedDataUrl);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Rasmni qayta ishlashda xatolik"));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Faylni rasm sifatida o'qib bo'lmadi"));
    };

    img.src = objectUrl;
  });
}
