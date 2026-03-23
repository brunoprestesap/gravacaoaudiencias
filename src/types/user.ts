import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      name: string;
      role: "SERVIDOR" | "JUIZ";
      vara?: string | null;
    };
  }

  interface User {
    id: string;
    username: string;
    name: string;
    role: "SERVIDOR" | "JUIZ";
    vara?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    role: "SERVIDOR" | "JUIZ";
    vara?: string | null;
  }
}
