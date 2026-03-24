import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { RecoveryBanner } from "@/components/recording/RecoveryBanner";
import { Video, Search, Clock, FileText, ChevronRight, Activity } from "lucide-react";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) return null;

  const isServidor = session.user.role === "SERVIDOR";
  const userDisplayName = session.user.name ?? "usuário(a)";
  const primaryCtaClassName =
    "inline-flex items-center justify-center gap-2 rounded-[4px] bg-primary px-6 py-3 text-base font-medium text-white transition-all hover:bg-primary/90 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2";

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-primary/10 via-bg-card to-bg-page p-8 rounded-2xl border border-border shadow-sm">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-text-primary">
            {isServidor ? "Painel do Servidor" : "Painel do Juiz"}
          </h1>
          <p className="mt-2 text-text-secondary text-lg">
            Bem-vindo(a) de volta,{" "}
            <span className="font-semibold text-text-primary">{userDisplayName}</span>
          </p>
        </div>
        {isServidor ? (
          <Link href="/gravacao/nova" className={primaryCtaClassName}>
              <Video className="w-5 h-5" />
              Nova Gravação
          </Link>
        ) : null}
      </div>

      {isServidor ? <RecoveryBanner /> : null}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Actions Column */}
        <div className="md:col-span-2 space-y-6">
          <h2 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Ações Rápidas
          </h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {isServidor ? (
              <>
                <Link href="/gravacao/nova" className="group block">
                  <div className="h-full p-6 rounded-xl border border-border bg-bg-card hover:border-primary/50 hover:shadow-md transition-all duration-200 flex flex-col items-start gap-4">
                    <div className="p-3 bg-primary/10 rounded-lg text-primary group-hover:scale-110 transition-transform">
                      <Video className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-text-primary text-lg group-hover:text-primary transition-colors">Iniciar Audiência</h3>
                      <p className="text-sm text-text-secondary mt-1">Configure e inicie uma nova gravação de audiência.</p>
                    </div>
                  </div>
                </Link>

                <Link href="/consulta" className="group block">
                  <div className="h-full p-6 rounded-xl border border-border bg-bg-card hover:border-secondary/50 hover:shadow-md transition-all duration-200 flex flex-col items-start gap-4">
                    <div className="p-3 bg-secondary/10 rounded-lg text-secondary group-hover:scale-110 transition-transform">
                      <Search className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-text-primary text-lg group-hover:text-secondary transition-colors">Consultar Acervo</h3>
                      <p className="text-sm text-text-secondary mt-1">Busque e gerencie gravações anteriores no sistema.</p>
                    </div>
                  </div>
                </Link>
              </>
            ) : (
              <Link href="/consulta" className="group block sm:col-span-2">
                <div className="h-full p-6 rounded-xl border border-border bg-bg-card hover:border-primary/50 hover:shadow-md transition-all duration-200 flex flex-col sm:flex-row items-start sm:items-center gap-6">
                  <div className="p-4 bg-primary/10 rounded-2xl text-primary group-hover:scale-105 transition-transform">
                    <Search className="w-8 h-8" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-text-primary text-xl group-hover:text-primary transition-colors">Buscar Gravações</h3>
                    <p className="text-text-secondary mt-2">Acesse o acervo de audiências gravadas buscando pelo número do processo ou data.</p>
                  </div>
                  <div className="hidden sm:flex p-2 rounded-full bg-bg-page group-hover:bg-primary/10 transition-colors">
                    <ChevronRight className="w-6 h-6 text-text-muted group-hover:text-primary" />
                  </div>
                </div>
              </Link>
            )}
          </div>
        </div>

        {/* Info/Stats Column */}
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Clock className="w-5 h-5 text-text-secondary" />
            Resumo
          </h2>
          
          <div className="rounded-xl border border-border bg-bg-card overflow-hidden shadow-sm">
            <div className="p-5 border-b border-border bg-bg-page/50">
              <h3 className="font-medium text-text-primary flex items-center gap-2">
                <FileText className="w-4 h-4 text-text-muted" />
                Status do Sistema
              </h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-secondary">Armazenamento</span>
                <span className="text-sm font-medium text-success">Normal</span>
              </div>
              <div className="w-full bg-bg-page rounded-full h-2">
                <div className="bg-success h-2 rounded-full w-[45%]"></div>
              </div>
              
              <div className="pt-4 border-t border-border flex justify-between items-center">
                <span className="text-sm text-text-secondary">Sincronização</span>
                <span className="text-sm font-medium text-text-primary flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
                  Online
                </span>
              </div>
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
}
