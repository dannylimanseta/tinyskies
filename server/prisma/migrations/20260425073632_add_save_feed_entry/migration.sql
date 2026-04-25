-- CreateTable
CREATE TABLE "SaveFeedEntry" (
    "id" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "worldName" TEXT NOT NULL,
    "worldSlug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaveFeedEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaveFeedEntry_createdAt_idx" ON "SaveFeedEntry"("createdAt" DESC);
