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
}

export interface AnalysisClarifyRequest {
  answers: string[];
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

export type VideoLessonStatus = "queued" | "processing" | "completed" | "failed";

export interface VideoLessonRecord {
  id: string;
  ownerUserId: string;
  topic: string;
  level: "beginner" | "intermediate" | "advanced";
  locale: Locale;
  status: VideoLessonStatus;
  recommendedLessonIds: string[];
  script: string;
  videoUrl: string;
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
  usersCount: number;
  clientsCount: number;
  consultationsCount: number;
  appointmentsCount: number;
  notificationsCount: number;
  queueBacklogCount: number;
  auditEventsCount: number;
}

export interface BackupSnapshotRecord {
  id: string;
  ownerUserId: string;
  label: string;
  createdAt: string;
  snapshot: {
    clientsCount: number;
    consultationsCount: number;
    appointmentsCount: number;
    notificationsCount: number;
    workspacesCount: number;
  };
}

export interface RetentionRunResult {
  dryRun: boolean;
  olderThanDays: number;
  pushQueueAffected: number;
  auditEventsAffected: number;
}
