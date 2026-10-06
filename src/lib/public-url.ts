/**
 * Endereço público do app (links dos avisos e do login). Na Vercel, sem
 * APP_URL definido, usa o domínio de produção que a própria Vercel informa.
 */
export function publicUrl(): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const url = process.env.APP_URL || process.env.BETTER_AUTH_URL || (vercel ? `https://${vercel}` : "http://localhost:3000");
  return url.replace(/\/$/, "");
}
