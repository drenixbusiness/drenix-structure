/**
 * Minimal Google Forms REST client, same OAuth token as Calendar/Sheets.
 * No Apps Script is needed: the Forms API creates forms, publishes them and reads responses.
 */
import { accessToken, formsGranted, GoogleError } from "./calendar.js";

const API = "https://forms.googleapis.com/v1/forms";
const NOT_GRANTED = "Google Forms is not connected: an admin must run `npm run google:auth` again and tick the Forms checkboxes.";

async function call<T>(method: string, path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
  if (!formsGranted()) throw new GoogleError(NOT_GRANTED);
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    signal: AbortSignal.timeout(30_000),
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error?.message ?? text;
    } catch {
      /* raw */
    }
    if (res.status === 403 && /scope/i.test(msg)) msg = NOT_GRANTED;
    throw new GoogleError(`Google Forms: ${msg}`, res.status);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Accepts a forms.google.com edit link, a bare form id, or null. Responder links (/d/e/…) can't be used by the API. */
export function parseFormId(v: string): string | null {
  const s = v.trim();
  if (/\/forms\/d\/e\//.test(s)) return null;
  return s.match(/\/forms\/d\/([\w-]{20,})/)?.[1] ?? (/^[\w-]{20,}$/.test(s) ? s : null);
}

export const editUrl = (formId: string) => `https://docs.google.com/forms/d/${formId}/edit`;

export type QuestionType = "short" | "paragraph" | "choice" | "checkboxes" | "dropdown" | "scale" | "date";

export interface QuestionDraft {
  title: string;
  type: QuestionType;
  description?: string;
  options?: string[];
  required?: boolean;
  low?: number;
  high?: number;
  lowLabel?: string;
  highLabel?: string;
}

export interface FormItem {
  itemId: string;
  title?: string;
  description?: string;
  questionItem?: {
    question: {
      questionId: string;
      required?: boolean;
      textQuestion?: { paragraph?: boolean };
      choiceQuestion?: { type: "RADIO" | "CHECKBOX" | "DROP_DOWN"; options: { value?: string; isOther?: boolean }[] };
      scaleQuestion?: { low?: number; high: number; lowLabel?: string; highLabel?: string };
      dateQuestion?: object;
      timeQuestion?: object;
      ratingQuestion?: { ratingScaleLevel: number };
    };
  };
}

export interface Form {
  formId: string;
  info: { title: string; documentTitle?: string; description?: string };
  items?: FormItem[];
  responderUri: string;
}

export interface FormResponse {
  responseId: string;
  createTime: string;
  lastSubmittedTime: string;
  respondentEmail?: string;
  answers?: Record<string, { questionId: string; textAnswers?: { answers: { value: string }[] } }>;
}

function question(q: QuestionDraft) {
  const required = q.required ?? true;
  const opts = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
  switch (q.type) {
    case "paragraph":
      return { required, textQuestion: { paragraph: true } };
    case "choice":
    case "checkboxes":
    case "dropdown":
      if (opts.length < 2) return { required, textQuestion: { paragraph: false } };
      return { required, choiceQuestion: { type: q.type === "choice" ? "RADIO" : q.type === "checkboxes" ? "CHECKBOX" : "DROP_DOWN", options: [...new Set(opts)].map((value) => ({ value })) } };
    case "scale": {
      const low = q.low === 0 ? 0 : 1;
      const high = Math.min(10, Math.max(low + 1, q.high ?? 5));
      return { required, scaleQuestion: { low, high, ...(q.lowLabel ? { lowLabel: q.lowLabel } : {}), ...(q.highLabel ? { highLabel: q.highLabel } : {}) } };
    }
    case "date":
      return { required, dateQuestion: { includeYear: true } };
    default:
      return { required, textQuestion: { paragraph: false } };
  }
}

/** Creates, fills and publishes a form. Returns the stored form. */
export async function createForm(title: string, description: string, questions: QuestionDraft[]): Promise<Form> {
  const created = await call<Form>("POST", "", {}, { info: { title, documentTitle: title } });
  const requests: unknown[] = [];
  if (description) requests.push({ updateFormInfo: { info: { description }, updateMask: "description" } });
  questions.forEach((q, i) =>
    requests.push({
      createItem: {
        item: { title: q.title, ...(q.description ? { description: q.description } : {}), questionItem: { question: question(q) } },
        location: { index: i },
      },
    }),
  );
  if (requests.length) await call("POST", `/${created.formId}:batchUpdate`, {}, { requests });
  await setAccepting(created.formId, true);
  return getForm(created.formId);
}

/**
 * Forms made through the API start unpublished; this publishes them (or stops/starts accepting responses).
 * Older forms that predate publish settings reject the call; they already accept responses.
 */
export async function setAccepting(formId: string, accepting: boolean): Promise<void> {
  try {
    await call("POST", `/${formId}:setPublishSettings`, {}, {
      publishSettings: { publishState: { isPublished: true, isAcceptingResponses: accepting } },
      updateMask: "publishState",
    });
  } catch (e) {
    if (e instanceof GoogleError && e.status === 400 && /legacy|not supported|publish/i.test(e.message)) return;
    throw e;
  }
}

export const getForm = (formId: string) => call<Form>("GET", `/${formId}`);

export async function listResponses(formId: string): Promise<FormResponse[]> {
  const out: FormResponse[] = [];
  let pageToken: string | undefined;
  do {
    const r = await call<{ responses?: FormResponse[]; nextPageToken?: string }>("GET", `/${formId}/responses`, { pageSize: "5000", ...(pageToken ? { pageToken } : {}) });
    out.push(...(r.responses ?? []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out.sort((a, b) => a.lastSubmittedTime.localeCompare(b.lastSubmittedTime));
}
