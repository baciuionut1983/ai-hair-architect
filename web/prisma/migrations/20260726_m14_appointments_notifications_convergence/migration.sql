DO $$
BEGIN
  IF to_regclass('"Appointment"') IS NOT NULL THEN
    RAISE EXCEPTION 'M14_APPOINTMENT_TABLE_ALREADY_EXISTS';
  END IF;

  IF to_regclass('"Notification"') IS NOT NULL THEN
    RAISE EXCEPTION 'M14_NOTIFICATION_TABLE_ALREADY_EXISTS';
  END IF;

  IF to_regtype('"AppointmentReminderType"') IS NOT NULL THEN
    RAISE EXCEPTION 'M14_APPOINTMENT_REMINDER_TYPE_ALREADY_EXISTS';
  END IF;

  IF to_regtype('"NotificationType"') IS NOT NULL THEN
    RAISE EXCEPTION 'M14_NOTIFICATION_TYPE_ALREADY_EXISTS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"Client"'::regclass
      AND conname = 'Client_id_ownerUserId_key'
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'M14_CLIENT_CANDIDATE_KEY_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Client"
    GROUP BY "id", "ownerUserId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'M14_CLIENT_CANDIDATE_KEY_PREFLIGHT_FAILED';
  END IF;
END $$;

CREATE TYPE "AppointmentReminderType" AS ENUM (
  'appointment',
  'follow_up',
  'maintenance'
);

CREATE TYPE "NotificationType" AS ENUM (
  'appointment',
  'follow_up',
  'maintenance'
);

CREATE TABLE "Appointment" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "startsAt" TIMESTAMP(6) NOT NULL,
  "reminderMinutesBefore" INTEGER NOT NULL DEFAULT 1440,
  "reminderType" "AppointmentReminderType" NOT NULL,
  "reminderSentAt" TIMESTAMP(6),
  "notes" VARCHAR(4000) NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) NOT NULL,

  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Appointment_id_ownerUserId_clientId_key" UNIQUE ("id", "ownerUserId", "clientId"),
  CONSTRAINT "Appointment_reminderMinutesBefore_check"
    CHECK ("reminderMinutesBefore" BETWEEN 1 AND 525600),
  CONSTRAINT "Appointment_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Appointment_clientId_ownerUserId_fkey"
    FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Appointment_ownerUserId_startsAt_id_idx"
  ON "Appointment"("ownerUserId", "startsAt", "id");

CREATE INDEX "Appointment_ownerUserId_clientId_startsAt_id_idx"
  ON "Appointment"("ownerUserId", "clientId", "startsAt", "id");

CREATE INDEX "Appointment_ownerUserId_reminderSentAt_startsAt_id_idx"
  ON "Appointment"("ownerUserId", "reminderSentAt", "startsAt", "id");

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "message" VARCHAR(1000) NOT NULL,
  "relatedClientId" TEXT NOT NULL,
  "relatedAppointmentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(6),

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_relatedAppointmentId_ownerUserId_type_key"
    UNIQUE ("relatedAppointmentId", "ownerUserId", "type"),
  CONSTRAINT "Notification_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Notification_relatedAppointmentId_ownerUserId_relatedClientId_fkey"
    FOREIGN KEY ("relatedAppointmentId", "ownerUserId", "relatedClientId")
    REFERENCES "Appointment"("id", "ownerUserId", "clientId")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Notification_ownerUserId_createdAt_id_idx"
  ON "Notification"("ownerUserId", "createdAt", "id");

CREATE INDEX "Notification_ownerUserId_readAt_createdAt_id_idx"
  ON "Notification"("ownerUserId", "readAt", "createdAt", "id");
