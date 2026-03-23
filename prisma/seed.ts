import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("senha123", 10);

  const servidor1 = await prisma.user.upsert({
    where: { username: "servidor1" },
    update: { vara: "3ª Vara Federal" },
    create: {
      username: "servidor1",
      password: passwordHash,
      name: "Maria Silva",
      role: "SERVIDOR",
      vara: "3ª Vara Federal",
    },
  });

  const servidor2 = await prisma.user.upsert({
    where: { username: "servidor2" },
    update: { vara: "3ª Vara Federal" },
    create: {
      username: "servidor2",
      password: passwordHash,
      name: "João Santos",
      role: "SERVIDOR",
      vara: "3ª Vara Federal",
    },
  });

  const juiz1 = await prisma.user.upsert({
    where: { username: "juiz1" },
    update: { vara: "3ª Vara Federal" },
    create: {
      username: "juiz1",
      password: passwordHash,
      name: "Dr. Carlos Oliveira",
      role: "JUIZ",
      vara: "3ª Vara Federal",
    },
  });

  console.log("Seed concluído:", { servidor1, servidor2, juiz1 });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
