import path from "node:path";
import { z } from "zod";

import type { AvailabilityRule } from "@/contracts/types";

const intFromEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolFromEnv = (name: string, fallback: boolean) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
};

const availabilityRuleSchema = z.object({
  days: z.array(z.number().int().min(1).max(7)).min(1),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const defaultAvailability: AvailabilityRule[] = [
  { days: [1, 2, 3, 4, 5], start: "10:00", end: "18:30" },
];

const parseAvailability = (): AvailabilityRule[] => {
  const raw = process.env.AVAILABILITY_JSON;
  if (!raw) return defaultAvailability;
  try {
    return z.array(availabilityRuleSchema).parse(JSON.parse(raw));
  } catch (error) {
    console.warn("Invalid AVAILABILITY_JSON; using default availability.", error);
    return defaultAvailability;
  }
};

export const appConfig = {
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  ownerEmail: process.env.OWNER_EMAIL ?? "",
  ownerName: process.env.OWNER_NAME ?? "Calendar Owner",
  ownerTimeZone: process.env.OWNER_TIME_ZONE ?? "Asia/Shanghai",
  googleCalendarId:
    process.env.GOOGLE_CALENDAR_ID ??
    process.env.OWNER_EMAIL ??
    "primary",
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ??
    `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/admin/google/callback`,
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
  adminSecret: process.env.ADMIN_SECRET,
  eventTitle: process.env.EVENT_TITLE ?? "Intro Call",
  eventLocation: process.env.EVENT_LOCATION ?? "Google Meet",
  eventDurationMinutes: intFromEnv("EVENT_DURATION_MINUTES", 30),
  bufferMinutes: intFromEnv("BUFFER_MINUTES", 10),
  slotStepMinutes: intFromEnv("SLOT_STEP_MINUTES", intFromEnv("EVENT_DURATION_MINUTES", 30)),
  bookingWindowDays: intFromEnv("BOOKING_WINDOW_DAYS", 14),
  minimumNoticeMinutes: intFromEnv("MINIMUM_NOTICE_MINUTES", 120),
  enableGoogleMeet: boolFromEnv("ENABLE_GOOGLE_MEET", true),
  databasePath:
    process.env.DATABASE_PATH ??
    path.join(process.cwd(), "data", "openmeet.db"),
  availability: parseAvailability(),
};

export const getSetupIssues = () => {
  const issues: string[] = [];
  if (!appConfig.ownerEmail) issues.push("OWNER_EMAIL is missing");
  if (!appConfig.googleClientId) issues.push("GOOGLE_CLIENT_ID is missing");
  if (!appConfig.googleClientSecret) issues.push("GOOGLE_CLIENT_SECRET is missing");
  if (!appConfig.tokenEncryptionKey) issues.push("TOKEN_ENCRYPTION_KEY is missing");
  if (!appConfig.adminSecret) issues.push("ADMIN_SECRET is missing");
  return issues;
};

export const assertGoogleOAuthConfig = () => {
  const issues = getSetupIssues().filter((issue) =>
    issue.startsWith("OWNER_") ||
    issue.startsWith("GOOGLE_") ||
    issue.startsWith("TOKEN_") ||
    issue.startsWith("ADMIN_"),
  );
  if (issues.length > 0) {
    throw new Error(`Google OAuth setup incomplete: ${issues.join(", ")}`);
  }
};

export const assertTokenEncryptionConfig = () => {
  if (!appConfig.tokenEncryptionKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required before storing Google tokens.");
  }
};
