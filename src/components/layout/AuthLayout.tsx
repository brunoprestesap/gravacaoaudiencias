"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { ToastContainer } from "@/components/ui/Toast";

interface AuthLayoutProps {
  children: ReactNode;
}

export const AuthLayout = ({ children }: AuthLayoutProps) => {
  return (
    <SessionProvider>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex-1">{children}</main>
      </div>
      <ToastContainer />
    </SessionProvider>
  );
};
