import { describe, expect, it } from "vitest";
import {
  assertGravacaoAccess,
  canReadGravacao,
  canServidorWriteGravacao,
} from "./gravacao-access";

describe("gravacao-access", () => {
  const servidor = { id: "u1", role: "SERVIDOR" as const, vara: "1a Vara" };
  const juiz = { id: "j1", role: "JUIZ" as const, vara: "1a Vara" };
  const gravacaoOwn = { userId: "u1", vara: "1a Vara" };
  const gravacaoOther = { userId: "u2", vara: "1a Vara" };

  it("canReadGravacao: servidor só lê a própria gravação", () => {
    expect(canReadGravacao(servidor, gravacaoOwn)).toBe(true);
    expect(canReadGravacao(servidor, gravacaoOther)).toBe(false);
  });

  it("canReadGravacao: juiz lê gravações da mesma vara", () => {
    expect(canReadGravacao(juiz, gravacaoOwn)).toBe(true);
    expect(
      canReadGravacao({ ...juiz, vara: "2a Vara" }, gravacaoOwn)
    ).toBe(false);
  });

  it("canServidorWriteGravacao exige papel e ownership", () => {
    expect(canServidorWriteGravacao(servidor, gravacaoOwn)).toBe(true);
    expect(canServidorWriteGravacao(servidor, gravacaoOther)).toBe(false);
    expect(canServidorWriteGravacao(juiz, gravacaoOwn)).toBe(false);
  });

  it("assertGravacaoAccess read retorna 404 sem gravação", async () => {
    const res = assertGravacaoAccess(servidor, null, "read");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it("assertGravacaoAccess upload bloqueia não-servidor", async () => {
    const res = assertGravacaoAccess(
      juiz,
      { userId: juiz.id, vara: "1a Vara" },
      "write",
      "upload"
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toContain("servidor");
  });
});
