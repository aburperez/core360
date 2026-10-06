import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Armazenamento de fotos. Bucket privado: nada é público; quem vê uma foto
 * recebe um link assinado que expira (gerado só depois da checagem de acesso).
 * Produção: Cloudflare R2. Dev: MinIO (docker-compose). Testes: memória.
 */
export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  get?(key: string): Promise<Uint8Array | undefined>;
}

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
  };
}

const cache = globalThis as unknown as { storage?: Storage };

export function getStorage(): Storage {
  if (cache.storage) return cache.storage;
  const driver = process.env.STORAGE_DRIVER ?? "s3";
  if (driver === "memory") {
    cache.storage = memoryStorage();
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
