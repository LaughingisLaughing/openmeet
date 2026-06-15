"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Globe2,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  User,
} from "lucide-react";

import type {
  AvailabilityDay,
  AvailabilityResponse,
  BookResponse,
  Slot,
} from "@/contracts/types";

type FormState = {
  name: string;
  email: string;
  note: string;
};

const initialForm: FormState = {
  name: "",
  email: "",
  note: "",
};

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const getDateParts = (date: string) => {
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  return { year, month, day };
};

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildMonthGrid = (monthKey: string) => {
  if (!monthKey) return [];
  const [year, month] = monthKey.split("-").map((part) => Number.parseInt(part, 10));
  const first = new Date(year, month - 1, 1);
  const gridStart = new Date(first);
  const mondayOffset = (first.getDay() + 6) % 7;
  gridStart.setDate(first.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      date: toIsoDate(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month - 1,
    };
  });
};

const getMonthLabel = (monthKey: string) => {
  if (!monthKey) return "No availability";
  const [year, month] = monthKey.split("-").map((part) => Number.parseInt(part, 10));
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
};

const getMonthKey = (date: string) => date.slice(0, 7);

const getReadableDate = (day?: AvailabilityDay) => {
  if (!day) return "Pick a date";
  const { year, month, day: dateDay } = getDateParts(day.date);
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, dateDay));
};

const getSlotStartLabel = (slot: Slot) => slot.label.split(" - ")[0] ?? slot.label;

