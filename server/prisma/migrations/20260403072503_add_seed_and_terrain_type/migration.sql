-- AlterTable
ALTER TABLE "World" ADD COLUMN     "seed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "terrainType" TEXT NOT NULL DEFAULT 'default';
