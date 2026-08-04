-- M22 GO-2: real persistence for VideoLesson. Purely additive: no existing
-- table, column, constraint, or index is altered, dropped, or renamed. No
-- existing row's existing data is modified.
--
-- This file was generated via `prisma migrate diff` against the live test
-- database and then manually curated to remove unrelated pre-existing drift
-- picked up by that diff (WebhookEndpoint FK/index normalization, Analysis
-- updatedAt default drop, Client timestamp precision, and several
-- RenameForeignKey/RenameIndex constraint-name normalizations already
-- present in the database ahead of any migration file) -- none of that
-- drift is part of M22's scope and none of it is included below.
--
-- status defaults to 'not_generated': M22 introduces no real AI generation
-- capability, so every row this milestone's code creates stays in this
-- state. The column stays a plain VARCHAR (not a native enum) so the
-- existing "queued" | "processing" | "completed" | "failed" vocabulary in
-- application code remains valid for a future milestone that adds real
-- generation, without requiring another migration to widen an enum.

-- CreateTable
CREATE TABLE "VideoLesson" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "topic" VARCHAR(200) NOT NULL,
    "level" VARCHAR(20) NOT NULL,
    "locale" VARCHAR(5) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'not_generated',
    "recommendedLessonIds" JSONB NOT NULL DEFAULT '[]',
    "script" VARCHAR(4000),
    "videoUrl" VARCHAR(2048),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoLesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoLesson_ownerUserId_idx" ON "VideoLesson"("ownerUserId");

-- AddForeignKey
ALTER TABLE "VideoLesson" ADD CONSTRAINT "VideoLesson_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
