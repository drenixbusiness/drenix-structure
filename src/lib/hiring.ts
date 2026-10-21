/**
 * Employee Recruitment Request — fields taken from
 * "Employee_Recruitment_Request_Form_One_Page_Final.docx" (Internal Hiring Request Template).
 * Shared by the form (client) and the API route that posts it to Telegram (server).
 */

export const GENDERS = ["Male", "Female", "No Preference"] as const;

export interface HiringRequest {
  department: string;
  position: string;
  requester: string;
  openPositions: string;
  responsibilities: string[];
  hardSkills: string[];
  softSkills: string[];
  experience: string;
  languages: string;
  languageLevel: string;
  education: string;
  age: string;
  gender: (typeof GENDERS)[number] | "";
  schedule: string;
  workingDays: string;
  probation: string;
  salaryProbation: string;
  salaryAfter: string;
  mandatory: string;
  comments: string;
  /** honeypot — must stay empty */
  website?: string;
}

export const emptyHiringRequest = (): HiringRequest => ({
  department: "",
  position: "",
  requester: "",
  openPositions: "1",
  responsibilities: ["", "", "", "", ""],
  hardSkills: ["", "", "", "", ""],
  softSkills: ["", "", "", "", ""],
  experience: "",
  languages: "",
  languageLevel: "",
  education: "",
  age: "",
  gender: "",
  schedule: "",
  workingDays: "",
  probation: "",
  salaryProbation: "",
  salaryAfter: "",
  mandatory: "",
  comments: "",
  website: "",
});

const SINGLE_REQUIRED: (keyof HiringRequest)[] = [
  "department",
  "position",
  "requester",
  "openPositions",
  "experience",
  "languages",
  "languageLevel",
  "education",
  "age",
  "gender",
  "schedule",
  "workingDays",
  "probation",
  "salaryProbation",
  "salaryAfter",
  "mandatory",
  "comments",
];

/** Returns field → error message. Empty object = valid. */
export function validateHiring(r: HiringRequest): Record<string, string> {
  const e: Record<string, string> = {};
  for (const k of SINGLE_REQUIRED) {
    const v = r[k];
    if (typeof v !== "string" || !v.trim()) e[k] = "Required";
  }
  const n = Number(r.openPositions);
  if (r.openPositions && (!Number.isInteger(n) || n < 1 || n > 100)) e.openPositions = "1–100";
  // every one of the 5 lines is required
  for (const k of ["responsibilities", "hardSkills", "softSkills"] as const) {
    const empty = 5 - r[k].filter((x) => x.trim()).length;
    if (empty > 0) e[k] = `Fill all 5 (${empty} empty)`;
  }
  return e;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Telegram HTML message. */
export function formatHiringMessage(r: HiringRequest): string {
  const line = (label: string, v: string) => `<b>${esc(label)}:</b> ${esc(clip(v.trim()) || "—")}`;
  const list = (label: string, items: string[]) => {
    const xs = items.map((x) => x.trim()).filter(Boolean);
    return `<b>${esc(label)}:</b>\n${xs.length ? xs.map((x, i) => `  ${i + 1}. ${esc(clip(x, 300))}`).join("\n") : "  —"}`;
  };
  return [
    "<b>EMPLOYEE RECRUITMENT REQUEST</b>",
    "",
    line("Department", r.department),
    line("Position / Job Title", r.position),
    line("Requester's Full Name", r.requester),
    line("Number of Open Positions", r.openPositions),
    "",
    list("Main Responsibilities", r.responsibilities),
    "",
    list("5 Hard Skills", r.hardSkills),
    "",
    list("5 Soft Skills", r.softSkills),
    "",
    line("Required Work Experience", r.experience),
    line("Language Requirements", `${r.languages} — Level: ${r.languageLevel}`),
    line("Education Requirements", r.education),
    line("Age", r.age),
    line("Gender", r.gender),
    line("Proposed Work Schedule", r.schedule),
    line("Working Days", r.workingDays),
    line("Probation Period Duration", r.probation),
    line("Salary During Probation Period", r.salaryProbation),
    line("Salary After Probation Period", r.salaryAfter),
    line("Mandatory Requirements", r.mandatory),
    line("Additional Comments / Requirements", r.comments),
  ].join("\n");
}
