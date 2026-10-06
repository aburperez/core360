/** Formatos aceitos, identificados pelos bytes do arquivo (não pela extensão). */
const SIGNATURES: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  {
    mime: "image/webp",
    ext: "webp",
    test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  },
  {
    mime: "image/heic",
    ext: "heic",
    test: (b) => ascii(b, 4, 8) === "ftyp" && ["heic", "heix", "mif1", "msf1", "hevc"].includes(ascii(b, 8, 12)),
  },
];

function ascii(b: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...b.slice(start, end));
}

export function sniffImage(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes.length < 12) return null;
  const hit = SIGNATURES.find((s) => s.test(bytes));
  return hit ? { mime: hit.mime, ext: hit.ext } : null;
}
