-- CreateTable
CREATE TABLE "World" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "globeRadius" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "texture" TEXT NOT NULL DEFAULT 'earth',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "World_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "World_slug_key" ON "World"("slug");
