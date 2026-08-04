import { randomUUID } from "crypto";

import type {
  AcademyCategory,
  AcademyLesson,
  AnalysisGoal,
  AnalyticsSnapshot,
  BackupSnapshotRecord,
  AuthSessionResponse,
  ClientPhotoRecord,
  FormulaRecord,
  Locale,
  OpsHealthSnapshot,
  PushPreferenceRecord,
  PushQueueRecord,
  ProductRecord,
  RetentionRunResult,
  ShortlistRecord,
  SubscriptionPlan,
  SubscriptionRecord,
  SubscriptionStatus,
  SupplierRecord,
  TreatmentRecord,
  UserRole,
  WorkspaceMemberRecord,
  WorkspaceRecord
} from "./contracts";

interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  locale: Locale;
  createdAt: string;
}

interface Store {
  users: UserRecord[];
  sessions: Map<string, string>;
  photos: ClientPhotoRecord[];
  formulas: FormulaRecord[];
  treatments: TreatmentRecord[];
  academyCategories: AcademyCategory[];
  academyLessons: AcademyLesson[];
  products: ProductRecord[];
  suppliers: SupplierRecord[];
  shortlists: ShortlistRecord[];
  subscriptions: SubscriptionRecord[];
  auditEvents: AuditEventRecord[];
    workspaces: WorkspaceRecord[];
    workspaceMembers: WorkspaceMemberRecord[];
    pushPreferences: PushPreferenceRecord[];
    pushQueue: PushQueueRecord[];
    backupSnapshots: BackupSnapshotRecord[];
}

// This lock is process-local only. It prevents overlapping retention executions
// in the current Node.js process, but it is not a distributed lock.
const activeRetentionExecutionScopes = new Set<string>();
const backupSnapshotInsertionOrder = new Map<string, number>();
let backupSnapshotSequence = 0;

