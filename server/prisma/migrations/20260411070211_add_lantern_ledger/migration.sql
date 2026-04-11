-- CreateTable
CREATE TABLE "LanternLedger" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "worldSlug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LanternLedger_pkey" PRIMARY KEY ("id")
);
