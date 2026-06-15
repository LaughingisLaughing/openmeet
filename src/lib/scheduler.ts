import { DateTime, Interval } from "luxon";
import { nanoid } from "nanoid";

import type {
  AvailabilityDay,
  AvailabilityResponse,
  BookRequest,
  BookResponse,
  Slot,
} from "@/contracts/types";
import { appConfig } from "@/lib/config";
import {
  cancelBooking,
  confirmBooking,
  createPendingBooking,
  expireStalePendingBookings,
  failBooking,
  getBookingByToken,
  listActiveBookingsBetween,
  markCancelPending,
} from "@/lib/db";
import { deleteCalendarEvent, fetchGoogleBusy, getGoogleConnectionStatus, insertCalendarEvent } from "@/lib/google";

type IntervalLike = {
  start: DateTime;
  end: DateTime;
};

export class SchedulerError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const toUtcIso = (dateTime: DateTime) => {
  return dateTime.toUTC().toISO({ suppressMilliseconds: true });
};

const assertIso = (value: string | null): string => {
  if (!value) throw new SchedulerError("invalid_date", "Invalid date.");
  return value;
};

const overlaps = (a: IntervalLike, b: IntervalLike) => {
  return a.start < b.end && a.end > b.start;
};

const parseViewerZone = (timeZone?: string | null) => {
  const zone = timeZone || appConfig.ownerTimeZone;
  if (!DateTime.local().setZone(zone).isValid) return appConfig.ownerTimeZone;
  return zone;
};

const parseTimeOnDay = (date: DateTime, time: string) => {
  const [hour, minute] = time.split(":").map((part) => Number.parseInt(part, 10));
  return date.set({ hour, minute, second: 0, millisecond: 0 });
};

const formatSlotLabel = (slot: DateTime, viewerTimeZone: string) => {
  return slot.setZone(viewerTimeZone).toFormat("HH:mm");
};

const formatOwnerLabel = (slot: DateTime) => {
  return slot.setZone(appConfig.ownerTimeZone).toFormat("ccc HH:mm");
};

const formatDay = (date: DateTime) => {
  return {
    date: date.toISODate()!,
    label: date.toFormat("LLL d"),
    weekday: date.toFormat("ccc"),
  };
};

const getWindow = () => {
  const now = DateTime.utc();
  const earliest = now.plus({ minutes: appConfig.minimumNoticeMinutes });
  const ownerToday = now.setZone(appConfig.ownerTimeZone).startOf("day");
  const windowEnd = ownerToday
    .plus({ days: appConfig.bookingWindowDays + 1 })
    .endOf("day")
    .toUTC();
  return { now, earliest, ownerToday, windowEnd };
};

const generateCandidates = () => {
  const { earliest, ownerToday } = getWindow();
  const candidates: IntervalLike[] = [];
  for (let dayOffset = 0; dayOffset < appConfig.bookingWindowDays; dayOffset += 1) {
    const ownerDay = ownerToday.plus({ days: dayOffset });
    const matchingRules = appConfig.availability.filter((rule) =>
      rule.days.includes(ownerDay.weekday),
    );

    for (const rule of matchingRules) {
      const ruleStart = parseTimeOnDay(ownerDay, rule.start);
      const ruleEnd = parseTimeOnDay(ownerDay, rule.end);
      let cursor = ruleStart;
      while (cursor.plus({ minutes: appConfig.eventDurationMinutes }) <= ruleEnd) {
        const start = cursor.toUTC();
        const end = cursor.plus({ minutes: appConfig.eventDurationMinutes }).toUTC();
        if (start >= earliest) candidates.push({ start, end });
        cursor = cursor.plus({ minutes: appConfig.slotStepMinutes });
      }
    }
  }
  return candidates;
};

