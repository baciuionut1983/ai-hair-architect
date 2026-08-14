#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const sharp = require("sharp");

const WEB_ROOT = path.resolve(process.cwd());
const REPOSITORY_ROOT = path.resolve(WEB_ROOT, "..");
const STORAGE_ROOT = path.resolve(WEB_ROOT, ".storage", "images");
const ENV_CANDIDATES = [".env", ".env.development"];
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".storage",
  "node_modules",
  "test-results",
  "tmp-command-logs",
  "coverage",
]);
const SAMPLE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif", ".txt",
]);

function loadDatabaseConfiguration() {
  for (const relativePath of ENV_CANDIDATES) {
    const filePath = path.resolve(WEB_ROOT, relativePath);
    if (!fs.existsSync(filePath)) continue;

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (!match) continue;

      let value = match[1].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!value) continue;

      process.env.DATABASE_URL = process.env.DATABASE_URL || value;
      return { source: `web/${relativePath}`, value: process.env.DATABASE_URL };
    }
  }

  if (process.env.DATABASE_URL) {
    return { source: "process environment", value: process.env.DATABASE_URL };
  }
  throw new Error("DATABASE_URL is not configured.");
}

function classifyHost(hostname) {
  const normalized = hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(normalized)) return "local";
  if (
    normalized === "host.docker.internal" ||
    normalized === "postgres" ||
    normalized === "db" ||
    normalized.endsWith(".docker.internal") ||
    (!normalized.includes(".") && !normalized.match(/^\d+\.\d+\.\d+\.\d+$/))
  ) {
    return "container";
  }
  return "remote";
}

function normalizeSchemaName(url, currentSchema) {
  return url.searchParams.get("schema") || url.searchParams.get("search_path") || currentSchema || "public";
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function detectMagicType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { type: "image/jpeg", validImage: true };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: "image/png", validImage: true };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { type: "image/webp", validImage: true };
  }
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
    return { type: "image/gif", validImage: true };
  }
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM") {
    return { type: "image/bmp", validImage: true };
  }
  if (
    buffer.length >= 4 &&
    (buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
      buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])))
  ) {
    return { type: "image/tiff", validImage: true };
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (["avif", "avis"].includes(brand)) return { type: "image/avif", validImage: true };
  }
  return { type: "non-image/unknown", validImage: false };
}

function sizeBucket(sizeBytes) {
  if (sizeBytes === 0) return "0 B";
  if (sizeBytes < 1024) return "1-1023 B";
  if (sizeBytes < 10 * 1024) return "1-9 KiB";
  if (sizeBytes < 100 * 1024) return "10-99 KiB";
  if (sizeBytes < 1024 * 1024) return "100-1023 KiB";
  if (sizeBytes < 8 * 1024 * 1024) return "1-7 MiB";
  return "8 MiB or larger";
}

function increment(record, key, amount = 1) {
  record[key] = (record[key] || 0) + amount;
}

