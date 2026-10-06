"use client";

/**
 * Reduz a foto no próprio celular antes de enviar (≈ 1600 px, JPEG 0,7):
 * uma foto de 4 MB vira ~300 KB e sobe rápido mesmo com sinal ruim.
 */
export async function compressPhoto(file: File, maxSide = 1600, quality = 0.7): Promise<{ blob: Blob; width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (blob) return { blob, width, height };
  } catch {
    // Formato que o navegador não decodifica (ex.: HEIC em alguns Android): envia o original.
  }
  return { blob: file, width: 0, height: 0 };
}

export async function uploadPhoto(occurrenceId: string, file: File, kind: "EVIDENCIA" | "CONCLUSAO" = "EVIDENCIA") {
  const { blob, width, height } = await compressPhoto(file);
  const form = new FormData();
  form.set("file", blob, "foto.jpg");
  form.set("kind", kind);
  if (width) form.set("width", String(width));
  if (height) form.set("height", String(height));
  const { api } = await import("./api-client");
  return api(`/api/occurrences/${occurrenceId}/attachments`, { body: form });
}
