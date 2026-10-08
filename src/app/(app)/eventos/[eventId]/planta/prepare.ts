"use client";

/**
 * Prepara o arquivo da planta no navegador, antes de enviar: PDF vira imagem
 * (a página escolhida) e imagem grande demais é reduzida. Assim o servidor só
 * guarda imagem, e a planta abre rápido no celular.
 */

const MAX_BYTES = 9.5 * 1024 * 1024;
/** Lado maior da imagem gerada: nítida no zoom, sem estourar a memória do celular. */
const MAX_SIDE = 4000;
const MAX_PIXELS = 16_000_000;

export async function pdfPageCount(file: File): Promise<number> {
  const { doc, close } = await openPdf(file);
  try {
    return doc.numPages;
  } finally {
    close();
  }
}

/** Devolve o arquivo pronto para enviar (sempre JPG, PNG ou WebP). */
export async function preparePlan(file: File, page = 1): Promise<Blob> {
  if (isPdf(file)) return pdfToImage(file, page);
  const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (ok && file.size <= MAX_BYTES) {
    const bmp = await createImageBitmap(file).catch(() => null);
    if (bmp && Math.max(bmp.width, bmp.height) <= 8000) {
      bmp.close();
      return file;
    }
    bmp?.close();
  }
  // Foto do iPhone (HEIC) ou imagem pesada: redesenha menor, em JPG.
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error("Não consegui abrir esta imagem. Envie a planta em PDF, JPG ou PNG.");
  });
  const { w, h } = fitSize(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return toJpeg(canvas);
}

export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

function fitSize(w: number, h: number) {
  let k = Math.min(1, MAX_SIDE / Math.max(w, h));
  if (w * h * k * k > MAX_PIXELS) k = Math.sqrt(MAX_PIXELS / (w * h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

async function openPdf(file: File) {
  // Versão "legacy": traz o que falta nos celulares e navegadores mais antigos.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise.catch(() => {
    throw new Error("Não consegui abrir este PDF. Confira se ele não tem senha.");
  });
  return { doc, close: () => void task.destroy() };
}

async function pdfToImage(file: File, pageNumber: number): Promise<Blob> {
  const { doc, close } = await openPdf(file);
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
    const base = page.getViewport({ scale: 1 });
    const { w } = fitSize(base.width * 8, base.height * 8);
    const viewport = page.getViewport({ scale: w / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    return toJpeg(canvas);
  } finally {
    close();
  }
}

async function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (!blob) break;
    if (blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("A planta ficou grande demais. Tente um arquivo mais leve.");
}

/** Lado maior da imagem que vai para o assistente: legível para ele e abaixo do limite da API. */
const ASSISTANT_SIDE = 2400;
const ASSISTANT_BYTES = 3.5 * 1024 * 1024;

/** A planta já enviada, reduzida para o assistente analisar (sempre JPG). */
export async function planForAssistant(src: string): Promise<Blob> {
  const res = await fetch(src, { credentials: "same-origin" }).catch(() => null);
  if (!res?.ok) throw new Error("Não consegui abrir a planta. Tente de novo.");
  const bmp = await createImageBitmap(await res.blob()).catch(() => {
    throw new Error("Não consegui abrir a planta. Tente de novo.");
  });
  const k = Math.min(1, ASSISTANT_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  for (const q of [0.85, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= ASSISTANT_BYTES) return blob;
  }
  throw new Error("A planta ficou grande demais para o assistente.");
}
