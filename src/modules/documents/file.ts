import { sniffImage } from "../attachments/image";

const OOXML: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const LEGACY: Record<string, string> = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
};

const starts = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);

/**
 * Documento: PDF, imagem, Word, Excel ou PowerPoint, conferido pelos bytes (o
 * nome só decide entre os formatos do Office, que têm o mesmo começo).
 */
export function sniffDocument(bytes: Uint8Array, name: string): { mime: string; ext: string; inline: boolean } | null {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf", inline: true };
  const image = sniffImage(bytes);
  if (image) return { ...image, inline: true };
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) && OOXML[ext]) return { mime: OOXML[ext], ext, inline: false };
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) && LEGACY[ext]) return { mime: LEGACY[ext], ext, inline: false };
  return null;
}

/** Tamanho máximo: 10 MB; na Vercel, que recusa pedidos acima de 4,5 MB, 4 MB. */
export function maxDocumentBytes(): number {
  return (process.env.VERCEL ? 4 : 10) * 1024 * 1024;
}
