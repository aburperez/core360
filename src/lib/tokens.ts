import { createHash, randomBytes } from "node:crypto";

/** Token aleatório para links (convite). Só o hash vai para o banco. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
