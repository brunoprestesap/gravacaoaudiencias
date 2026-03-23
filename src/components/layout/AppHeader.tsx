"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";

const servidorLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/gravacao/nova", label: "Nova Gravação" },
  { href: "/consulta", label: "Consulta" },
] as const;

const juizLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/consulta", label: "Consulta" },
] as const;

export const AppHeader = () => {
  const pathname = usePathname();
  const { data: session } = useSession();
  const links = session?.user.role === "JUIZ" ? juizLinks : servidorLinks;

  return (
    <header className="flex h-14 items-center justify-between bg-primary px-6 text-white">
      <div className="flex items-center gap-8">
        <Link href="/dashboard" className="text-lg font-semibold">
          TRF1 — Audiências
        </Link>
        <nav className="flex gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded px-3 py-1.5 text-sm transition-colors hover:bg-white/10 ${
                pathname === link.href
                  ? "bg-white/20 font-medium"
                  : "text-white/80"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right text-sm">
          <p className="font-medium">{session?.user.name}</p>
          <p className="text-xs text-white/60">{session?.user.role}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-white/80 hover:text-white hover:bg-white/10"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          Sair
        </Button>
      </div>
    </header>
  );
};
