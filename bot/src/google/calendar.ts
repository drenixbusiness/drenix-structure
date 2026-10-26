/**
 * Minimal Google Calendar REST client (primary calendar of the connected account).
 * The refresh token is stored encrypted in the settings table.
 */
import { config } from "../config.js";
import { decrypt, encrypt } from "../crypto.js";
import { getSetting, setSetting } from "../db.js";
import { TZ_NAME } from "../time.js";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",
  "openid",
  "email",
];
const TOKEN_KEY = "google_token";
const API = "https://www.googleapis.com/calendar/v3";

interface StoredToken {
  refresh_token: string;
  access_token?: string;
  expires_at?: number; // ms
  email?: string;
  scope?: string;
}

export class GoogleError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

function load(): StoredToken | null {
  const raw = getSetting(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(decrypt(raw)) as StoredToken;
  } catch {
    return null;
  }
}
const save = (t: StoredToken) => setSetting(TOKEN_KEY, encrypt(JSON.stringify(t)));

export const googleConnected = () => !!load();
export const googleEmail = () => load()?.email ?? null;
/** Tokens saved before Sheets was added carry no scope field → treated as calendar-only. */
export const sheetsGranted = () => !!load()?.scope?.includes("auth/spreadsheets");
export const formsGranted = () => !!load()?.scope?.includes("auth/forms.body");

/** Called by the auth CLI after the consent screen. */
export async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const j = (await res.json()) as { refresh_token?: string; access_token?: string; expires_in?: number; id_token?: string; scope?: string; error_description?: string };
  if (!res.ok || !j.refresh_token) throw new GoogleError(j.error_description || "No refresh token returned (remove the app at myaccount.google.com/permissions and retry)");
  // Google's consent screen lets the user untick the calendar checkbox
  if (!j.scope?.includes("auth/calendar")) {
    throw new GoogleError('Calendar access was not granted. Run again and TICK the "See, edit, share and permanently delete all the calendars…" checkbox on the consent screen.');
  }
  let email: string | undefined;
  if (j.id_token) {
    try {
      email = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email;
    } catch {
      /* ignore */
    }
  }
  if (!j.scope.includes("auth/spreadsheets")) console.warn('Google Sheets access was not granted (tick the "See, edit, create and delete all your Google Sheets spreadsheets" checkbox to enable it).');
  if (!j.scope.includes("auth/forms.body")) console.warn('Google Forms access was not granted (tick the "See, edit, create and delete all your Google Forms forms" checkbox to enable it).');
  save({ refresh_token: j.refresh_token, access_token: j.access_token, expires_at: Date.now() + (j.expires_in ?? 0) * 1000, email, scope: j.scope });
  return email ?? null;
}

export async function accessToken(): Promise<string> {
  const t = load();
  if (!t) throw new GoogleError("Google Calendar is not connected");
  if (t.access_token && t.expires_at && t.expires_at - 60_000 > Date.now()) return t.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: t.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) {
    throw new GoogleError(`Google token refresh failed: ${j.error_description || j.error || res.status}`, res.status);
  }
  save({ ...t, access_token: j.access_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

async function call<T>(method: string, path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error?.message ?? text;
    } catch {
      /* raw */
    }
    throw new GoogleError(`Google Calendar ${method} ${path}: ${msg}`, res.status);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface CalEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: { email: string; responseStatus?: string }[];
  conferenceData?: { createRequest?: { status?: { statusCode?: string } }; entryPoints?: { entryPointType: string; uri: string }[] };
  extendedProperties?: { private?: Record<string, string> };
}

export const eventStart = (e: CalEvent) => new Date(e.start.dateTime ?? `${e.start.date}T00:00:00+05:00`);
export const eventEnd = (e: CalEvent) => new Date(e.end.dateTime ?? `${e.end.date}T00:00:00+05:00`);
export const isAllDay = (e: CalEvent) => !e.start.dateTime;
export const meetLink = (e: CalEvent) => e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null;

export async function listEvents(from: Date, to: Date): Promise<CalEvent[]> {
  const out: CalEvent[] = [];
  let pageToken: string | undefined;
  do {
    const r = await call<{ items: CalEvent[]; nextPageToken?: string }>("GET", "/calendars/primary/events", {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      ...(pageToken ? { pageToken } : {}),
    });
    out.push(...r.items.filter((e) => e.status !== "cancelled"));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

export async function freeBusy(from: Date, to: Date): Promise<{ start: Date; end: Date }[]> {
  const r = await call<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>("POST", "/freeBusy", {}, {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    timeZone: TZ_NAME,
    items: [{ id: "primary" }],
  });
  return (r.calendars.primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export interface NewEvent {
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  meet?: boolean;
  attendees?: string[];
  tag?: Record<string, string>;
}

export async function getEvent(id: string): Promise<CalEvent> {
  return call<CalEvent>("GET", `/calendars/primary/events/${encodeURIComponent(id)}`);
}

export async function createEvent(e: NewEvent): Promise<CalEvent> {
  const body: Record<string, unknown> = {
    summary: e.title,
    description: e.description,
    location: e.location,
    start: { dateTime: e.start.toISOString(), timeZone: TZ_NAME },
    end: { dateTime: e.end.toISOString(), timeZone: TZ_NAME },
    attendees: e.attendees?.length ? e.attendees.map((email) => ({ email })) : undefined,
    reminders: { useDefault: true },
    extendedProperties: { private: { drenix: "1", ...(e.tag ?? {}) } },
  };
  if (e.meet) body.conferenceData = { createRequest: { requestId: `drx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
  let ev = await call<CalEvent>("POST", "/calendars/primary/events", {
    conferenceDataVersion: "1",
    sendUpdates: e.attendees?.length ? "all" : "none",
  }, body);
  // Meet links are sometimes created asynchronously: poll briefly, never report a link we didn't get from the API
  if (e.meet && !meetLink(ev)) {
    for (let i = 0; i < 4 && !meetLink(ev); i++) {
      await new Promise((r) => setTimeout(r, 1200));
      ev = await getEvent(ev.id);
    }
  }
  return ev;
}

export async function updateEvent(id: string, patch: Partial<NewEvent>): Promise<CalEvent> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.start) body.start = { dateTime: patch.start.toISOString(), timeZone: TZ_NAME };
  if (patch.end) body.end = { dateTime: patch.end.toISOString(), timeZone: TZ_NAME };
  if (patch.attendees) body.attendees = patch.attendees.map((email) => ({ email }));
  return call<CalEvent>("PATCH", `/calendars/primary/events/${encodeURIComponent(id)}`, { sendUpdates: "all", conferenceDataVersion: "1" }, body);
}

export async function deleteEvent(id: string): Promise<void> {
  try {
    await call<void>("DELETE", `/calendars/primary/events/${encodeURIComponent(id)}`, { sendUpdates: "all" });
  } catch (e) {
    if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) return; // already gone
    throw e;
  }
}
