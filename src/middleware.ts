import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Rotas exclusivas de Servidor
    const servidorRoutes = ["/gravacao/nova", "/gravacao/"];
    const isServidorRoute = servidorRoutes.some(
      (route) => pathname.startsWith(route) && !pathname.includes("/reproduzir")
    );

    if (isServidorRoute && token?.role !== "SERVIDOR") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ["/dashboard/:path*", "/gravacao/:path*", "/consulta/:path*"],
};
