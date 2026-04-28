-- CreateTable
CREATE TABLE "GameEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "worldSlug" TEXT NOT NULL,
    "worldName" TEXT,
    "vehicle" TEXT,
    "level" INTEGER,
    "runDurationSec" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameEvent_createdAt_idx" ON "GameEvent"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "GameEvent_type_createdAt_idx" ON "GameEvent"("type", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GameEvent_worldSlug_createdAt_idx" ON "GameEvent"("worldSlug", "createdAt" DESC);