interface AuditEventRecord {
  id: string;
  ownerUserId: string;
  requestId: string;
  module: "billing" | "agents" | "security";
  action: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

const globalKey = "__aiHairArchitectMilestone1Store";
const globalRef = globalThis as typeof globalThis & { [globalKey]?: Store };

function createStore(): Store {
  return {
    users: [],
    sessions: new Map<string, string>(),
    photos: [],
    formulas: [],
    treatments: [],
    academyCategories: [],
    academyLessons: [],
    products: [],
    suppliers: [],
    shortlists: [],
    subscriptions: [],
    auditEvents: [],
    workspaces: [],
    workspaceMembers: [],
    pushPreferences: [],
    pushQueue: [],
    backupSnapshots: []
  };
}

export const store = globalRef[globalKey] ?? (globalRef[globalKey] = createStore());

if (!store.photos) {
  store.photos = [];
}

if (!store.formulas) {
  store.formulas = [];
}

if (!store.treatments) {
  store.treatments = [];
}

if (!store.academyCategories) {
  store.academyCategories = [];
}

if (!store.academyLessons) {
  store.academyLessons = [];
}

if (!store.products) {
  store.products = [];
}

if (!store.suppliers) {
  store.suppliers = [];
}

if (!store.shortlists) {
  store.shortlists = [];
}

if (!store.subscriptions) {
  store.subscriptions = [];
}

if (!store.auditEvents) {
  store.auditEvents = [];
}

if (!store.workspaces) {
  store.workspaces = [];
}

if (!store.workspaceMembers) {
  store.workspaceMembers = [];
}

if (!store.pushPreferences) {
  store.pushPreferences = [];
}

if (!store.pushQueue) {
  store.pushQueue = [];
}

if (!store.backupSnapshots) {
  store.backupSnapshots = [];
}

function ensureMilestone4Seeds() {
  if (store.academyCategories.length === 0) {
    store.academyCategories.push(
      { id: "cat-haircuts", key: "haircuts", name: "Haircuts", description: "Women, men, layers and precision shapes." },
      { id: "cat-color", key: "color", name: "Color", description: "Gloss, correction, gray coverage and tonal balancing." },
      { id: "cat-lightening", key: "lightening", name: "Lightening", description: "Lift levels, foils, safety and toning." },
      { id: "cat-styling", key: "styling", name: "Styling", description: "Daily styling, events, waves and updos." },
      { id: "cat-extensions", key: "extensions", name: "Extensions", description: "Clip-in, tape-in, keratin bonds and maintenance." },
      { id: "cat-treatments", key: "treatments", name: "Treatments", description: "Hydration, repair and scalp protocols." },
      { id: "cat-keratin", key: "keratin", name: "Keratin", description: "Indications, contraindications and aftercare." },
      { id: "cat-washing", key: "washing", name: "Washing", description: "Scalp types, cleansing and product matching." },
      { id: "cat-products", key: "products", name: "Products", description: "Shampoo, masks, leave-ins and thermal protection." }
    );
  }

  if (store.academyLessons.length === 0) {
    store.academyLessons.push(
      {
        id: "lesson-color-1",
        categoryId: "cat-color",
        title: "Gray Coverage Decision Matrix",
        summary: "Choose formula families by percentage of gray and hair resistance.",
        warnings: ["Patch test when sensitivity history exists", "Avoid over-processing porous sections"]
      },
      {
        id: "lesson-lightening-1",
        categoryId: "cat-lightening",
        title: "Lift Planning and Safety Stops",
        summary: "Plan lift levels by baseline and prior chemical history.",
        warnings: ["Stop at elasticity risk", "Use strand test for uncertain history"]
      },
      {
        id: "lesson-treatments-1",
        categoryId: "cat-treatments",
        title: "Repair Cycle by Porosity",
        summary: "Build a 4-week repair cadence aligned with porosity and density.",
        warnings: ["Do not combine high-protein weekly on brittle strands"]
      }
    );
  }

  if (store.products.length === 0) {
    store.products.push(
      {
        id: "prod-1",
        name: "Bond Repair Mask",
        category: "treatments",
        countryCodes: ["RO", "US"],
        cityAvailability: ["Bucharest", "Cluj", "New York"],
        goals: ["treat", "correct"],
        brand: "AHA Pro"
      },
      {
        id: "prod-2",
        name: "Cool Beige Toner",
        category: "color",
        countryCodes: ["RO", "DE"],
        cityAvailability: ["Bucharest", "Timisoara", "Berlin"],
        goals: ["refresh", "lighten"],
        brand: "Chromatic Lab"
      },
      {
        id: "prod-3",
        name: "Scalp Balance Shampoo",
        category: "products",
        countryCodes: ["RO", "US", "FR"],
        cityAvailability: ["Iasi", "Paris", "Chicago"],
        goals: ["treat", "refresh"],
        brand: "Salon Daily"
      }
    );
  }

  if (store.suppliers.length === 0) {
    store.suppliers.push(
      {
        id: "sup-1",
        name: "BeautySource Bucharest",
        countryCode: "RO",
        city: "Bucharest",
        categories: ["color", "treatments"],
        supportedGoals: ["refresh", "cover", "treat"],
        rating: 4.8
      },
      {
        id: "sup-2",
        name: "Nordic Pro Hair",
        countryCode: "DE",
        city: "Berlin",
        categories: ["lightening", "color"],
        supportedGoals: ["lighten", "correct"],
        rating: 4.6
      },
      {
        id: "sup-3",
        name: "Urban Stylist Depot",
        countryCode: "US",
        city: "New York",
        categories: ["products", "extensions", "treatments"],
        supportedGoals: ["reshape", "treat", "refresh"],
        rating: 4.7
      }
    );
  }
}

ensureMilestone4Seeds();

export function getAcademyCategories(): AcademyCategory[] {
  return [...store.academyCategories];
}

export function getAcademyLessons(categoryId?: string): AcademyLesson[] {
  return store.academyLessons.filter((entry) => !categoryId || entry.categoryId === categoryId);
}

export function getAcademyLessonById(lessonId: string): AcademyLesson | null {
  return store.academyLessons.find((entry) => entry.id === lessonId) ?? null;
}

export function findRecommendedLessonIds(topic: string): string[] {
  const keyword = topic.toLowerCase();
  const matches = store.academyLessons
    .filter((lesson) =>
      lesson.title.toLowerCase().includes(keyword) ||
      lesson.summary.toLowerCase().includes(keyword)
    )
    .slice(0, 3)
    .map((item) => item.id);

  if (matches.length > 0) {
    return matches;
  }

  return store.academyLessons.slice(0, 2).map((item) => item.id);
}

export function getProducts(filters?: {
  countryCode?: string;
  city?: string;
  goal?: AnalysisGoal;
  category?: string;
}): ProductRecord[] {
  return store.products.filter((entry) => {
    if (filters?.countryCode && !entry.countryCodes.includes(filters.countryCode.toUpperCase())) {
      return false;
    }

    if (filters?.city && !entry.cityAvailability.some((item) => item.toLowerCase() === filters.city?.toLowerCase())) {
      return false;
    }

    if (filters?.goal && !entry.goals.includes(filters.goal)) {
      return false;
    }

    if (filters?.category && entry.category !== filters.category) {
      return false;
    }

    return true;
  });
}

export function getSuppliers(filters?: {
  countryCode?: string;
  city?: string;
  category?: string;
  goal?: AnalysisGoal;
}): SupplierRecord[] {
  return store.suppliers
    .filter((entry) => {
      if (filters?.countryCode && entry.countryCode !== filters.countryCode.toUpperCase()) {
        return false;
      }

      if (filters?.city && entry.city.toLowerCase() !== filters.city.toLowerCase()) {
        return false;
      }

      if (filters?.category && !entry.categories.includes(filters.category)) {
        return false;
      }

      if (filters?.goal && !entry.supportedGoals.includes(filters.goal)) {
        return false;
      }

      return true;
    })
    .sort((left, right) => right.rating - left.rating);
}

export function getRecommendedSuppliers(input: {
  countryCode?: string;
  city?: string;
  goal?: AnalysisGoal;
  category?: string;
}) {
  const filtered = getSuppliers(input);
  return filtered.slice(0, 5);
}

export function createShortlist(input: {
  ownerUserId: string;
  clientId: string;
  title: string;
  productIds: string[];
  supplierIds: string[];
}): ShortlistRecord {
  const shortlist: ShortlistRecord = {
    id: randomUUID(),
    ownerUserId: input.ownerUserId,
    clientId: input.clientId,
    title: input.title,
    productIds: input.productIds,
    supplierIds: input.supplierIds,
    createdAt: new Date().toISOString()
  };

  store.shortlists.push(shortlist);
  return shortlist;
}

export function getSubscriptionForUser(userId: string): SubscriptionRecord {
  let subscription = store.subscriptions.find((entry) => entry.ownerUserId === userId);
  if (!subscription) {
    subscription = {
      id: randomUUID(),
      ownerUserId: userId,
      plan: "free",
      status: "inactive",
      currentPeriodEnd: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.subscriptions.push(subscription);
  }

  return subscription;
}

export function updateSubscriptionForUser(input: {
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
}): SubscriptionRecord {
  const subscription = getSubscriptionForUser(input.userId);
  subscription.plan = input.plan;
  subscription.status = input.status;
  subscription.currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  subscription.updatedAt = new Date().toISOString();
  return subscription;
}

export function createAuditEvent(input: {
  ownerUserId: string;
  requestId: string;
  module: "billing" | "agents" | "security";
  action: string;
  metadata: Record<string, unknown>;
}) {
  // Append-only guarantee at the store API boundary: public audit creation only
  // appends new records. This prototype store does not try to freeze raw in-memory
  // objects against direct mutation by internal code or tests.
  store.auditEvents.push({
    id: randomUUID(),
    ownerUserId: input.ownerUserId,
    requestId: input.requestId,
    module: input.module,
    action: input.action,
    metadata: input.metadata,
    createdAt: new Date().toISOString()
  });
}

export function getAuditEventsForUser(userId: string) {
  return store.auditEvents
    .filter((entry) => entry.ownerUserId === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function createWorkspace(ownerUserId: string, name: string): WorkspaceRecord {
  const workspace: WorkspaceRecord = {
    id: randomUUID(),
    ownerUserId,
    name,
    createdAt: new Date().toISOString()
  };
  store.workspaces.push(workspace);

  store.workspaceMembers.push({
    id: randomUUID(),
    workspaceId: workspace.id,
    userId: ownerUserId,
    role: "owner",
    createdAt: new Date().toISOString()
  });

  return workspace;
}

export function getWorkspacesForUser(userId: string): WorkspaceRecord[] {
  const workspaceIds = new Set(
    store.workspaceMembers.filter((entry) => entry.userId === userId).map((entry) => entry.workspaceId)
  );

  return store.workspaces.filter((entry) => workspaceIds.has(entry.id));
}

export function addWorkspaceMember(input: {
  workspaceId: string;
  actorUserId: string;
  userId: string;
  role: "manager" | "stylist";
}): WorkspaceMemberRecord | null {
  const actorMembership = store.workspaceMembers.find(
    (entry) => entry.workspaceId === input.workspaceId && entry.userId === input.actorUserId
  );

  if (!actorMembership || (actorMembership.role !== "owner" && actorMembership.role !== "manager")) {
    return null;
  }

  const userExists = store.users.some((entry) => entry.id === input.userId);
  if (!userExists) {
    return null;
  }

  const existing = store.workspaceMembers.find(
    (entry) => entry.workspaceId === input.workspaceId && entry.userId === input.userId
  );

  if (existing) {
    return existing;
  }

  const membership: WorkspaceMemberRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: input.role,
    createdAt: new Date().toISOString()
  };
  store.workspaceMembers.push(membership);
  return membership;
}

export function getAnalyticsSnapshotForUser(
  userId: string,
  consultationsCount: number,
  appointmentsCount: number,
  remindersSentCount: number,
  generatedVideoLessonsCount: number
): AnalyticsSnapshot {
  const activeSubscriptionCount = store.subscriptions.filter(
    (entry) => entry.ownerUserId === userId && (entry.status === "active" || entry.status === "trialing")
  ).length;

  return {
    consultationsCount,
    appointmentsCount,
    remindersSentCount,
    activeSubscriptionCount,
    generatedVideoLessonsCount
  };
}

export function upsertPushPreference(input: {
  userId: string;
  enabled: boolean;
  channels: Array<"in_app" | "email" | "push">;
}): PushPreferenceRecord {
  const existing = store.pushPreferences.find((entry) => entry.userId === input.userId);
  const next: PushPreferenceRecord = {
    userId: input.userId,
    enabled: input.enabled,
    channels: input.channels,
    updatedAt: new Date().toISOString()
  };

  if (existing) {
    existing.enabled = next.enabled;
    existing.channels = next.channels;
    existing.updatedAt = next.updatedAt;
    return existing;
  }

  store.pushPreferences.push(next);
  return next;
}

export function getPushPreference(userId: string): PushPreferenceRecord {
  const existing = store.pushPreferences.find((entry) => entry.userId === userId);
  if (existing) {
    return existing;
  }

  const preference: PushPreferenceRecord = {
    userId,
    enabled: true,
    channels: ["in_app"],
    updatedAt: new Date().toISOString()
  };
  store.pushPreferences.push(preference);
  return preference;
}

export function enqueuePushNotification(input: {
  userId: string;
  channel: "in_app" | "email" | "push";
  title: string;
  body: string;
}): PushQueueRecord {
  const item: PushQueueRecord = {
    id: randomUUID(),
    userId: input.userId,
    channel: input.channel,
    title: input.title,
    body: input.body,
    status: "queued",
    createdAt: new Date().toISOString(),
    processedAt: null
  };

  store.pushQueue.push(item);
  return item;
}

export function processPushQueueForUser(userId: string): { sent: number } {
  let sent = 0;
  for (const item of store.pushQueue) {
    if (item.userId === userId && item.status === "queued") {
      item.status = "sent";
      item.processedAt = new Date().toISOString();
      sent += 1;
    }
  }

  return { sent };
}

export function getPushQueueForUser(userId: string): PushQueueRecord[] {
  return store.pushQueue
    .filter((entry) => entry.userId === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getOpsHealthSnapshot(clientsCount: number, consultationsCount: number, appointmentsCount: number, notificationsCount: number): OpsHealthSnapshot {
  const queueBacklogCount = store.pushQueue.filter((entry) => entry.status === "queued").length;
  const usersCount = store.users.length;
  const auditEventsCount = store.auditEvents.length;

  let state: OpsHealthSnapshot["state"] = "healthy";
  if (queueBacklogCount >= 25) {
    state = "degraded";
  } else if (queueBacklogCount >= 10) {
    state = "warning";
  }

  return {
    state,
    usersCount,
    clientsCount,
    consultationsCount,
    appointmentsCount,
    notificationsCount,
    queueBacklogCount,
    auditEventsCount
  };
}

export function createBackupSnapshot(ownerUserId: string, label: string, clientIds: string[] = []): BackupSnapshotRecord {
  const ownedClientIds = new Set(clientIds);

  const snapshot: BackupSnapshotRecord = {
    id: randomUUID(),
    ownerUserId,
    label,
    createdAt: new Date().toISOString(),
    snapshot: {
      clientsCount: ownedClientIds.size,
      consultationsCount: 0,
      appointmentsCount: 0,
      notificationsCount: 0,
      workspacesCount: getWorkspacesForUser(ownerUserId).length
    }
  };

  store.backupSnapshots.push(snapshot);
  backupSnapshotSequence += 1;
  backupSnapshotInsertionOrder.set(snapshot.id, backupSnapshotSequence);
  return snapshot;
}

export function getBackupSnapshotsForUser(userId: string): BackupSnapshotRecord[] {
  return store.backupSnapshots
    .filter((entry) => entry.ownerUserId === userId)
    .sort((left, right) => {
      // Backups are ordered by createdAt DESC. If timestamps are equal, use a
      // deterministic insertion-order tie-breaker (newer first).
      const createdAtComparison = right.createdAt.localeCompare(left.createdAt);
      if (createdAtComparison !== 0) {
        return createdAtComparison;
      }

      const leftOrder = backupSnapshotInsertionOrder.get(left.id) ?? 0;
      const rightOrder = backupSnapshotInsertionOrder.get(right.id) ?? 0;
      return rightOrder - leftOrder;
    });
}

export function beginRetentionExecutionScope(scope: string): boolean {
  if (activeRetentionExecutionScopes.has(scope)) {
    return false;
  }

  activeRetentionExecutionScopes.add(scope);
  return true;
}

export function endRetentionExecutionScope(scope: string): void {
  activeRetentionExecutionScopes.delete(scope);
}

export function isRetentionExecutionScopeActive(scope: string): boolean {
  return activeRetentionExecutionScopes.has(scope);
}

export function runRetentionJobForUser(input: {
  userId: string;
  olderThanDays: number;
  dryRun: boolean;
}): RetentionRunResult {
  const thresholdMs = Date.now() - input.olderThanDays * 24 * 60 * 60 * 1000;
  const isOld = (iso: string) => Date.parse(iso) < thresholdMs;

  const pushCandidates = store.pushQueue.filter((entry) => entry.userId === input.userId && isOld(entry.createdAt));
  const auditCandidates = store.auditEvents.filter(
    (entry) => entry.ownerUserId === input.userId && isOld(entry.createdAt)
  );

  if (!input.dryRun) {
    store.pushQueue = store.pushQueue.filter(
      (entry) => !(entry.userId === input.userId && isOld(entry.createdAt))
    );
    store.auditEvents = store.auditEvents.filter(
      (entry) => !(entry.ownerUserId === input.userId && isOld(entry.createdAt))
    );
  }

  return {
    dryRun: input.dryRun,
    olderThanDays: input.olderThanDays,
    pushQueueAffected: pushCandidates.length,
    auditEventsAffected: auditCandidates.length
  };
}

export function createSession(userId: string): string {
  const token = randomUUID();
  store.sessions.set(token, userId);
  return token;
}

export function revokeSessionToken(token: string | null): boolean {
  if (!token) {
    return false;
  }

  return store.sessions.delete(token);
}

// M26: password reset must invalidate every session this user has, not
// just the one token a caller happens to know about. Mirrors
// revokeSessionToken's single-token revocation, scoped by userId instead.
export function revokeAllSessionsForUser(userId: string): number {
  let revoked = 0;
  for (const [token, sessionUserId] of store.sessions) {
    if (sessionUserId === userId) {
      store.sessions.delete(token);
      revoked += 1;
    }
  }
  return revoked;
}

export function getSession(token: string | null): AuthSessionResponse["user"] | null {
  if (!token) {
    return null;
  }

  const userId = store.sessions.get(token);
  if (!userId) {
    return null;
  }

  const user = store.users.find((entry) => entry.id === userId);
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    locale: user.locale,
    createdAt: user.createdAt
  };
}

export function sanitize(value: unknown): string {
  return String(value ?? "").trim();
}

export function findUserByEmail(email: string): UserRecord | undefined {
  return store.users.find((item) => item.email.toLowerCase() === email.toLowerCase());
}

export function upsertUser(input: {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  locale: Locale;
  createdAt: string;
}): UserRecord {
  const existing = store.users.find(
    (entry) => entry.id === input.id || entry.email.toLowerCase() === input.email.toLowerCase()
  );

  if (existing) {
    existing.id = input.id;
    existing.email = input.email;
    existing.passwordHash = input.passwordHash;
    existing.role = input.role;
    existing.locale = input.locale;
    existing.createdAt = input.createdAt;
    return existing;
  }

  const user: UserRecord = {
    id: input.id,
    email: input.email,
    passwordHash: input.passwordHash,
    role: input.role,
    locale: input.locale,
    createdAt: input.createdAt
  };

  store.users.push(user);
  return user;
}

export function updateUserPasswordHash(userId: string, passwordHash: string): UserRecord | null {
  const user = store.users.find((entry) => entry.id === userId) ?? null;
  if (!user) {
    return null;
  }

  user.passwordHash = passwordHash;
  return user;
}

export function createUser(input: {
  email: string;
  password: string;
  role: UserRole;
  locale: Locale;
}): UserRecord {
  const user: UserRecord = {
    id: randomUUID(),
    email: input.email,
    passwordHash: input.password,
    role: input.role,
    locale: input.locale,
    createdAt: new Date().toISOString()
  };

  store.users.push(user);
  return user;
}

export function createClientPhoto(input: {
  clientId: string;
  imageUrl: string;
  caption: string;
}): ClientPhotoRecord {
  const record: ClientPhotoRecord = {
    id: randomUUID(),
    clientId: input.clientId,
    imageUrl: input.imageUrl,
    caption: input.caption,
    createdAt: new Date().toISOString()
  };

  store.photos.push(record);
  return record;
}

export function getPhotosForClientByUser(clientId: string, _userId: string): ClientPhotoRecord[] {
  return store.photos
    .filter((entry) => entry.clientId === clientId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function createFormulaRecord(input: {
  clientId: string;
  formulaName: string;
  formulaDetails: string;
}): FormulaRecord {
  const record: FormulaRecord = {
    id: randomUUID(),
    clientId: input.clientId,
    formulaName: input.formulaName,
    formulaDetails: input.formulaDetails,
    createdAt: new Date().toISOString()
  };

  store.formulas.push(record);
  return record;
}

export function getFormulasForClientByUser(clientId: string, _userId: string): FormulaRecord[] {
  return store.formulas
    .filter((entry) => entry.clientId === clientId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function createTreatmentRecord(input: {
  clientId: string;
  treatmentName: string;
  treatmentDetails: string;
}): TreatmentRecord {
  const record: TreatmentRecord = {
    id: randomUUID(),
    clientId: input.clientId,
    treatmentName: input.treatmentName,
    treatmentDetails: input.treatmentDetails,
    createdAt: new Date().toISOString()
  };

  store.treatments.push(record);
  return record;
}

export function getTreatmentsForClientByUser(clientId: string, _userId: string): TreatmentRecord[] {
  return store.treatments
    .filter((entry) => entry.clientId === clientId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