const getBusyIntervals = async (
  rangeStart: DateTime,
  rangeEnd: DateTime,
  excludeBookingId?: string,
) => {
  expireStalePendingBookings();
  const googleBusy = await fetchGoogleBusy(
    assertIso(toUtcIso(rangeStart)),
    assertIso(toUtcIso(rangeEnd)),
  );
  const localBusy = listActiveBookingsBetween(
    assertIso(toUtcIso(rangeStart)),
    assertIso(toUtcIso(rangeEnd)),
    excludeBookingId,
  );

  return [
    ...googleBusy.map((busy) => ({
      start: DateTime.fromISO(busy.start, { zone: "utc" }),
      end: DateTime.fromISO(busy.end, { zone: "utc" }),
    })),
    ...localBusy.map((booking) => ({
      start: DateTime.fromISO(booking.start_utc, { zone: "utc" }),
      end: DateTime.fromISO(booking.end_utc, { zone: "utc" }),
    })),
  ];
};

export const getAvailability = async (viewerTimeZone?: string | null): Promise<AvailabilityResponse> => {
  const connected = getGoogleConnectionStatus().connected;
  const viewerZone = parseViewerZone(viewerTimeZone);
  const baseResponse = {
    connected,
    owner: {
      name: appConfig.ownerName,
      email: appConfig.ownerEmail,
      timeZone: appConfig.ownerTimeZone,
    },
    event: {
      title: appConfig.eventTitle,
      durationMinutes: appConfig.eventDurationMinutes,
      bufferMinutes: appConfig.bufferMinutes,
      bookingWindowDays: appConfig.bookingWindowDays,
    },
    viewerTimeZone: viewerZone,
  };

  if (!connected) {
    return { ...baseResponse, days: [], error: "Google Calendar is not connected." };
  }

  const candidates = generateCandidates();
  if (candidates.length === 0) return { ...baseResponse, days: [] };

  const rangeStart = candidates[0]!.start.minus({ minutes: appConfig.bufferMinutes });
  const rangeEnd = candidates[candidates.length - 1]!.end.plus({
    minutes: appConfig.bufferMinutes,
  });
  const busyIntervals = await getBusyIntervals(rangeStart, rangeEnd);

  const slots = candidates.filter((candidate) => {
    const padded = {
      start: candidate.start.minus({ minutes: appConfig.bufferMinutes }),
      end: candidate.end.plus({ minutes: appConfig.bufferMinutes }),
    };
    return !busyIntervals.some((busy) => overlaps(padded, busy));
  });

  const grouped = new Map<string, AvailabilityDay>();
  for (const slot of slots) {
    const viewerStart = slot.start.setZone(viewerZone);
    const viewerEnd = slot.end.setZone(viewerZone);
    const key = viewerStart.toISODate()!;
    const day = grouped.get(key) ?? {
      ...formatDay(viewerStart.startOf("day")),
      slots: [],
    };
    day.slots.push({
      start: assertIso(toUtcIso(slot.start)),
      end: assertIso(toUtcIso(slot.end)),
      label: `${formatSlotLabel(slot.start, viewerZone)} - ${formatSlotLabel(slot.end, viewerZone)}`,
      ownerLabel: formatOwnerLabel(slot.start),
    });
    grouped.set(key, day);
  }

  return {
    ...baseResponse,
    days: [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
};

const staticCandidateExists = (startUtc: string) => {
  return generateCandidates().some((candidate) => assertIso(toUtcIso(candidate.start)) === startUtc);
};

const assertNoConflictAfterLock = async (
  start: DateTime,
  end: DateTime,
  bookingId: string,
) => {
  const padded = {
    start: start.minus({ minutes: appConfig.bufferMinutes }),
    end: end.plus({ minutes: appConfig.bufferMinutes }),
  };
  const busy = await getBusyIntervals(padded.start, padded.end, bookingId);
  if (busy.some((interval) => overlaps(padded, interval))) {
    throw new SchedulerError("slot_unavailable", "That time is no longer available.", 409);
  }
};

const buildCancelUrl = (token: string) => {
  return `${appConfig.appBaseUrl.replace(/\/$/, "")}/cancel/${token}`;
};

export const bookSlot = async (request: BookRequest): Promise<BookResponse> => {
  const requestedStart = DateTime.fromISO(request.start, { zone: "utc" });
  if (!requestedStart.isValid) {
    throw new SchedulerError("invalid_start", "Choose a valid time.");
  }

  const startUtc = assertIso(toUtcIso(requestedStart));
  if (!getGoogleConnectionStatus().connected) {
    throw new SchedulerError("calendar_not_connected", "Google Calendar is not connected.", 503);
  }
  if (!staticCandidateExists(startUtc)) {
    throw new SchedulerError("outside_availability", "Choose one of the available times.", 409);
  }

  const endUtcDate = requestedStart.plus({ minutes: appConfig.eventDurationMinutes });
  const endUtc = assertIso(toUtcIso(endUtcDate));
  const bookingId = nanoid(14);
  const cancelToken = nanoid(32);
  const cancelUrl = buildCancelUrl(cancelToken);

  try {
    createPendingBooking({
      id: bookingId,
      inviteeName: request.name.trim(),
      inviteeEmail: request.email.trim().toLowerCase(),
      note: request.note?.trim(),
      startUtc,
      endUtc,
      timeZone: parseViewerZone(request.timeZone),
      cancelToken,
    });
  } catch (error) {
    throw new SchedulerError(
      "slot_taken",
      "Someone just booked that time. Pick another slot.",
      409,
    );
  }

  try {
    await assertNoConflictAfterLock(requestedStart, endUtcDate, bookingId);
  } catch (error) {
    failBooking(bookingId);
    throw error;
  }

  const ownerStart = requestedStart.setZone(appConfig.ownerTimeZone);
  const ownerEnd = endUtcDate.setZone(appConfig.ownerTimeZone);

  try {
    const event = await insertCalendarEvent({
      summary: `${appConfig.eventTitle} with ${request.name.trim()}`,
      description: [
        `Booked through OpenMeet.`,
        `Invitee: ${request.name.trim()} <${request.email.trim().toLowerCase()}>`,
        request.note?.trim() ? `Note: ${request.note.trim()}` : undefined,
        `Cancel: ${cancelUrl}`,
      ]
        .filter(Boolean)
        .join("\n"),
      inviteeName: request.name.trim(),
      inviteeEmail: request.email.trim().toLowerCase(),
      start: ownerStart.toISO({ suppressMilliseconds: true })!,
      end: ownerEnd.toISO({ suppressMilliseconds: true })!,
      timeZone: appConfig.ownerTimeZone,
    });

    confirmBooking({
      id: bookingId,
      calendarEventId: event.id,
      meetUrl: event.meetUrl,
    });

    const viewerZone = parseViewerZone(request.timeZone);
    const displayStart = requestedStart.setZone(viewerZone).toFormat("ccc, LLL d, HH:mm");
    const displayEnd = endUtcDate.setZone(viewerZone).toFormat("HH:mm ZZZZ");

    return {
      booking: {
        id: bookingId,
        status: "confirmed",
        start: startUtc,
        end: endUtc,
        displayStart,
        displayEnd,
        cancelUrl,
        meetUrl: event.meetUrl,
      },
    };
  } catch (error) {
    failBooking(bookingId);
    throw error;
  }
};

export const cancelBookingByToken = async (token: string) => {
  const booking = getBookingByToken(token);
  if (!booking) {
    throw new SchedulerError("not_found", "Booking not found.", 404);
  }
  if (booking.status === "canceled") {
    return { booking: { id: booking.id, status: "canceled" as const } };
  }
  if (
    booking.status !== "confirmed" &&
    booking.status !== "pending" &&
    booking.status !== "cancel_pending"
  ) {
    throw new SchedulerError("not_cancelable", "This booking can no longer be canceled.", 409);
  }

  if (booking.status !== "cancel_pending") {
    markCancelPending(booking.id);
  }
  if (booking.calendar_event_id) {
    await deleteCalendarEvent(booking.calendar_event_id);
  }
  cancelBooking(booking.id);
  return { booking: { id: booking.id, status: "canceled" as const } };
};

export const describeSlot = (slot: Slot, timeZone: string) => {
  const start = DateTime.fromISO(slot.start, { zone: "utc" }).setZone(timeZone);
  const end = DateTime.fromISO(slot.end, { zone: "utc" }).setZone(timeZone);
  const interval = Interval.fromDateTimes(start, end);
  return interval.toFormat("ccc, LLL d, HH:mm");
};
