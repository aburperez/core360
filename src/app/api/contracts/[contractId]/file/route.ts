import { authed } from "@/server/http/handler";
import { readUpload } from "@/server/http/upload-form";
import { attachContractPdf } from "@/modules/contracts/contracts.service";
import { maxDocumentBytes } from "@/modules/documents/file";
import { formatBytes } from "@/lib/documents";

/** O PDF do contrato (multipart "file"). Também entra em Documentos. */
export const POST = authed<{ contractId: string }>(async ({ req, actor, params }) => {
  const max = maxDocumentBytes();
  const { file } = await readUpload(req, max, `Arquivo maior que ${formatBytes(max)}`);
  return attachContractPdf(actor, params.contractId, file);
});
