-- Fotos guardadas no próprio banco (STORAGE_DRIVER=database). Usado onde não há
-- armazenamento de arquivos à parte, como o ambiente de teste na Vercel + Neon.

-- CreateTable
CREATE TABLE "stored_files" (
    "key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "body" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("key")
);

ALTER TABLE stored_files
  ADD CONSTRAINT stored_files_size CHECK (size_bytes = octet_length(body) AND size_bytes <= 10485760);

ALTER TABLE stored_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stored_files FROM PUBLIC;

-- O app grava a foto e só lê a de um anexo que a pessoa enxerga: a subconsulta
-- em attachments passa pela RLS dela, que segue a visibilidade da ocorrência.
-- Login e despacho de avisos não têm acesso.
GRANT SELECT, INSERT ON stored_files TO core_app;
CREATE POLICY app_insert ON stored_files FOR INSERT TO core_app
  WITH CHECK (app.current_user_id() IS NOT NULL);
CREATE POLICY app_select ON stored_files FOR SELECT TO core_app USING (
  EXISTS (SELECT 1 FROM attachments a WHERE a.storage_key = stored_files.key AND a.deleted_at IS NULL)
);