export function BookingApp() {
  const [timeZone, setTimeZone] = useState("Asia/Shanghai");
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [selectedDay, setSelectedDay] = useState("");
  const [visibleMonth, setVisibleMonth] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState<BookResponse["booking"] | null>(null);

  const activeDay = useMemo(() => {
    return availability?.days.find((day) => day.date === selectedDay) ?? availability?.days[0];
  }, [availability, selectedDay]);

  const availableDayMap = useMemo(() => {
    return new Map((availability?.days ?? []).map((day) => [day.date, day]));
  }, [availability]);

  const availableMonths = useMemo(() => {
    return [...new Set((availability?.days ?? []).map((day) => getMonthKey(day.date)))];
  }, [availability]);

  const monthGrid = useMemo(() => {
    return buildMonthGrid(visibleMonth || selectedDay.slice(0, 7));
  }, [selectedDay, visibleMonth]);

  const currentMonthIndex = availableMonths.indexOf(visibleMonth);

  const loadAvailability = async (zone = timeZone) => {
    setLoading(true);
    setError("");
    setBooking(null);
    try {
      const response = await fetch(`/api/availability?timezone=${encodeURIComponent(zone)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as AvailabilityResponse;
      setAvailability(payload);
      const firstDayWithSlots = payload.days.find((day) => day.slots.length > 0);
      setSelectedDay(firstDayWithSlots?.date ?? payload.days[0]?.date ?? "");
      setVisibleMonth(getMonthKey(firstDayWithSlots?.date ?? payload.days[0]?.date ?? ""));
      setSelectedSlot(null);
    } catch (requestError) {
      setError("Could not load availability.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
    setTimeZone(detectedTimeZone);
    void loadAvailability(detectedTimeZone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseDay = (day: AvailabilityDay) => {
    setSelectedDay(day.date);
    setVisibleMonth(getMonthKey(day.date));
    setSelectedSlot(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSlot) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          start: selectedSlot.start,
          name: form.name,
          email: form.email,
          note: form.note,
          timeZone,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error?.message ?? "Could not book this slot.");
        await loadAvailability(timeZone);
        return;
      }
      setBooking((payload as BookResponse).booking);
    } catch (requestError) {
      setError("Could not book this slot.");
    } finally {
      setSubmitting(false);
    }
  };

  const event = availability?.event;
  const owner = availability?.owner;

  return (
    <main className="booking-shell">
      <section className="profile-panel" aria-label="Meeting details">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            L
          </div>
          <div>
            <p className="eyebrow">OpenMeet</p>
            <h1>Book time with Laughing</h1>
          </div>
        </div>

        <div className="detail-stack">
          <div className="detail-row">
            <CalendarDays size={18} aria-hidden="true" />
            <span>{event?.title ?? "Intro Call"}</span>
          </div>
          <div className="detail-row">
            <Clock3 size={18} aria-hidden="true" />
            <span>{event?.durationMinutes ?? 30} min</span>
          </div>
          <div className="detail-row">
            <Globe2 size={18} aria-hidden="true" />
            <span>{timeZone}</span>
          </div>
          <div className="detail-row">
            <Mail size={18} aria-hidden="true" />
            <span>{owner?.email || "you@example.com"}</span>
          </div>
        </div>

        <button
          type="button"
          className="ghost-button"
          onClick={() => loadAvailability(timeZone)}
          disabled={loading}
          title="Refresh availability"
        >
          <RefreshCw size={17} className={loading ? "spin" : ""} aria-hidden="true" />
          Refresh
        </button>
      </section>

      <section className="booking-panel" aria-live="polite">
        {booking ? (
          <div className="done-state">
            <CheckCircle2 size={34} aria-hidden="true" />
            <h2>Booked</h2>
            <p>
              {booking.displayStart} - {booking.displayEnd}
            </p>
            {booking.meetUrl ? (
              <a href={booking.meetUrl} target="_blank" rel="noreferrer">
                Open Meet
              </a>
            ) : null}
            <a href={booking.cancelUrl}>Cancel link</a>
          </div>
        ) : loading ? (
          <div className="loading-state">
            <Loader2 size={28} className="spin" aria-hidden="true" />
            <span>Loading availability</span>
          </div>
        ) : availability && !availability.connected ? (
          <div className="setup-state">
            <h2>Calendar setup needed</h2>
            <p>{availability.error}</p>
            <a href="/admin">Open admin</a>
          </div>
        ) : (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Select date and time</p>
                <h2>{getReadableDate(activeDay)}</h2>
              </div>
              <span>{activeDay?.slots.length ?? 0} times</span>
            </div>

            <div className="scheduler-layout">
              <div className="calendar-pane" aria-label="Available dates">
                <div className="calendar-header">
                  <h3>{getMonthLabel(visibleMonth || getMonthKey(activeDay?.date ?? ""))}</h3>
                  <div className="month-controls">
                    <button
                      type="button"
                      aria-label="Previous month"
                      disabled={currentMonthIndex <= 0}
                      onClick={() => setVisibleMonth(availableMonths[currentMonthIndex - 1])}
                    >
                      <ChevronLeft size={18} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next month"
                      disabled={currentMonthIndex === -1 || currentMonthIndex >= availableMonths.length - 1}
                      onClick={() => setVisibleMonth(availableMonths[currentMonthIndex + 1])}
                    >
                      <ChevronRight size={18} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="weekday-row" aria-hidden="true">
                  {weekdayLabels.map((weekday) => (
                    <span key={weekday}>{weekday}</span>
                  ))}
                </div>

                <div className="month-grid">
                  {monthGrid.map((cell) => {
                    const day = availableDayMap.get(cell.date);
                    const available = Boolean(day?.slots.length);
                    const selected = cell.date === activeDay?.date;
                    return (
                      <button
                        key={cell.date}
                        type="button"
                        disabled={!available}
                        className={[
                          cell.inMonth ? "" : "outside-month",
                          available ? "available" : "",
                          selected ? "selected" : "",
                        ].join(" ")}
                        onClick={() => day && chooseDay(day)}
                        aria-label={available ? `${cell.date}, ${day!.slots.length} times` : `${cell.date}, unavailable`}
                        aria-pressed={selected}
                      >
                        {cell.day}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="times-pane" aria-label="Available times">
                <div className="times-heading">
                  <span>{activeDay ? `${activeDay.weekday}, ${activeDay.label}` : "No date selected"}</span>
                  <small>{timeZone}</small>
                </div>

                <div className="time-list">
                  {activeDay?.slots.map((slot) => (
                    <button
                      key={slot.start}
                      type="button"
                      className={selectedSlot?.start === slot.start ? "selected" : ""}
                      onClick={() => setSelectedSlot(slot)}
                      title={`Owner time: ${slot.ownerLabel}`}
                      aria-pressed={selectedSlot?.start === slot.start}
                    >
                      <span>{getSlotStartLabel(slot)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {selectedSlot ? (
              <form className="booking-form booking-form-revealed" onSubmit={submit}>
                <div className="selected-time-summary wide">
                  <Clock3 size={17} aria-hidden="true" />
                  <span>{selectedSlot.label}</span>
                  <small>{getReadableDate(activeDay)}</small>
                </div>
                <label>
                  <span>
                    <User size={16} aria-hidden="true" />
                    Name
                  </span>
                  <input
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    required
                    maxLength={120}
                    autoComplete="name"
                  />
                </label>
                <label>
                  <span>
                    <Mail size={16} aria-hidden="true" />
                    Email
                  </span>
                  <input
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                    required
                    maxLength={200}
                    type="email"
                    autoComplete="email"
                  />
                </label>
                <label className="wide">
                  <span>
                    <MessageSquare size={16} aria-hidden="true" />
                    Note
                  </span>
                  <textarea
                    value={form.note}
                    onChange={(event) => setForm({ ...form, note: event.target.value })}
                    maxLength={1000}
                    rows={3}
                  />
                </label>

                {error ? <p className="error-text wide">{error}</p> : null}

                <button
                  type="submit"
                  className="primary-button wide"
                  disabled={submitting}
                >
                  {submitting ? <Loader2 size={18} className="spin" aria-hidden="true" /> : null}
                  Confirm
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </form>
            ) : (
              <p className="select-time-hint">Choose a time to enter your details.</p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