async function collectRegularFiles(rootPath, options = {}) {
  const files = [];
  async function visit(directoryPath) {
    let entries;
    try {
      entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && options.excludeDirectories?.has(entry.name)) continue;

      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  if (fs.existsSync(rootPath)) await visit(rootPath);
  return files;
}

async function classifyStorageFiles(repositorySampleHashes, normalizedRepositorySampleHashes) {
  const filePaths = await collectRegularFiles(STORAGE_ROOT);
  const files = [];

  for (const filePath of filePaths) {
    const stats = await fs.promises.stat(filePath);
    const buffer = await fs.promises.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase() || "[none]";
    const detected = detectMagicType(buffer);
    const sha256 = sha256Buffer(buffer);
    const relativeSegments = path.relative(STORAGE_ROOT, filePath).split(path.sep);
    const directorySegments = relativeSegments.slice(0, -1);
    files.push({
      extension,
      sizeBytes: stats.size,
      sizeBucket: sizeBucket(stats.size),
      mimeType: detected.type,
      validImage: detected.validImage,
      modifiedDay: stats.mtime.toISOString().slice(0, 10),
      modifiedMonth: stats.mtime.toISOString().slice(0, 7),
      sha256,
      repositoryMatch: repositorySampleHashes.has(sha256),
      normalizedRepositoryMatch: normalizedRepositorySampleHashes.has(sha256),
      pathDepth: relativeSegments.length,
      uuidDirectorySegments: directorySegments.filter((segment) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment),
      ).length,
    });
  }

  const extensions = {};
  const sizeBuckets = {};
  const magicTypes = {};
  const modifiedDays = {};
  const modifiedMonths = {};
  for (const file of files) {
    increment(extensions, file.extension);
    increment(sizeBuckets, file.sizeBucket);
    increment(magicTypes, file.mimeType);
    increment(modifiedDays, file.modifiedDay);
    increment(modifiedMonths, file.modifiedMonth);
  }

  const duplicateMap = new Map();
  for (const file of files) {
    const group = duplicateMap.get(file.sha256) || [];
    group.push(file);
    duplicateMap.set(file.sha256, group);
  }
  const duplicateGroups = [...duplicateMap.values()]
    .filter((group) => group.length > 1)
    .sort((left, right) => right.length - left.length)
    .map((group, index) => ({
      group: `duplicate-group-${index + 1}`,
      files: group.length,
      bytesPerFile: group[0].sizeBytes,
      totalBytes: group.reduce((sum, file) => sum + file.sizeBytes, 0),
      extensionDistribution: group.reduce((result, file) => {
        increment(result, file.extension);
        return result;
      }, {}),
      magicTypeDistribution: group.reduce((result, file) => {
        increment(result, file.mimeType);
        return result;
      }, {}),
      repositorySampleMatches: group.filter((file) => file.repositoryMatch).length,
      normalizedRepositorySampleMatches: group.filter((file) => file.normalizedRepositoryMatch).length,
    }));

  return {
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    extensions,
    sizeBuckets,
    magicTypes,
    modifiedDays,
    modifiedMonths,
    validImages: files.filter((file) => file.validImage).length,
    invalidOrNonImage: files.filter((file) => !file.validImage).length,
    extensionMagicMismatch: files.filter((file) => {
      const expected = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".avif": "image/avif",
      }[file.extension];
      return Boolean(expected) && expected !== file.mimeType;
    }).length,
    repositorySampleMatches: files.filter((file) => file.repositoryMatch).length,
    repositorySampleUniqueHashesMatched: new Set(
      files.filter((file) => file.repositoryMatch).map((file) => file.sha256),
    ).size,
    normalizedRepositorySampleMatches: files.filter((file) => file.normalizedRepositoryMatch).length,
    layout: {
      pathDepth: files.reduce((result, file) => {
        increment(result, String(file.pathDepth));
        return result;
      }, {}),
      uuidDirectorySegments: files.reduce((result, file) => {
        increment(result, String(file.uuidDirectorySegments));
        return result;
      }, {}),
      filesInCanonicalTwoUuidLayout: files.filter((file) =>
        file.pathDepth === 3 && file.uuidDirectorySegments === 2,
      ).length,
    },
    duplicateGroups,
    uniqueContentHashes: duplicateMap.size,
  };
}

