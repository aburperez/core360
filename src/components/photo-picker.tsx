"use client";

import { useEffect, useMemo, useRef } from "react";

/** Botão grande que abre a câmera traseira; também permite escolher da galeria. */
export function PhotoPicker({ files, onChange, label = "Tirar foto" }: { files: File[]; onChange: (f: File[]) => void; label?: string }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const add = (list: FileList | null) => {
    if (list?.length) onChange([...files, ...Array.from(list)].slice(0, 6));
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => camera.current?.click()} className="min-h-14 rounded-xl border-2 border-dashed border-border bg-surface font-semibold">
          📷 {label}
        </button>
        <button type="button" onClick={() => gallery.current?.click()} className="min-h-14 rounded-xl border border-border bg-surface text-sm">
          🖼 Da galeria
        </button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={gallery} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      {previews.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {previews.map((src, i) => (
            <div key={src} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Foto ${i + 1}`} className="h-20 w-20 rounded-lg object-cover" />
              <button
                type="button"
                aria-label="Remover foto"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 h-7 w-7 rounded-full bg-black/70 text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
