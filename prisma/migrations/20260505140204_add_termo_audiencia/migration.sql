-- CreateEnum
CREATE TYPE "TermoStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'ERRO');

-- AlterTable
ALTER TABLE "Gravacao" ADD COLUMN     "termoAtualizadoEm" TIMESTAMP(3),
ADD COLUMN     "termoErro" TEXT,
ADD COLUMN     "termoEstruturado" JSONB,
ADD COLUMN     "termoStatus" "TermoStatus" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN     "termoTexto" TEXT,
ADD COLUMN     "termoTipo" TEXT;
