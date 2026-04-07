import { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { generateUniqueWorldName } from "../src/utils/worldNames.js";

const WORLD_COUNT = 20;

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log("Wiping existing worlds...");
    await prisma.world.deleteMany();

    const usedNames = new Set<string>();
    const worlds = [];

    for (let i = 0; i < WORLD_COUNT; i++) {
      const name = generateUniqueWorldName(usedNames);
      usedNames.add(name);

      worlds.push({
        slug: nanoid(10),
        name,
        texture: "earth",
        globeRadius: 5.0,
        seed: Math.floor(Math.random() * 2147483647),
        terrainType: "default",
        createdBy: "System",
      });
    }

    await prisma.world.createMany({ data: worlds });

    console.log(`Seeded ${WORLD_COUNT} worlds:`);
    for (const w of worlds) {
      console.log(`  [${w.slug}] ${w.name} (seed: ${w.seed})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
