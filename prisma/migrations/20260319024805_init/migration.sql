-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SERVIDOR', 'JUIZ');

-- CreateEnum
CREATE TYPE "ModoGravacao" AS ENUM ('PRESENCIAL', 'HIBRIDO');

-- CreateEnum
CREATE TYPE "StatusGravacao" AS ENUM ('EM_ANDAMENTO', 'PAUSADA', 'FINALIZADA', 'INTERROMPIDA');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SERVIDOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gravacao" (
    "id" TEXT NOT NULL,
    "numeroProcesso" TEXT NOT NULL,
    "classeProcessual" TEXT,
    "partes" TEXT,
    "vara" TEXT,
    "nomeJuiz" TEXT,
    "tipoAudiencia" TEXT,
    "dataAudiencia" TIMESTAMP(3),
    "modo" "ModoGravacao" NOT NULL,
    "duracao" INTEGER,
    "tamanhoArquivo" INTEGER,
    "caminhoArquivo" TEXT,
    "status" "StatusGravacao" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gravacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey
ALTER TABLE "Gravacao" ADD CONSTRAINT "Gravacao_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
