-- CreateEnum
CREATE TYPE "TranscricaoStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'ERRO');

-- AlterTable
ALTER TABLE "Gravacao"
ADD COLUMN "transcricaoStatus" "TranscricaoStatus" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN "transcricaoTexto" TEXT,
ADD COLUMN "transcricaoErro" TEXT,
ADD COLUMN "transcricaoAtualizadoEm" TIMESTAMP(3);