async function collectRepositorySampleHashes() {
  const filePaths = await collectRegularFiles(REPOSITORY_ROOT, { excludeDirectories: EXCLUDED_DIRECTORIES });
  const hashes = new Set();
  const normalizedHashes = new Set();
  let candidateFiles = 0;

  for (const filePath of filePaths) {
    if (!SAMPLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;
    let stats;
    try {
      stats = await fs.promises.stat(filePath);
    } catch {
      continue;
    }
    if (stats.size > 8 * 1024 * 1024) continue;
    try {
      const buffer = await fs.promises.readFile(filePath);
      hashes.add(sha256Buffer(buffer));
      if (detectMagicType(buffer).validImage) {
        try {
          const firstPass = await sharp(buffer).withMetadata({ density: 72 }).toBuffer();
          const secondPass = await sharp(firstPass).withMetadata({ density: 72 }).toBuffer();
          normalizedHashes.add(sha256Buffer(secondPass));
        } catch {
          // A raw fixture can be valid by magic bytes but still unsupported by the normalizer.
        }
      }
      candidateFiles += 1;
    } catch {
      // Unreadable repository samples are ignored without exposing their paths.
    }
  }

  return {
    hashes,
    normalizedHashes,
    candidateFiles,
    uniqueHashes: hashes.size,
    uniqueNormalizedHashes: normalizedHashes.size,
  };
}

async function findConfiguredStorageRoots() {
  const sourceRoots = [path.resolve(WEB_ROOT, "src")];
  const findings = new Map();
  const patterns = [
    { label: ".storage/images", pattern: /["']\.storage["']\s*,\s*["']images["']/ },
    { label: "public/uploads", pattern: /["']public["']\s*,\s*["']uploads["']/ },
  ];

  for (const rootPath of sourceRoots) {
    const filePaths = await collectRegularFiles(rootPath, { excludeDirectories: EXCLUDED_DIRECTORIES });
    for (const filePath of filePaths) {
      if (!/[.](?:js|cjs|mjs|ts|tsx)$/.test(filePath)) continue;
      let content;
      try {
        content = await fs.promises.readFile(filePath, "utf8");
      } catch {
        continue;
      }
      for (const item of patterns) {
        if (item.pattern.test(content)) {
          const entry = findings.get(item.label) || { logicalRoot: item.label, sourceReferences: 0 };
          entry.sourceReferences += 1;
          findings.set(item.label, entry);
        }
      }
    }
  }

  return [...findings.values()].sort((left, right) => left.logicalRoot.localeCompare(right.logicalRoot));
}

function inferProvenance(classification) {
  const largestGroup = classification.duplicateGroups[0]?.files || 0;
  const largestShare = classification.totalFiles === 0 ? 0 : largestGroup / classification.totalFiles;
  const repositoryMatchShare = classification.totalFiles === 0
    ? 0
    : classification.repositorySampleMatches / classification.totalFiles;
  const modifiedDayCount = Object.keys(classification.modifiedDays).length;
  const normalizedMatchShare = classification.totalFiles === 0
    ? 0
    : classification.normalizedRepositorySampleMatches / classification.totalFiles;
  const canonicalLayoutShare = classification.totalFiles === 0
    ? 0
    : classification.layout.filesInCanonicalTwoUuidLayout / classification.totalFiles;

  if (normalizedMatchShare >= 0.8 && largestShare >= 0.8 && canonicalLayoutShare >= 0.8) {
    return {
      conclusion: "tests_or_fixtures_high_confidence",
      rationale: [
        "At least 80% of storage files are byte-identical to normalized repository samples.",
        "At least 80% of storage files belong to one duplicate-content group.",
        "At least 80% use the application's two-UUID storage layout.",
        "The pattern is characteristic of repeated deterministic test uploads.",
      ],
    };
  }
  if (largestShare >= 0.8 && modifiedDayCount <= 3) {
    return {
      conclusion: "repeated_application_runs_probable",
      rationale: [
        "At least 80% of files are byte-identical.",
        "Modification timestamps are concentrated in no more than three days.",
        "Repository sample matching is insufficient to prove fixture origin.",
      ],
    };
  }
  if (repositoryMatchShare > 0) {
    return {
      conclusion: "mixed_with_repository_fixtures",
      rationale: ["Some files match repository samples, but the complete storage set has mixed provenance."],
    };
  }
  return {
    conclusion: "undetermined",
    rationale: ["Hash, timestamp, and duplicate evidence is insufficient to attribute a source safely."],
  };
}

async function main() {
  const databaseConfiguration = loadDatabaseConfiguration();
  const databaseUrl = new URL(databaseConfiguration.value);
  const prisma = new PrismaClient();

  let database;
  try {
    const current = await prisma.$queryRawUnsafe(
      "SELECT current_database() AS database_name, current_schema() AS schema_name",
    );
    const [clients, consultations, analyses, appointments, notifications, imageAssets] = await Promise.all([
      prisma.client.count(),
      prisma.consultation.count(),
      prisma.analysis.count(),
      prisma.appointment.count(),
      prisma.notification.count(),
      prisma.imageAsset.count(),
    ]);
    database = {
      configurationSource: databaseConfiguration.source,
      logicalName: String(current[0]?.database_name || databaseUrl.pathname.replace(/^\//, "")),
      hostType: classifyHost(databaseUrl.hostname),
      schema: normalizeSchemaName(databaseUrl, String(current[0]?.schema_name || "public")),
      rowCounts: { clients, consultations, analyses, appointments, notifications, imageAssets },
    };
  } finally {
    await prisma.$disconnect();
  }

  const repositorySamples = await collectRepositorySampleHashes();
  const storage = await classifyStorageFiles(repositorySamples.hashes, repositorySamples.normalizedHashes);
  const configuredStorageRoots = await findConfiguredStorageRoots();
  const provenance = inferProvenance(storage);

  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: "read_only",
    database,
    storage,
    repositoryComparison: {
      candidateSampleFilesHashed: repositorySamples.candidateFiles,
      uniqueSampleHashes: repositorySamples.uniqueHashes,
      uniqueNormalizedSampleHashes: repositorySamples.uniqueNormalizedHashes,
      matchingStorageFiles: storage.repositorySampleMatches,
      matchingUniqueSampleHashes: storage.repositorySampleUniqueHashesMatched,
      matchingNormalizedStorageFiles: storage.normalizedRepositorySampleMatches,
    },
    configuredStorageRoots,
    provenance,
  }, null, 2)}\n`);
}

main().catch((error) => {
  const safeName = error && error.name ? error.name : "Error";
  console.error(`Baseline classification failed safely (${safeName}).`);
  process.exitCode = 1;
});
