import { randomUUID } from "node:crypto";

import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";

import { appConfig, assertGoogleOAuthConfig } from "@/lib/config";
import { decryptString, encryptString, makeOAuthState, verifyOAuthState } from "@/lib/crypto";
import { getOAuthToken, upsertOAuthToken } from "@/lib/db";

export const googleScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

const getOAuthClient = () => {
  assertGoogleOAuthConfig();
  return new google.auth.OAuth2(
    appConfig.googleClientId,
    appConfig.googleClientSecret,
    appConfig.googleRedirectUri,
  );
};

export const getGoogleAuthUrl = () => {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: googleScopes,
    state: makeOAuthState(),
  });
};

export const completeGoogleOAuth = async (code: string, state: string | null) => {
  if (!verifyOAuthState(state)) {
    throw new Error("Invalid OAuth state.");
  }

  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email;
  if (!email) throw new Error("Google did not return an email for the owner account.");
  if (email.toLowerCase() !== appConfig.ownerEmail.toLowerCase()) {
    throw new Error(`Expected ${appConfig.ownerEmail}, got ${email}.`);
  }
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token. Revoke app access and reconnect.");
  }

  upsertOAuthToken({
    provider: "google",
    email,
    access_token: tokens.access_token ? encryptString(tokens.access_token) : null,
    refresh_token: encryptString(tokens.refresh_token),
    scope: tokens.scope ?? googleScopes.join(" "),
    expiry_date: tokens.expiry_date ?? null,
  });

  return email;
};

export const getGoogleConnectionStatus = () => {
  const token = getOAuthToken();
  return {
    connected: Boolean(token?.refresh_token),
    email: token?.email,
    updatedAt: token?.updated_at,
  };
};

const getAuthorizedOAuthClient = () => {
  const stored = getOAuthToken();
  if (!stored?.refresh_token) {
    throw new Error("Google Calendar is not connected.");
  }

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: decryptString(stored.access_token),
    refresh_token: decryptString(stored.refresh_token),
    scope: stored.scope ?? undefined,
    expiry_date: stored.expiry_date ?? undefined,
  });

  oauth2Client.on("tokens", (tokens) => {
    upsertOAuthToken({
      provider: "google",
      email: stored.email,
      access_token: tokens.access_token ? encryptString(tokens.access_token) : null,
      refresh_token: tokens.refresh_token ? encryptString(tokens.refresh_token) : null,
      scope: tokens.scope ?? stored.scope,
      expiry_date: tokens.expiry_date ?? stored.expiry_date,
    });
  });

  return oauth2Client;
};

const getCalendarClient = () => {
  return google.calendar({ version: "v3", auth: getAuthorizedOAuthClient() });
};

export type BusyInterval = {
  start: string;
  end: string;
};

export const fetchGoogleBusy = async (timeMin: string, timeMax: string) => {
  const calendar = getCalendarClient();
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      timeZone: "UTC",
      items: [{ id: appConfig.googleCalendarId }],
    },
  });

  const calendarBusy = response.data.calendars?.[appConfig.googleCalendarId];
  if (calendarBusy?.errors?.length) {
    const reason = calendarBusy.errors.map((error) => error.reason).join(", ");
    throw new Error(`Google FreeBusy failed: ${reason}`);
  }

  return (calendarBusy?.busy ?? [])
    .filter((busy): busy is BusyInterval => Boolean(busy.start && busy.end))
    .map((busy) => ({ start: busy.start!, end: busy.end! }));
};

export const insertCalendarEvent = async (input: {
  summary: string;
  description: string;
  inviteeName: string;
  inviteeEmail: string;
  start: string;
  end: string;
  timeZone: string;
}) => {
  const calendar = getCalendarClient();
  const requestBody: calendar_v3.Schema$Event = {
    summary: input.summary,
    description: input.description,
    location: appConfig.eventLocation,
    start: {
      dateTime: input.start,
      timeZone: input.timeZone,
    },
    end: {
      dateTime: input.end,
      timeZone: input.timeZone,
    },
    attendees: [
      {
        email: input.inviteeEmail,
        displayName: input.inviteeName,
      },
    ],
  };

  if (appConfig.enableGoogleMeet) {
    requestBody.conferenceData = {
      createRequest: {
        requestId: `openmeet-${randomUUID()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const runInsert = (body: calendar_v3.Schema$Event) =>
    calendar.events.insert({
      calendarId: appConfig.googleCalendarId,
      conferenceDataVersion: appConfig.enableGoogleMeet ? 1 : 0,
      sendUpdates: "all",
      requestBody: body,
    });

  try {
    const event = await runInsert(requestBody);
    return normalizeEvent(event.data);
  } catch (error) {
    if (!appConfig.enableGoogleMeet) throw error;
    const fallbackBody = { ...requestBody };
    delete fallbackBody.conferenceData;
    const event = await runInsert(fallbackBody);
    return normalizeEvent(event.data);
  }
};

export const deleteCalendarEvent = async (eventId: string) => {
  const calendar = getCalendarClient();
  await calendar.events.delete({
    calendarId: appConfig.googleCalendarId,
    eventId,
    sendUpdates: "all",
  });
};

const normalizeEvent = (event: calendar_v3.Schema$Event) => {
  if (!event.id) throw new Error("Google Calendar did not return an event id.");
  const videoEntry = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video",
  );
  return {
    id: event.id,
    htmlLink: event.htmlLink ?? undefined,
    meetUrl: event.hangoutLink ?? videoEntry?.uri ?? undefined,
  };
};
