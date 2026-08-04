import type { M15V1ObjectReference } from "./object-storage-runtime";
import type { BaseRecommendationPlan } from "./recommendation-engine-shared";

export type UserRole = "professional" | "salon" | "consumer";

export type Locale = "en" | "ro";

export interface AuthRegisterRequest {
  email: string;
  password: string;
  role: UserRole;
  locale: Locale;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthSessionResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
    locale: Locale;
    createdAt: string;
  };
}

// M26: register no longer returns a session for newly-created accounts --
// they must verify their email, then sign in separately. Deliberately a
// distinct shape from AuthSessionResponse rather than a nullable/optional
// variant of it, so no consumer can mistake this for a working session.
export interface AuthRegisterResponse {
  message: string;
  email: string;
  emailVerificationRequired: true;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface VerifyEmailResponse {
  verified: true;
  message: string;
}

export interface ResendVerificationEmailRequest {
  email: string;
}

export interface RequestPasswordResetRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

// Shared by resend-verification-email and request-password-reset: both
// return this exact shape regardless of whether the account exists (or,
// for resend, whether it's already verified) -- never confirm or deny
// account existence to an unauthenticated caller.
export interface AuthGenericAckResponse {
  message: string;
}

export interface ClientCreateRequest {
  fullName: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface ClientUpdateRequest {
  fullName?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface ClientRecord {
  id: string;
  ownerUserId: string;
  fullName: string;
  email: string;
  phone: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type AnalysisGoal = "refresh" | "cover" | "lighten" | "correct" | "reshape" | "treat";

export type AnalysisProfileOption = "low" | "medium" | "high" | "fine" | "coarse";

export type HairType = "fine" | "medium" | "coarse";

export type DensityLevel = "low" | "medium" | "high";

export type PorosityLevel = "low" | "medium" | "high";

export type AnalysisPhase = "pending_questions" | "ready";

export type FaceShape = "oval" | "round" | "square" | "heart" | "diamond" | "oblong";
export type HeadShape = "balanced" | "flat_occipital" | "prominent_crown" | "wide_parietal" | "irregular_occipital";
export type HairLength = "pixie" | "short" | "medium" | "long" | "extra_long";
export type HairTexture = "straight" | "wavy" | "curly" | "coily";
export type HairDensity = "low" | "medium" | "high";
export type HairCondition = "virgin_healthy" | "chemically_treated" | "high_porosity_damaged" | "fragile_breakage";
export type GrowthPattern = "regular" | "double_crown" | "front_cowlick" | "nape_whorl" | "strong_widow_peak";
export type TargetShape = "precision_bob" | "graduated_bob" | "long_layers" | "shag_mullet" | "pixie_crop" | "face_framing_cascade" | "blunt_perimeter_texturized";

export type StructuralTechnique = "precision_layering" | "graduation" | "one_length" | "internal_layering" | "compact_graduation";
export type CuttingTechnique = "blunt_line" | "scissor_over_comb" | "slice_cutting" | "elevation_cutting";
export type TexturizingTechnique = "point_cutting" | "slice_and_slide" | "razor_texturizing" | "channel_cutting" | "debulking";
export type TechnicalCutSectioning = "4_quadrant_profile_radial" | "horseshoe_crown" | "diagonal_back" | "pivot_radial" | "horseshoe_fringe";
export type TechnicalCutElevation = "0_deg_blunt" | "45_deg_graduation" | "90_deg_uniform_layer" | "135_deg_long_layer" | "180_deg_overdirection";
export type TechnicalCutDistribution = "natural_fall" | "perpendicular" | "overdirected_back" | "overdirected_forward" | "shifting_line";
export type TechnicalCutGuideline = "stationary" | "traveling" | "visual_perimeter" | "multiple_reference";

export interface CuttingStep {
  stepNumber: number;
  zone: string;
  action: string;
  elevationAngle: TechnicalCutElevation;
  toolRequired: string;
}

export interface TechnicalCutPlan {
  structuralTechnique: StructuralTechnique;
  cuttingTechnique: CuttingTechnique;
  texturizingTechnique?: TexturizingTechnique;
  sectioning: TechnicalCutSectioning;
  elevation: TechnicalCutElevation;
  distribution: TechnicalCutDistribution;
  guideline: TechnicalCutGuideline;
  cuttingSteps: CuttingStep[];
  stylistExplanation: string;
  clientExplanation: string;
  professionalReason: string;
  warnings: string[];
  contraindications: string[];
  assumptions: string[];
  missingData: string[];
  confidence: number;
  notes?: string[];
  stylistValidationDisclaimer: string;
  version: string;
}

// M27: Color Recommendation Engine (GO-2). Additive only -- built independently
// of and neutral to TechnicalCutPlan above, which is unchanged. Not yet wired
// into AnalysisRequest/AnalysisEngineInput/analyzeInitial (GO-3).
export type DesiredColorResult =
  | "gray_coverage"
  | "gloss_refresh"
  | "root_shadow"
  | "balayage_highlights"
  | "full_lightening"
  | "color_correction";

export type GrayPercentage = "none" | "low" | "medium" | "high";

export type ColorFormulaDirection =
  | "single_process_gray_coverage"
  | "gloss_demi_permanent"
  | "root_shadow_melt"
  | "balayage_freehand"
  | "double_process_lightening"
  | "color_correction_neutralize";

export type ColorDeveloperVolume = "10vol" | "20vol" | "30vol" | "40vol";

export type ColorToneDirection = "cool_ash" | "warm_gold" | "neutral" | "cool_violet" | "warm_copper";

export type ColorApplicationTechnique =
  | "global_application"
  | "root_touch_up"
  | "foils"
  | "balayage_freehand"
  | "color_melt";

export interface ColorStep {
  stepNumber: number;
  zone: string;
  action: string;
  processingTimeMinutes?: number;
  toolRequired: string;
}

export interface ColorPlan extends BaseRecommendationPlan {
  formulaDirection: ColorFormulaDirection;
  developerVolume: ColorDeveloperVolume;
  liftLevels: number;
  toneDirection: ColorToneDirection;
  applicationTechnique: ColorApplicationTechnique;
  processingSteps: ColorStep[];
  maintenancePlan: string[];
  strandTestRequired: boolean;
}

// M27 GO-3: Treatment Recommendation Engine. Additive only.
export type ScalpCondition = "normal" | "oily" | "dry" | "sensitive" | "flaking";

export type TreatmentGoalDetail = "hydration" | "repair" | "detox_scalp" | "bonding_repair" | "post_color_recovery";

export type TreatmentCategory =
  | "deep_hydration"
  | "bond_repair"
  | "scalp_therapy"
  | "post_color_recovery"
  | "protein_reconstruction";

export type TreatmentFrequency =
  | "weekly_for_4_weeks"
  | "biweekly_for_6_weeks"
  | "single_session_reassess"
  | "monthly_maintenance";

export interface TreatmentStep {
  stepNumber: number;
  zone: string;
  action: string;
  toolRequired: string;
}

export interface TreatmentPlan extends BaseRecommendationPlan {
  treatmentCategory: TreatmentCategory;
  protocolSteps: TreatmentStep[];
  aftercareSteps: string[];
  recommendedFrequency: TreatmentFrequency;
  followUpReviewWeeks: number;
}

export interface AnalysisRequest {
  clientId: string;
  goal: AnalysisGoal;
  hairType: HairType;
  density: DensityLevel;
  porosity: PorosityLevel;
  faceShape?: FaceShape;
  headShape?: HeadShape;
  hairLength?: HairLength;
  hairTexture?: HairTexture;
  hairCondition?: HairCondition;
  growthPattern?: GrowthPattern;
  targetShape?: TargetShape;
  desiredColorResult?: DesiredColorResult;
  grayPercentage?: GrayPercentage;
  scalpCondition?: ScalpCondition;
  treatmentGoalDetail?: TreatmentGoalDetail;
}

export interface AnalysisResponse {
  analysisId: string;
  phase: AnalysisPhase;
  clarificationRound: number;
  confidenceScore: number;
  uncertaintyReasons: string[];
  followUpQuestions: string[];
  recommendations: string[];
  safetyNotes: string[];
  technicalCutPlan?: TechnicalCutPlan;
  colorPlan?: ColorPlan;
  treatmentPlan?: TreatmentPlan;
}

export interface AnalysisClarifyRequest {
  answers: string[];
}

// M24: guest/anonymous preview. Deliberately minimal and disjoint from
// AnalysisRequest/AnalysisResponse -- no clientId (no guest owns a client),
// no analysisId (nothing is persisted), no confidenceScore (never invented
// for a guest), no technicalCutPlan (professional-only, never exposed to an
// unauthenticated visitor).
export interface AnalysisPreviewRequest {
  goal: AnalysisGoal;
  hairType: HairType;
  density: DensityLevel;
  porosity: PorosityLevel;
}

export interface AnalysisPreviewResponse {
  preview: true;
  recommendations: string[];
  safetyNotes: string[];
  followUpQuestions: string[];
  disclaimer: string;
}

export interface AnalysisResultResponse extends AnalysisResponse {
  clientId: string;
  goal: AnalysisGoal;
  hairType: HairType;
  density: DensityLevel;
  porosity: PorosityLevel;
  faceShape?: FaceShape;
  headShape?: HeadShape;
  hairLength?: HairLength;
  hairTexture?: HairTexture;
  hairCondition?: HairCondition;
  growthPattern?: GrowthPattern;
  targetShape?: TargetShape;
  desiredColorResult?: DesiredColorResult;
  grayPercentage?: GrayPercentage;
  scalpCondition?: ScalpCondition;
  treatmentGoalDetail?: TreatmentGoalDetail;
  clarificationAnswers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ConsultationCreateRequest {
  clientId: string;
  analysisId: string;
  summary: string;
  nextSteps: string[];
}

export interface ConsultationRecord {
  id: string;
  clientId: string;
  analysisId: string;
  summary: string;
  nextSteps: string[];
  createdAt: string;
}

export interface ClientConsultationsResponse {
  consultations: ConsultationRecord[];
}

export interface ClientPhotoCreateRequest {
  imageUrl: string;
  caption?: string;
}

export interface ClientPhotoRecord {
  id: string;
  clientId: string;
  imageUrl: string;
  caption: string;
  createdAt: string;
}

export interface FormulaCreateRequest {
  formulaName: string;
  formulaDetails: string;
}

export interface FormulaRecord {
  id: string;
  clientId: string;
  formulaName: string;
  formulaDetails: string;
  createdAt: string;
}

export interface TreatmentCreateRequest {
  treatmentName: string;
  treatmentDetails: string;
}

export interface TreatmentRecord {
  id: string;
  clientId: string;
  treatmentName: string;
  treatmentDetails: string;
  createdAt: string;
}

export type ReminderType = "appointment" | "follow_up" | "maintenance";

export interface AppointmentCreateRequest {
  clientId: string;
  title: string;
  startsAt: string;
  reminderMinutesBefore?: number;
  reminderType?: ReminderType;
  notes?: string;
}

export interface AppointmentRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  title: string;
  startsAt: string;
  reminderMinutesBefore: number;
  reminderType: ReminderType;
  reminderSentAt: string | null;
  notes: string;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  ownerUserId: string;
  type: ReminderType;
  title: string;
  message: string;
  relatedClientId: string;
  relatedAppointmentId: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsReadRequest {
  notificationIds?: string[];
}

export interface TimelineEntry {
  id: string;
  kind: "photo" | "formula" | "treatment" | "consultation" | "appointment";
  createdAt: string;
  title: string;
  details: string;
}

export interface ClientTimelineResponse {
  photos: ClientPhotoRecord[];
  formulas: FormulaRecord[];
  treatments: TreatmentRecord[];
  consultations: ConsultationRecord[];
  appointments: AppointmentRecord[];
  timeline: TimelineEntry[];
}

export type AcademyCategoryKey =
  | "haircuts"
  | "color"
  | "lightening"
  | "styling"
  | "extensions"
  | "treatments"
  | "keratin"
  | "washing"
  | "products";

export interface AcademyCategory {
  id: string;
  key: AcademyCategoryKey;
  name: string;
  description: string;
}

export interface AcademyLesson {
  id: string;
  categoryId: string;
  title: string;
  summary: string;
  warnings: string[];
}

export interface VideoLessonGenerateRequest {
  topic: string;
  level?: "beginner" | "intermediate" | "advanced";
  locale?: Locale;
}

// "not_generated" is the only status M22 ever emits: no real generation
// capability exists yet, so a row never reaches queued/processing/completed
// through honest code. Those three values stay part of the contract,
// unemitted, for a future milestone that adds real generation.
export type VideoLessonStatus = "queued" | "processing" | "completed" | "failed" | "not_generated";

export interface VideoLessonRecord {
  id: string;
  ownerUserId: string;
  topic: string;
  level: "beginner" | "intermediate" | "advanced";
  locale: Locale;
  status: VideoLessonStatus;
  recommendedLessonIds: string[];
  script: string | null;
  videoUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ProductRecord {
  id: string;
  name: string;
  category: string;
  countryCodes: string[];
  cityAvailability: string[];
  goals: AnalysisGoal[];
  brand: string;
}

export interface SupplierRecord {
  id: string;
  name: string;
  countryCode: string;
  city: string;
  categories: string[];
  supportedGoals: AnalysisGoal[];
  rating: number;
}

export interface ShortlistCreateRequest {
  clientId?: string;
  title: string;
  productIds: string[];
  supplierIds: string[];
}

export interface ShortlistRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  title: string;
  productIds: string[];
  supplierIds: string[];
  createdAt: string;
}

export type SubscriptionPlan = "free" | "pro" | "salon" | "business";

export type SubscriptionStatus = "inactive" | "trialing" | "active" | "past_due" | "canceled";

export interface BillingCheckoutRequest {
  plan: SubscriptionPlan;
}

export interface SubscriptionRecord {
  id: string;
  ownerUserId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  ownerUserId: string;
  providerEventId: string;
  amountCents: number;
  currency: string;
  status: "succeeded" | "failed";
  createdAt: string;
}

export interface BillingWebhookEvent {
  eventId: string;
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  amountCents?: number;
  currency?: string;
}

export interface AgentOrchestrateRequest {
  taskType: "analysis" | "consultation" | "marketplace";
  requestId?: string;
  payload: Record<string, unknown>;
}

export interface AgentStepResult {
  agent: "planner" | "safety" | "domain" | "formatter";
  status: "ok" | "skipped";
  summary: string;
}

export interface AgentOrchestrateResponse {
  requestId: string;
  steps: AgentStepResult[];
  output: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  ownerUserId: string;
  requestId: string;
  module: "billing" | "agents" | "security";
  action: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface WorkspaceRecord {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: string;
}

export interface WorkspaceMemberRecord {
  id: string;
  workspaceId: string;
  userId: string;
  role: "owner" | "manager" | "stylist";
  createdAt: string;
}

export interface WorkspaceCreateRequest {
  name: string;
}

export interface WorkspaceAddMemberRequest {
  userId: string;
  role?: "manager" | "stylist";
}

export interface AnalyticsSnapshot {
  consultationsCount: number;
  appointmentsCount: number;
  remindersSentCount: number;
  activeSubscriptionCount: number;
  generatedVideoLessonsCount: number;
}

export interface PushPreferenceRecord {
  userId: string;
  enabled: boolean;
  channels: Array<"in_app" | "email" | "push">;
  updatedAt: string;
}

export interface PushQueueRecord {
  id: string;
  userId: string;
  channel: "in_app" | "email" | "push";
  title: string;
  body: string;
  status: "queued" | "sent" | "failed";
  createdAt: string;
  processedAt: string | null;
}

export interface OpsHealthSnapshot {
  state: "healthy" | "warning" | "degraded";
  usersCount: number;
  clientsCount: number;
  consultationsCount: number;
  appointmentsCount: number;
  notificationsCount: number;
  queueBacklogCount: number;
  auditEventsCount: number;
}

export type RestoreGovernanceWindow = "24h" | "7d" | "30d";

export type RestoreGovernanceHealthReasonCode =
  | "STALE_MAINTENANCE_RUNS"
  | "STALE_RETENTION_RUNS"
  | "STALE_RESTORE_RUNS"
  | "RECENT_FAILURE_ATTENTION";

export interface RestoreGovernanceCurrentStateSnapshot {
  staleRestoreRuns: number;
  staleMaintenanceRuns: number;
  staleRetentionRuns: number;
  activeGovernanceOperations: number;
}

export interface RestoreGovernanceWindowMetrics {
  restore: {
    restoreRunsStarted: number;
    restoreRunsCompleted: number;
    restoreRunsFailed: number;
    restoreRunsIndeterminate: number;
    restoreSuccessRate: number | null;
    restoreP50DurationMs: number | null;
    restoreP95DurationMs: number | null;
    averageAttemptsUsed: number | null;
  };
  maintenance: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    candidatesScanned: number;
    candidatesReconciledIndeterminate: number;
  };
  retention: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    restoreRunsDeleted: number;
    maintenanceRunsDeleted: number;
  };
}

export interface RestoreGovernanceTimelineBucket {
  bucketStart: string;
  restoreStarted: number;
  restoreCompleted: number;
  restoreFailed: number;
  restoreIndeterminate: number;
  maintenanceCompleted: number;
  maintenanceFailed: number;
  retentionCompleted: number;
  retentionFailed: number;
}

export interface RestoreGovernanceFailureCodeCount {
  code: string;
  count: number;
}

export interface RestoreRecentFailureBase {
  runType: "restore" | "maintenance" | "retention";
  runId: string;
  backupId: string | null;
  finalErrorCode: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface RestoreRecentFailure extends RestoreRecentFailureBase {
  runType: "restore";
  status: "failed" | "indeterminate";
  backupId: string;
  attemptCount: number;
}

export interface MaintenanceRecentFailure extends RestoreRecentFailureBase {
  runType: "maintenance";
  status: "failed";
  backupId: null;
  attemptCount: null;
}

export interface RetentionRecentFailure extends RestoreRecentFailureBase {
  runType: "retention";
  status: "failed";
  backupId: null;
  attemptCount: null;
}

export type RestoreGovernanceRecentFailure =
  | RestoreRecentFailure
  | MaintenanceRecentFailure
  | RetentionRecentFailure;

export interface RestoreGovernanceObservabilityResponse {
  requestId: string;
  generatedAt: string;
  window: RestoreGovernanceWindow;
  bucketSize: "1h" | "1d";
  currentState: RestoreGovernanceCurrentStateSnapshot;
  windowMetrics: RestoreGovernanceWindowMetrics;
  failuresByCode: RestoreGovernanceFailureCodeCount[];
  timeline: RestoreGovernanceTimelineBucket[];
  recentFailures: RestoreGovernanceRecentFailure[];
}

export interface RestoreGovernanceHealthResponse {
  requestId: string;
  generatedAt: string;
  state: "healthy" | "warning" | "degraded";
  reasons: RestoreGovernanceHealthReasonCode[];
  currentState: RestoreGovernanceCurrentStateSnapshot;
  recentFailureAttentionCount24h: number;
  thresholds: {
    restoreStartedStaleMinutes: 15;
    maintenanceRunningStaleMinutes: 30;
    retentionRunningStaleMinutes: 30;
    warningFailureAttentionCount24hMin: 1;
    warningFailureAttentionCount24hMax: 2;
    degradedFailureAttentionCount24hMin: 3;
  };
}

export type RestoreGovernanceAlertCode =
  | "STALE_RESTORE_RUNS"
  | "STALE_GOVERNANCE_RUNS"
  | "LOW_RESTORE_SUCCESS_RATE"
  | "HIGH_INDETERMINATE_RATIO"
  | "RECENT_FAILURE_ATTENTION";

export type RestoreGovernanceAlertComparator = ">=" | ">" | "<";

export interface RestoreGovernanceAlertBase {
  code: RestoreGovernanceAlertCode;
  severity: "warning" | "degraded";
  message: string;
  window: RestoreGovernanceWindow;
  comparator: RestoreGovernanceAlertComparator;
  warningThreshold: number;
  degradedThreshold: number;
  actualValue: number;
  sampleSize: number;
  minimumSampleSize: number | null;
  evaluatedAt: string;
}

export interface RestoreGovernanceStaleRestoreRunsAlert extends RestoreGovernanceAlertBase {
  code: "STALE_RESTORE_RUNS";
  comparator: ">=";
}

export interface RestoreGovernanceStaleGovernanceRunsAlert extends RestoreGovernanceAlertBase {
  code: "STALE_GOVERNANCE_RUNS";
  comparator: ">=";
  evidence: {
    staleMaintenanceRuns: number;
    staleRetentionRuns: number;
    totalStaleGovernanceRuns: number;
  };
}

export interface RestoreGovernanceLowSuccessRateAlert extends RestoreGovernanceAlertBase {
  code: "LOW_RESTORE_SUCCESS_RATE";
  comparator: "<";
}

export interface RestoreGovernanceHighIndeterminateRatioAlert extends RestoreGovernanceAlertBase {
  code: "HIGH_INDETERMINATE_RATIO";
  comparator: ">";
}

export interface RestoreGovernanceRecentFailureAttentionAlert extends RestoreGovernanceAlertBase {
  code: "RECENT_FAILURE_ATTENTION";
  comparator: ">=";
}

export type RestoreGovernanceOperationalAlert =
  | RestoreGovernanceStaleRestoreRunsAlert
  | RestoreGovernanceStaleGovernanceRunsAlert
  | RestoreGovernanceLowSuccessRateAlert
  | RestoreGovernanceHighIndeterminateRatioAlert
  | RestoreGovernanceRecentFailureAttentionAlert;

export interface RestoreGovernanceAlertsResponse {
  requestId: string;
  generatedAt: string;
  window: RestoreGovernanceWindow;
  state: "healthy" | "warning" | "degraded";
  alerts: RestoreGovernanceOperationalAlert[];
}

export interface BackupSnapshotRecord {
  id: string;
  ownerUserId: string;
  label: string;
  createdAt: string;
  checksum?: string;
  checksumAlgorithm?: string;
  schemaVersion?: string;
  createdByUserId?: string;
  snapshot: {
    clientsCount: number;
    consultationsCount: number;
    appointmentsCount: number;
    notificationsCount: number;
    workspacesCount: number;
  };
}

export type BackupVerifyChecksumStatus =
  | "verified_match"
  | "verified_mismatch"
  | "not_available"
  | "not_applicable";

export type BackupVerifyArtifactValidity =
  | "valid"
  | "legacy_valid"
  | "malformed"
  | "unsupported_schema";

export type BackupVerifyExternalReferenceStatus =
  | "all_exist_integrity_unverified"
  | "missing_objects"
  | "not_applicable";

export type BackupRecoveryArtifactStatus = "verification_ready" | "legacy_summary_only" | "invalid";

export type BackupVerifyReason =
  | "legacy_summary_only"
  | "checksum_mismatch"
  | "unsupported_schema_version"
  | "artifact_malformed"
  | "missing_external_object"
  | "external_binary_integrity_unavailable"
  | "artifact_id_mismatch"
  | "external_reference_unsafe";

export type BackupRestorePreviewChecksumStatus = "valid" | "mismatch" | "unavailable";

export type BackupRestorePreviewArtifactValidity = "valid" | "invalid" | "unsupported_schema";

export type BackupRestorePreviewExternalReferenceStatus =
  | "none"
  | "all_exist_integrity_unverified"
  | "missing"
  | "unsafe";

export type BackupRestorePreviewSection =
  | "clients"
  | "analyses"
  | "consultations"
  | "imageAssets"
  | "imageAnalyses"
  | "imageAnalysisReviews";

export type BackupRestorePreviewIssueCode =
  | "OWNER_SCOPE_MISMATCH"
  | "REFERENCE_MISSING"
  | "REFERENCE_OWNER_MISMATCH"
  | "REFERENCE_GRAPH_INVALID"
  | "SCHEMA_DRIFT"
  | "EXTERNAL_FILE_MISSING"
  | "EXTERNAL_PATH_UNSAFE"
  | "BACKUP_OLDER_THAN_CURRENT_STATE"
  | "CURRENT_STATE_HAS_EXTRA_ROWS"
  | "LEGACY_CLIENT_FIELDS_OMITTED"
  | "LEGACY_CONSULTATIONS_OMITTED"
  | "CHECKSUM_MISMATCH"
  | "UNSUPPORTED_SCHEMA"
  | "ARTIFACT_INVALID";

export interface BackupRestorePreviewIssue {
  code: BackupRestorePreviewIssueCode;
  section: BackupRestorePreviewSection | null;
  recordId: string | null;
  referenceId: string | null;
  messageSafe: string;
}

export interface BackupRestorePreviewImpactSection {
  backupCount: number;
  currentCount: number;
  wouldCreate: number;
  wouldReplace: number;
  wouldDelete: number;
  unchanged: number;
  conflictCount: number;
}

export interface BackupRestorePreviewResponse {
  backupId: string;
  schemaVersion: string;
  eligibleForRestorePlanning: boolean;
  checksumStatus: BackupRestorePreviewChecksumStatus;
  artifactValidity: BackupRestorePreviewArtifactValidity;
  externalReferenceStatus: BackupRestorePreviewExternalReferenceStatus;
  backupStateFingerprint: string;
  currentStateFingerprint: string;
  currentClientStateFingerprint: string;
  previewGeneratedAt: string;
  previewFingerprint: string;
  latestBackupUpdatedAt: string | null;
  latestCurrentUpdatedAt: string | null;
  impact: {
    clients: BackupRestorePreviewImpactSection;
    analyses: BackupRestorePreviewImpactSection;
    consultations?: BackupRestorePreviewImpactSection;
    imageAssets: BackupRestorePreviewImpactSection;
    imageAnalyses: BackupRestorePreviewImpactSection;
    imageAnalysisReviews: BackupRestorePreviewImpactSection;
  };
  conflicts: BackupRestorePreviewIssue[];
  warnings: BackupRestorePreviewIssue[];
  blockingReasons: BackupRestorePreviewIssue[];
}

export type BackupM15RestorePreviewExternalReferenceStatus = "verified" | "failed";

export type BackupM15RestorePreviewExternalReferenceCode =
  | "verified"
  | "invalid_reference"
  | "unknown_alias"
  | "missing_object"
  | "identity_mismatch"
  | "version_mismatch"
  | "size_mismatch"
  | "checksum_metadata_mismatch"
  | "streamed_checksum_mismatch"
  | "streamed_size_mismatch"
  | "stream_limit_exceeded"
  | "storage_timeout"
  | "storage_access_denied"
  | "storage_unavailable";

export interface BackupM15RestorePreviewExternalReferences {
  status: BackupM15RestorePreviewExternalReferenceStatus;
  code: BackupM15RestorePreviewExternalReferenceCode;
  totalReferences: number;
  verifiedReferences: number;
}

export interface BackupM15RestorePreviewResponse extends Omit<
  BackupRestorePreviewResponse,
  "schemaVersion" | "externalReferenceStatus"
> {
  schemaVersion: "m15.v1";
  externalReferenceStatus: BackupM15RestorePreviewExternalReferenceStatus;
  externalReferences: BackupM15RestorePreviewExternalReferences;
}

export type BackupRestoreStrategy = "replace_all";

export interface BackupRestoreRequest {
  previewFingerprint: string;
  currentStateFingerprint: string;
  strategy: BackupRestoreStrategy;
  acknowledgeDataLoss: true;
  previewGeneratedAt?: string;
  acknowledgeLegacyClientDataLoss?: true;
  safetyBackupId?: string;
  consultationSafetyBackupId?: string;
  acknowledgeLegacyConsultationDataLoss?: true;
}

export type BackupRestoreWarningCode =
  | "BACKUP_OLDER_THAN_CURRENT_STATE"
  | "CURRENT_STATE_HAS_EXTRA_ROWS"
  | "LEGACY_CLIENT_FIELDS_OMITTED"
  | "LEGACY_CONSULTATIONS_OMITTED";

export interface BackupRestoreWarning {
  code: BackupRestoreWarningCode;
  messageSafe: string;
}

export interface BackupRestoreCounts {
  clients: number;
  analyses: number;
  consultations?: number;
  imageAssets: number;
  imageAnalyses: number;
  imageAnalysisReviews: number;
}

export interface BackupRestoreResponse {
  backupId: string;
  status: "completed";
  strategy: "replace_all";
  appliedPreviewFingerprint: string;
  previousCurrentStateFingerprint: string;
  backupStateFingerprint: string;
  restoredStateFingerprint: string;
  deletedCounts: BackupRestoreCounts;
  restoredCounts: BackupRestoreCounts;
  startedAt: string;
  finishedAt: string;
  warnings: BackupRestoreWarning[];
}

export type BackupRestoreRunStatus = "started" | "completed" | "failed" | "indeterminate";

export interface BackupRestoreRunCounts {
  deletedClientCount: number | null;
  deletedAnalysisCount: number | null;
  deletedImageAssetCount: number | null;
  deletedImageAnalysisCount: number | null;
  deletedImageAnalysisReviewCount: number | null;
  restoredClientCount: number | null;
  restoredAnalysisCount: number | null;
  restoredImageAssetCount: number | null;
  restoredImageAnalysisCount: number | null;
  restoredImageAnalysisReviewCount: number | null;
}

export interface BackupRestoreRunHistoryRecord extends BackupRestoreRunCounts {
  id: string;
  backupId: string;
  status: BackupRestoreRunStatus;
  attemptCount: number;
  maxAttempts: number;
  strategy: BackupRestoreStrategy;
  previewFingerprintPrefix: string;
  currentStateFingerprintPrefix: string;
  startedAt: string;
  finishedAt: string | null;
  finalErrorCode: string | null;
  warningCodes: BackupRestoreWarningCode[];
  isStale: boolean;
}

export interface BackupRestoreRunHistoryPage {
  data: BackupRestoreRunHistoryRecord[];
  pageInfo: {
    nextCursor: string | null;
    hasNextPage: boolean;
    limit: number;
  };
}

export interface BackupRestoreRunHistoryListInput {
  ownerUserId: string;
  limit?: number;
  cursor?: string | null;
  backupId?: string;
  status?: BackupRestoreRunStatus;
  from?: string;
  to?: string;
  correlationRequestId?: string;
}

export interface BackupRestoreRunMaintenanceSummary {
  candidateCount: number;
  reconciledCount: number;
}

export interface BackupRestoreRunMaintenanceDryRunRequest {
  mode: "dry_run";
  staleThresholdMinutes: number;
}

export interface BackupRestoreRunMaintenanceExecutionRequest {
  mode: "execution";
  staleThresholdMinutes: number;
  evaluationTime: string;
  maintenanceFingerprint: string;
  acknowledgeMutation: true;
  executionIdempotencyKey: string;
}

export type BackupRestoreRunMaintenanceRequest =
  | BackupRestoreRunMaintenanceDryRunRequest
  | BackupRestoreRunMaintenanceExecutionRequest;

export interface BackupRestoreRunMaintenanceDryRunResponse {
  mode: "dry_run";
  evaluationTime: string;
  maintenanceFingerprint: string;
  summary: BackupRestoreRunMaintenanceSummary;
}

export interface BackupRestoreRunMaintenanceExecutionResponse {
  mode: "execution";
  runId: string;
  status: "completed";
  replayed: boolean;
  evaluationTime: string;
  maintenanceFingerprint: string;
  summary: BackupRestoreRunMaintenanceSummary;
}

export type BackupRestoreRunMaintenanceResponse =
  | BackupRestoreRunMaintenanceDryRunResponse
  | BackupRestoreRunMaintenanceExecutionResponse;

export interface BackupRestoreRunRetentionSummary {
  restoreRunCandidatesCount: number;
  maintenanceRunCandidatesCount: number;
  totalCandidatesCount: number;
  eligibleBeyondBatchRestoreRunCount: number;
  eligibleBeyondBatchMaintenanceRunCount: number;
  restoreRunIdsSample: string[];
  maintenanceRunIdsSample: string[];
}

export interface BackupRestoreRunRetentionDryRunRequest {
  mode: "dry_run";
  policyVersion: "m13f-v1";
  batchLimit: number;
}

export interface BackupRestoreRunRetentionExecutionRequest {
  mode: "execution";
  policyVersion: "m13f-v1";
  batchLimit: number;
  evaluationTime: string;
  retentionFingerprint: string;
  executionIdempotencyKey: string;
  acknowledgeDeletion: true;
}

export type BackupRestoreRunRetentionRequest =
  | BackupRestoreRunRetentionDryRunRequest
  | BackupRestoreRunRetentionExecutionRequest;

export interface BackupRestoreRunRetentionDryRunResponse {
  mode: "dry_run";
  policyVersion: "m13f-v1";
  batchLimit: number;
  evaluationTime: string;
  retentionFingerprint: string;
  summary: BackupRestoreRunRetentionSummary;
}

export interface BackupRestoreRunRetentionExecutionResponse {
  mode: "execution";
  runId: string;
  status: "completed";
  replayed: boolean;
  policyVersion: "m13f-v1";
  batchLimit: number;
  evaluationTime: string;
  retentionFingerprint: string;
  summary: BackupRestoreRunRetentionSummary;
  deletedCounts: {
    restoreRunsDeleted: number;
    maintenanceRunsDeleted: number;
  };
}

export type BackupRestoreRunRetentionResponse =
  | BackupRestoreRunRetentionDryRunResponse
  | BackupRestoreRunRetentionExecutionResponse;

export interface BackupV13ClientSectionRow {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupV13V2ClientSectionRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  deletedAt: string | null;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupV13AnalysisSectionRow {
  id: string;
  clientId: string;
  ownerUserId: string;
  goal: string;
  hairType: string;
  density: string;
  porosity: string;
  phase: string;
  clarificationRound: number;
  confidenceScore: number;
  uncertaintyReasons: unknown;
  followUpQuestions: unknown;
  recommendations: unknown;
  safetyNotes: unknown;
  faceShape: string | null;
  headShape: string | null;
  hairLength: string | null;
  hairTexture: string | null;
  hairCondition: string | null;
  growthPattern: string | null;
  targetShape: string | null;
  technicalCutPlan: unknown;
  clarificationAnswers: unknown;
  imageAssetId: string | null;
  imageAnalysisId: string | null;
  m8DraftCreatedAt: string | null;
  m8FinalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupV13ImageAssetSectionRow {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  ownerUserId: string;
  clientId: string;
  storagePath: string;
  exifStripped: boolean;
  normalizedOrientation: number;
  uploadedAt: string;
  deletedAt: string | null;
  retentionDeletesAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupV13ImageAnalysisSectionRow {
  id: string;
  assetId: string;
  status: string;
  providerName: string;
  modelVersion: string;
  analysisPayload: unknown;
  confidences: unknown;
  unknownFields: unknown;
  warnings: unknown;
  limitations: unknown;
  consentTimestamp: string;
  deletedAt: string | null;
  retentionDeletesAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupV13ImageAnalysisReviewSectionRow {
  id: string;
  analysisId: string;
  reviewedByUserId: string;
  manualCorrections: unknown;
  confirmationTimestamp: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupV13V3ConsultationSectionRow {
  id: string;
  ownerUserId: string;
  clientId: string;
  analysisId: string;
  summary: string;
  nextSteps: string[];
  createdAt: string;
}

export interface BackupV13V1Artifact {
  schemaVersion: "m13.v1";
  canonicalSerializationVersion: "sorted-json-v1";
  checksumAlgorithm: "sha256";
  checksum: string | null;
  backupId: string;
  ownerUserId: string;
  createdByUserId: string;
  label: string;
  createdAt: string;
  summarySnapshot: BackupSnapshotRecord["snapshot"];
  counts: {
    clients: number;
    analyses: number;
    imageAssets: number;
    imageAnalyses: number;
    imageAnalysisReviews: number;
  };
  limits: {
    maxArtifactBytes: number;
    maxSectionBytes: number;
    maxRowsPerSection: {
      clients: number;
      analyses: number;
      imageAssets: number;
      imageAnalyses: number;
      imageAnalysisReviews: number;
    };
  };
  sections: {
    clients: BackupV13ClientSectionRow[];
    analyses: BackupV13AnalysisSectionRow[];
    imageAssets: BackupV13ImageAssetSectionRow[];
    imageAnalyses: BackupV13ImageAnalysisSectionRow[];
    imageAnalysisReviews: BackupV13ImageAnalysisReviewSectionRow[];
  };
}

export interface BackupV13V2Artifact extends Omit<BackupV13V1Artifact, "schemaVersion" | "sections"> {
  schemaVersion: "m13.v2";
  sections: {
    clients: BackupV13V2ClientSectionRow[];
    analyses: BackupV13AnalysisSectionRow[];
    imageAssets: BackupV13ImageAssetSectionRow[];
    imageAnalyses: BackupV13ImageAnalysisSectionRow[];
    imageAnalysisReviews: BackupV13ImageAnalysisReviewSectionRow[];
  };
}

export interface BackupV13V3Artifact extends Omit<BackupV13V2Artifact, "schemaVersion" | "counts" | "limits" | "sections"> {
  schemaVersion: "m13.v3";
  counts: BackupV13V2Artifact["counts"] & { consultations: number };
  limits: Omit<BackupV13V2Artifact["limits"], "maxRowsPerSection"> & {
    maxRowsPerSection: BackupV13V2Artifact["limits"]["maxRowsPerSection"] & { consultations: number };
  };
  sections: BackupV13V2Artifact["sections"] & {
    consultations: BackupV13V3ConsultationSectionRow[];
  };
}

export type BackupV13Artifact = BackupV13V1Artifact | BackupV13V2Artifact | BackupV13V3Artifact;

export interface BackupM15V1ImageAssetSectionRow extends Omit<BackupV13ImageAssetSectionRow, "storagePath"> {
  objectReference: M15V1ObjectReference;
  storageEtag: string | null;
  storageState: "pending_upload" | "available" | "delete_pending" | "deleted" | "quarantined";
  storageMigratedAt: string | null;
  objectDeletedAt: string | null;
  lastStorageErrorCode: string | null;
}

export interface BackupM15V1Artifact extends Omit<BackupV13V3Artifact, "schemaVersion" | "sections"> {
  schemaVersion: "m15.v1";
  sections: Omit<BackupV13V3Artifact["sections"], "imageAssets"> & {
    imageAssets: BackupM15V1ImageAssetSectionRow[];
  };
}

export interface BackupM15V2LegacyReference {
  backend: "local";
  rootAlias: "legacy-images";
  relativePath: string;
  contentSha256: string;
  sizeBytes: number;
}

export interface BackupM15V2ObjectReference {
  backend: "s3";
  bucketAlias: string;
  key: string;
  versionId: string;
  contentSha256: string;
  sizeBytes: number;
}

export interface BackupM15V2LegacyLocalImageAsset extends Omit<BackupV13ImageAssetSectionRow, "storagePath"> {
  storageKind: "legacy-local";
  legacyReference: BackupM15V2LegacyReference;
}

export interface BackupM15V2ObjectBackedImageAsset extends Omit<BackupV13ImageAssetSectionRow, "storagePath"> {
  storageKind: "object-backed";
  objectReference: BackupM15V2ObjectReference;
  storageEtag: string | null;
  storageState: "available" | "delete_pending";
  storageMigratedAt: string | null;
  objectDeletedAt: null;
  lastStorageErrorCode: string | null;
}

export type BackupM15V2ImageAssetSectionRow =
  | BackupM15V2LegacyLocalImageAsset
  | BackupM15V2ObjectBackedImageAsset;

export interface BackupM15V2Sections {
  clients: BackupV13V2ClientSectionRow[];
  analyses: BackupV13AnalysisSectionRow[];
  consultations: BackupV13V3ConsultationSectionRow[];
  imageAssets: BackupM15V2ImageAssetSectionRow[];
  imageAnalyses: BackupV13ImageAnalysisSectionRow[];
  imageAnalysisReviews: BackupV13ImageAnalysisReviewSectionRow[];
}

export interface BackupM15V2Artifact extends Omit<
  BackupV13V3Artifact,
  "schemaVersion" | "canonicalSerializationVersion" | "sections"
> {
  schemaVersion: "m15.v2";
  canonicalSerializationVersion: "sorted-json-v2";
  sections: BackupM15V2Sections;
}

export type BackupRecoveryArtifact = BackupV13Artifact | BackupM15V1Artifact | BackupM15V2Artifact;

export interface BackupVerificationResult {
  backupId: string;
  schemaVersion: string | null;
  checksumStatus: BackupVerifyChecksumStatus;
  artifactValidity: BackupVerifyArtifactValidity;
  externalReferenceStatus: BackupVerifyExternalReferenceStatus;
  recoveryArtifactStatus: BackupRecoveryArtifactStatus;
  reason: BackupVerifyReason | null;
  verifiedAt: string;
}

export interface RetentionRunResult {
  runId?: string;
  status?: "dry_run_completed" | "execution_completed" | "execution_failed";
  startedAt?: string;
  finishedAt?: string;
  replayed?: boolean;
  dryRun: boolean;
  olderThanDays: number;
  pushQueueAffected: number;
  auditEventsAffected: number;
}

export type WebhookEventType =
  | "image.analysis.ready_for_m8"
  | "image.analysis.failed"
  | "audit.security.detected"
  | "webhook.test.completed"
  | "webhook.secret.rotated";

export type WebhookEventSensitivity = "internal_low" | "internal_moderate" | "internal_high";

export type WebhookAllowedSubscriberType = "generic_webhook";

export interface WebhookEventCatalogEntry {
  eventType: WebhookEventType;
  schemaVersion: "1.0";
  dispatchEligible: boolean;
  auditOnly: boolean;
  sensitivity: WebhookEventSensitivity;
  allowedSubscriberTypes: WebhookAllowedSubscriberType[];
}

export interface WebhookEventEnvelope {
  schemaVersion: "1.0";
  eventId: string;
  eventType: WebhookEventType;
  occurredAt: string;
  ownerUserId: string;
  resource: {
    type: string;
    id: string;
  };
  data: Record<string, unknown>;
  meta: {
    dispatchEligible: boolean;
    auditOnly: boolean;
    sensitivity: WebhookEventSensitivity;
    allowedSubscriberTypes: WebhookAllowedSubscriberType[];
    producerIdempotencyKey?: string;
  };
}

export type WebhookDeliveryStatus =
  | "pending"
  | "dispatching"
  | "delivered"
  | "failed_retryable"
  | "failed_terminal"
  | "canceled";

export type WebhookAttemptOutcome = "success" | "retryable_failure" | "terminal_failure";

export type WebhookFailureDomain = "destination" | "security" | "configuration" | "platform_internal";

export type WebhookFailureCode =
  | "none"
  | "timeout"
  | "connection_refused"
  | "connection_reset"
  | "host_unreachable"
  | "network_unreachable"
  | "dns_temporary"
  | "dns_not_found"
  | "http_3xx_redirect_blocked"
  | "http_408"
  | "http_425"
  | "http_429"
  | "http_5xx"
  | "http_4xx_non_retryable"
  | "ssrf_blocked"
  | "tls_certificate_error"
  | "invalid_url"
  | "endpoint_disabled"
  | "endpoint_deleted"
  | "internal_transient"
  | "internal_persistent";

export interface WebhookRetryClassification {
  deliveryStatus: Extract<WebhookDeliveryStatus, "delivered" | "failed_retryable" | "failed_terminal">;
  outcome: WebhookAttemptOutcome;
  failureDomain: WebhookFailureDomain | null;
  failureCode: WebhookFailureCode;
  usesConnectivityCap: boolean;
}
