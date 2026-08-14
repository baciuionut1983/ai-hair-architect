#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const STORAGE_ROOT = path.resolve(process.cwd(), ".storage", "images");
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function loadEnvironmentFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function isInsideStorageRoot(candidatePath) {
  const relative = path.relative(STORAGE_ROOT, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function inspectReference(storagePath) {
  if (typeof storagePath !== "string" || storagePath.trim() === "" || storagePath === "pending") {
    return { status: "incomplete_reference" };
  }

  const resolvedPath = path.resolve(storagePath);
  if (!isInsideStorageRoot(resolvedPath)) return { status: "outside_root" };

  let entry;
  try {
    entry = await fs.promises.lstat(resolvedPath);
  } catch (error) {
    return { status: error && error.code === "ENOENT" ? "missing" : "inaccessible" };
  }

  if (entry.isSymbolicLink()) {
    try {
      const target = await fs.promises.realpath(resolvedPath);
      return { status: isInsideStorageRoot(target) ? "symlink_inside_root" : "symlink_outside_root" };
    } catch {
      return { status: "symlink_inaccessible" };
    }
  }

  if (!entry.isFile()) return { status: "not_regular_file" };

  try {
    return {
      status: "accessible_file",
      sizeBytes: entry.size,
      sha256: await sha256File(resolvedPath),
      resolvedPath,
    };
  } catch {
    return { status: "inaccessible" };
  }
}

async function scanStorageTree() {
  const result = {
    regularFiles: [],
    symlinks: 0,
    symlinksOutsideRoot: 0,
    inaccessibleEntries: 0,
    nonRegularEntries: 0,
  };

  async function visit(directoryPath) {
    let entries;
    try {
      entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    } catch {
      result.inaccessibleEntries += 1;
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      let stats;
      try {
        stats = await fs.promises.lstat(entryPath);
      } catch {
        result.inaccessibleEntries += 1;
        continue;
      }

      if (stats.isSymbolicLink()) {
        result.symlinks += 1;
        try {
          const target = await fs.promises.realpath(entryPath);
          if (!isInsideStorageRoot(target)) result.symlinksOutsideRoot += 1;
        } catch {
          result.inaccessibleEntries += 1;
        }
        continue;
      }

      if (stats.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      if (!stats.isFile()) {
        result.nonRegularEntries += 1;
        continue;
      }

      try {
        result.regularFiles.push({
          resolvedPath: path.resolve(entryPath),
          sizeBytes: stats.size,
          sha256: await sha256File(entryPath),
        });
      } catch {
        result.inaccessibleEntries += 1;
      }
    }
  }

  if (fs.existsSync(STORAGE_ROOT)) await visit(STORAGE_ROOT);
  return result;
}

function summarizeDuplicates(items) {
  const groups = new Map();
  for (const item of items) {
    if (!item.sha256) continue;
    const group = groups.get(item.sha256) || [];
    group.push(item);
    groups.set(item.sha256, group);
  }

  const duplicates = [...groups.values()].filter((group) => group.length > 1);
  return {
    groups: duplicates.length,
    files: duplicates.reduce((sum, group) => sum + group.length, 0),
    redundantBytes: duplicates.reduce(
      (sum, group) => sum + group.slice(1).reduce((groupSum, item) => groupSum + item.sizeBytes, 0),
      0,
    ),
    groupSizes: duplicates.map((group) => group.length).sort((left, right) => right - left),
  };
}

function buildOwnerAliases(rows) {
  const ownerIds = [...new Set(rows.map((row) => row.ownerUserId))];
  ownerIds.sort((left, right) => {
    const leftHash = crypto.createHash("sha256").update(left).digest("hex");
    const rightHash = crypto.createHash("sha256").update(right).digest("hex");
    return leftHash.localeCompare(rightHash);
  });
  return new Map(ownerIds.map((ownerId, index) => [ownerId, `owner-${String(index + 1).padStart(3, "0")}`]));
}

async function main() {
  loadEnvironmentFile(path.resolve(process.cwd(), ".env"));
  loadEnvironmentFile(path.resolve(process.cwd(), ".env.development"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");

  const prisma = new PrismaClient();
  let rows;
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    rows = await prisma.imageAsset.findMany({
      select: {
        id: true,
        ownerUserId: true,
        storagePath: true,
        sizeBytes: true,
        mimeType: true,
        normalizedOrientation: true,
        exifStripped: true,
        deletedAt: true,
        retentionDeletesAt: true,
      },
      orderBy: { id: "asc" },
    });
  } finally {
    await prisma.$disconnect();
  }

  const ownerAliases = buildOwnerAliases(rows);
  const referenceResults = [];
  for (const row of rows) {
    referenceResults.push({ row, inspection: await inspectReference(row.storagePath) });
  }

  const storageTree = await scanStorageTree();
  const referencedPaths = new Set(
    referenceResults
      .filter((item) => item.inspection.status === "accessible_file")
      .map((item) => item.inspection.resolvedPath),
  );
  const orphanFiles = storageTree.regularFiles.filter((item) => !referencedPaths.has(item.resolvedPath));

  const lifecycle = {
    active: rows.filter((row) => !row.deletedAt).length,
    deleted: rows.filter((row) => Boolean(row.deletedAt)).length,
    incomplete: referenceResults.filter((item) => item.inspection.status === "incomplete_reference").length,
  };

  const referenceStatuses = {};
  for (const item of referenceResults) {
    referenceStatuses[item.inspection.status] = (referenceStatuses[item.inspection.status] || 0) + 1;
  }

  const ownerDistribution = [...ownerAliases.entries()].map(([ownerUserId, alias]) => {
    const ownerItems = referenceResults.filter((item) => item.row.ownerUserId === ownerUserId);
    return {
      owner: alias,
      assets: ownerItems.length,
      active: ownerItems.filter((item) => !item.row.deletedAt).length,
      deleted: ownerItems.filter((item) => Boolean(item.row.deletedAt)).length,
      incomplete: ownerItems.filter((item) => item.inspection.status === "incomplete_reference").length,
      metadataBytes: ownerItems.reduce((sum, item) => sum + Math.max(item.row.sizeBytes, 0), 0),
    };
  });

  const inconsistencyCounts = {
    missingFile: referenceResults.filter((item) => item.inspection.status === "missing").length,
    inaccessibleFile: referenceResults.filter((item) => item.inspection.status === "inaccessible").length,
    outsideRoot: referenceResults.filter((item) => item.inspection.status === "outside_root").length,
    symlink: referenceResults.filter((item) => item.inspection.status.startsWith("symlink_")).length,
    notRegularFile: referenceResults.filter((item) => item.inspection.status === "not_regular_file").length,
    sizeMismatch: referenceResults.filter(
      (item) => item.inspection.status === "accessible_file" && item.inspection.sizeBytes !== item.row.sizeBytes,
    ).length,
    invalidSizeBytes: rows.filter((row) => !Number.isInteger(row.sizeBytes) || row.sizeBytes <= 0).length,
    unsupportedMimeType: rows.filter((row) => !ALLOWED_MIME_TYPES.has(row.mimeType)).length,
    activeWithRetentionDeadline: rows.filter((row) => !row.deletedAt && Boolean(row.retentionDeletesAt)).length,
    deletedWithoutRetentionDeadline: rows.filter((row) => Boolean(row.deletedAt) && !row.retentionDeletesAt).length,
    invalidNormalizedOrientation: rows.filter((row) => row.normalizedOrientation !== 1).length,
    exifNotStripped: rows.filter((row) => !row.exifStripped).length,
  };

  const referencedFiles = referenceResults
    .filter((item) => item.inspection.status === "accessible_file")
    .map((item) => ({ sizeBytes: item.inspection.sizeBytes, sha256: item.inspection.sha256 }));

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "read_only",
    definitions: {
      active: "ImageAsset row with deletedAt null; may still have a file-integrity finding.",
      deleted: "ImageAsset row with deletedAt set.",
      incomplete: "ImageAsset row whose storagePath is blank or pending; overlaps lifecycle counts.",
      orphan: "Regular file under storage root not referenced by an accessible ImageAsset storagePath.",
    },
    database: {
      imageAssetRows: rows.length,
      lifecycle,
      metadataBytes: rows.reduce((sum, row) => sum + Math.max(row.sizeBytes, 0), 0),
      accessibleReferencedBytes: referencedFiles.reduce((sum, item) => sum + item.sizeBytes, 0),
      ownerDistribution,
      referenceStatuses,
      inconsistencies: inconsistencyCounts,
      duplicateContent: summarizeDuplicates(referencedFiles),
    },
    storageRoot: {
      exists: fs.existsSync(STORAGE_ROOT),
      regularFiles: storageTree.regularFiles.length,
      regularFileBytes: storageTree.regularFiles.reduce((sum, item) => sum + item.sizeBytes, 0),
      orphanFiles: orphanFiles.length,
      orphanBytes: orphanFiles.reduce((sum, item) => sum + item.sizeBytes, 0),
      symlinks: storageTree.symlinks,
      symlinksOutsideRoot: storageTree.symlinksOutsideRoot,
      inaccessibleEntries: storageTree.inaccessibleEntries,
      nonRegularEntries: storageTree.nonRegularEntries,
      duplicateContent: summarizeDuplicates(storageTree.regularFiles),
    },
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  const safeName = error && error.name ? error.name : "Error";
  console.error(`Inventory failed safely (${safeName}).`);
  process.exitCode = 1;
});
