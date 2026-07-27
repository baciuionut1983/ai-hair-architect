-- CreateEnum
CREATE TYPE "ImageAssetStorageState" AS ENUM ('pending_upload', 'available', 'delete_pending', 'deleted', 'quarantined');

-- AlterTable
ALTER TABLE "ImageAsset"
ADD COLUMN "storageBackend" VARCHAR(16),
ADD COLUMN "storageBucketAlias" VARCHAR(64),
ADD COLUMN "storageKey" VARCHAR(512),
ADD COLUMN "storageVersionId" VARCHAR(1024),
ADD COLUMN "storageEtag" VARCHAR(256),
ADD COLUMN "contentSha256" CHAR(64),
ADD COLUMN "storageState" "ImageAssetStorageState",
ADD COLUMN "storageMigratedAt" TIMESTAMP(6),
ADD COLUMN "objectDeletedAt" TIMESTAMP(6),
ADD COLUMN "lastStorageErrorCode" VARCHAR(80);

-- CreateIndex
CREATE UNIQUE INDEX "ImageAsset_storageBucketAlias_storageKey_key" ON "ImageAsset"("storageBucketAlias", "storageKey");

-- CreateIndex
CREATE INDEX "ImageAsset_ownerUserId_storageState_id_idx" ON "ImageAsset"("ownerUserId", "storageState", "id");

-- CreateIndex
CREATE INDEX "ImageAsset_storageState_retentionDeletesAt_id_idx" ON "ImageAsset"("storageState", "retentionDeletesAt", "id");