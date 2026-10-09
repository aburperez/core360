import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PrismaClient } from "../../generated/prisma/client";

/**
 * Armazenamento de fotos. Bucket privado: nada é público; quem vê uma foto
 * recebe um link assinado que expira (gerado só depois da checagem de acesso).
 * Produção: Cloudflare R2. Dev: MinIO (docker-compose). Testes: memória.
 * Ambiente de teste (Vercel + Neon): no próprio banco, sem conta extra.
 */
export interface Storage {
  put(key: string, body: Uint8Array, contentType: string, db?: Db): Promise<void>;
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  get?(key: string, db?: Db): Promise<Uint8Array | undefined>;
  /** Lê o arquivo pelo servidor (histórico do evento), onde as telas usam o link assinado. */
  fetch?(key: string): Promise<Uint8Array | undefined>;
  /** Apaga os arquivos (encerramento do evento). No banco, quem apaga é a própria função do banco. */
  remove?(keys: string[]): Promise<void>;
  /** Grava e lê pela conexão da pessoa (db), dentro da transação dela, com RLS. */
  inDatabase?: boolean;
}

/** Transação da pessoa (actor.run). */
export type Db = Pick<PrismaClient, "$executeRaw" | "$queryRaw">;

export const SIGNED_URL_TTL_SECONDS = 300;

export function s3Storage(cfg: {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Storage {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region ?? "auto",
    forcePathStyle: !!cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    signedUrl(key, expiresIn = SIGNED_URL_TTL_SECONDS) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn });
    },
    async fetch(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key })).catch((e: { name?: string }) => {
        if (e.name === "NoSuchKey") return null;
        throw e;
      });
      return res?.Body ? await res.Body.transformToByteArray() : undefined;
    },
    async remove(keys) {
      // Até 1000 por pedido (limite do S3).
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        await client.send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
      }
    },
  };
}

/** Para testes e desenvolvimento sem MinIO. */
export function memoryStorage(): Storage & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async signedUrl(key) {
      return `memory://${key}?expires=${Date.now() + SIGNED_URL_TTL_SECONDS * 1000}`;
    },
    async get(key) {
      return objects.get(key)?.body;
    },
    async remove(keys) {
      for (const k of keys) objects.delete(k);
    },
  };
}

/** Fotos numa tabela do banco (stored_files). A RLS só deixa ler a foto de um anexo visível. */
export function databaseStorage(): Storage {
  const need = (db?: Db) => {
    if (!db) throw new Error("Armazenamento no banco precisa da transação da pessoa");
    return db;
  };
  return {
    inDatabase: true,
    async put(key, body, contentType, db) {
      await need(db).$executeRaw`
        INSERT INTO stored_files (key, content_type, size_bytes, body)
        VALUES (${key}, ${contentType}, ${body.length}, ${Buffer.from(body)})`;
    },
    async signedUrl() {
      throw new Error("Fotos no banco são entregues pela própria rota do app");
    },
    async get(key, db) {
      const rows = await need(db).$queryRaw<{ body: Uint8Array }[]>`SELECT body FROM stored_files WHERE key = ${key}`;
      return rows[0]?.body;
    },
  };
}

const cache = globalThis as unknown as { storage?: Storage };

export function getStorage(): Storage {
  if (cache.storage) return cache.storage;
  const driver = process.env.STORAGE_DRIVER ?? "s3";
  if (driver === "memory") {
    cache.storage = memoryStorage();
  } else if (driver === "database") {
    cache.storage = databaseStorage();
  } else {
    const need = (n: string) => {
      const v = process.env[n];
      if (!v) throw new Error(`${n} não definida`);
      return v;
    };
    cache.storage = s3Storage({
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || undefined,
      bucket: need("S3_BUCKET"),
      accessKeyId: need("S3_ACCESS_KEY_ID"),
      secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
    });
  }
  return cache.storage;
}

export function setStorageForTests(s: Storage) {
  cache.storage = s;
}
