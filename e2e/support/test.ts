import { test as base, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { getPrisma, cleanupE2eData } from "../fixtures/db";
import { getMockPort } from "./maritaca-mock-port";

interface E2eFixtures {
  db: PrismaClient;
  maritacaPort: number;
}

export const test = base.extend<E2eFixtures>({
  db: async ({}, use) => {
    await use(getPrisma());
  },
  maritacaPort: async ({}, use) => {
    await use(getMockPort());
  },
});

export { expect, cleanupE2eData };
