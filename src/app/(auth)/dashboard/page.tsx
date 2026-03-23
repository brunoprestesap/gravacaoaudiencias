"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { RecoveryBanner } from "@/components/recording/RecoveryBanner";

export default function DashboardPage() {
  const { data: session } = useSession();

  if (!session) return null;

  const isServidor = session.user.role === "SERVIDOR";

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold text-text-primary">
        {isServidor ? "Painel do Servidor" : "Painel do Juiz"}
      </h1>
      <p className="mt-1 text-sm text-text-secondary">
        Bem-vindo(a), {session.user.name}
      </p>

      <div className="mt-8">
        {isServidor ? (
          <div className="flex flex-col gap-6">
            <Link href="/gravacao/nova">
              <Button size="lg" className="w-full max-w-xs">
                Nova Gravação
              </Button>
            </Link>

            <RecoveryBanner />

            <Link href="/consulta">
              <Button variant="secondary" size="lg" className="w-full max-w-xs">
                Consultar Gravações
              </Button>
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
              <h2 className="text-lg font-semibold text-text-primary">
                Buscar Gravação
              </h2>
              <p className="mt-2 text-sm text-text-muted">
                Use a tela de consulta para buscar gravações por processo.
              </p>
              <Link href="/consulta" className="mt-4 inline-block">
                <Button variant="secondary">Ir para Consulta</Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
