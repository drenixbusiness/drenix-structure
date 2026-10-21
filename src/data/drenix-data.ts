/**
 * DRENIX — organizational structure data.
 *
 * Single source of data for the app. HR can edit this file without touching the UI:
 *  - JOB_DESCRIPTIONS: text taken verbatim from the Google Drive folder
 *    "Job description for each position"
 *    https://drive.google.com/drive/folders/1AEPJgTM3E77vxnU2V_rBr1W6j4GwLoEH
 *  - DEPARTMENTS: department cards (taglines, key responsibilities, parent)
 *  - FLEET_MODELS: headcount per truck count. To add a new size, add a key here
 *    and to TRUCK_STOPS.
 *
 * Role ids inside FLEET_MODELS must stay stable between sizes: the UI uses them to
 * compute ▲/▼ deltas and NEW badges.
 */

export type JDKey =
  | "advisor" | "ceo" | "coo" | "cfo"
  | "dispMgr" | "srDisp" | "disp" | "loadPl" | "broker"
  | "fleetMgr" | "fleetCoord" | "fleetSpec" | "fuel" | "fleetAdmin"
  | "eldLead" | "eldSpec" | "eldIt"
  | "safetyMgr" | "safetySpec" | "compliance" | "risk"
  | "ushrMgr" | "recruiter" | "onboard" | "retention"
  | "acctMgr" | "ar" | "ap" | "payroll" | "finAn"
  | "uzbMgr" | "offRec" | "kadr" | "hrSup" | "training"
  | "itMgr" | "sysAdm" | "itSup" | "auto" | "erp";

export interface JobDescription {
  key: JDKey;
  docId: string;
  title: string;
  department: string;
  reportsTo: string;
  workplace: string;
  /** 1. Purpose of the Position */
  purpose: string;
  /** 2. Main Duties and Responsibilities */
  duties: string[];
  /** 3. Authority and Limits */
  authority: string;
  /** 4. Accountability */
  accountability: string;
  /** 5. Qualification Requirements — "Work experience: …" part */
  experience: string;
  /** 5. Qualification Requirements — general requirements part */
  requirements: string;
  /** 6. Cooperation and Work Procedure (docs contain no working hours) */
  procedure: string;
}

export const DRIVE_FOLDER_URL =
  "https://drive.google.com/drive/folders/1AEPJgTM3E77vxnU2V_rBr1W6j4GwLoEH";

export const docUrl = (docId: string) => `https://docs.google.com/document/d/${docId}/edit`;

// ---------------------------------------------------------------------------
// Wording shared by many documents (copied verbatim from the docs)
// ---------------------------------------------------------------------------

const AUTHORITY_MANAGER =
  "Manages the work of their department within approved policy, budget and authority limits and assigns work tasks to subordinate staff; agrees specific financial, legal or labor decisions with the authorized person.";

const AUTHORITY_STAFF =
  "Works within the permitted scope with the systems and documents assigned to the position; does not independently make final decisions on financial commitments, hiring or matters affecting safety.";

const ACCOUNTABILITY =
  "Is responsible, within their authority, for the timely and correct completion of assigned work, the accuracy and confidentiality of work data, and compliance with internal procedures. If a significant error, risk or sign of a legal violation is detected, immediately informs the direct manager.";

const REQUIREMENTS =
  "Appropriate professional knowledge, working-level English communication (where required for the duties), proficiency with electronic systems, orderly documentation and professional conduct are required.";

const PROCEDURE_TASHKENT =
  "Work is carried out remotely from the Tashkent (Uzbekistan) office. Trucks and drivers operate in the USA; assignments are coordinated with the relevant Dispatch, Fleet, Safety, Finance or IT managers within their scope of authority. US transportation regulations and the applicable requirements of Uzbekistan labor law are observed.";

const PROCEDURE_UZB_HR =
  "The role applies to office staff in Uzbekistan. UZB HR and US HR are separate management lines; UZB HR does not interfere in the operational or personnel decisions of US HR. Labor documents are maintained in accordance with the law of Uzbekistan.";

type JDInput = Omit<JobDescription, "workplace" | "accountability" | "requirements" | "authority" | "procedure"> & {
  authority?: string;
  procedure?: string;
  workplace?: string;
};

const jd = (input: JDInput): JobDescription => ({
  workplace: "Office",
  authority: AUTHORITY_STAFF,
  procedure: PROCEDURE_TASHKENT,
  accountability: ACCOUNTABILITY,
  requirements: REQUIREMENTS,
  ...input,
});

// ---------------------------------------------------------------------------
// Job descriptions
// ---------------------------------------------------------------------------

const JD_LIST: JobDescription[] = [
  jd({
    key: "advisor",
    docId: "16hmE-sb0xaqgTFWvsSOlgVAD8fDaFTydPX4tUEuW0k4",
    title: "Advisor / Consultant",
    department: "Advisory",
    reportsTo: "Owner / CEO",
    purpose:
      "Provides independent recommendations to management; executive authority is granted only by a separate assignment.",
    duties: [
      "Prepare independent analysis and recommendations on management, transport operations or finance.",
      "Assess the risks of projects and initiatives presented by management.",
      "Describe alternative options in writing for resolving operational problems.",
      "Prepare advisory conclusions using permitted data.",
      "Do not make commitments on behalf of the company or give orders to employees without written authority.",
    ],
    experience: "proven practical experience in the area being advised on.",
  }),
  jd({
    key: "ceo",
    docId: "16870hlRLKOS1_DAAvSjfBKUKJsoKDiWtljUsOyfTEao",
    title: "CEO",
    department: "Management",
    reportsTo: "Owner",
    purpose: "Carries out the strategic and day-to-day management of the company.",
    duties: [
      "Define the company's strategic goals, organizational structure and business plans, and oversee their execution.",
      "Coordinate the work of the COO, CFO, UZB HR Manager, IT Manager and other directly reporting managers.",
      "Make decisions on service quality, stability and business risks in the US trucking market.",
      "Approve major contracts, spending limits and the distribution of authority in accordance with established procedure.",
      "Review managers' reports on financial, legal, information security and HR matters.",
      "Report to the Owner on the company's performance and key decisions.",
    ],
    authority: AUTHORITY_MANAGER,
    experience: "at least 4 years of leadership or relevant business management experience.",
  }),
  jd({
    key: "coo",
    docId: "1sUYtp6CJLcRUJS8xxf7HTIcXWY_oljm8IWmzT2-pEIs",
    title: "COO",
    department: "Operations",
    reportsTo: "CEO",
    purpose: "Manages US trucking operations from the office in Uzbekistan.",
    duties: [
      "Coordinate the work of the heads of Dispatch, Fleet, ELD & IT Operations, Safety & Compliance and US HR.",
      "Organize load allocation, vehicle utilization and service continuity.",
      "Take prompt action in case of critical delays, breakdowns and service interruptions.",
      "Work with Safety to ensure that HOS and other mandatory safety restrictions are not violated.",
      "Improve internal procedures and escalation rules for transport processes.",
      "Inform the CEO about the operational situation, problems and required management decisions.",
    ],
    authority: AUTHORITY_MANAGER,
    experience: "at least 2–3 years of transport operations or dispatch management experience.",
  }),
  jd({
    key: "cfo",
    docId: "1kyCGCBdNI3SbJnsKWL2k3zAxmLoiRIJuLudxuVLI-mo",
    title: "CFO",
    department: "Finance",
    reportsTo: "CEO",
    purpose: "Runs the financial management, accounting and control system.",
    duties: [
      "Manage the work of the Accounting Manager and the finance specialists.",
      "Plan the company's budget, cash flow and financial obligations.",
      "Organize control procedures for AR, AP, payroll and driver settlements.",
      "Coordinate the exchange of financial information with banks, factoring companies and service providers.",
      "Review large or unusual transactions within approved authority limits.",
      "Give the CEO conclusions on financial risks, receivables and cash flow.",
    ],
    authority: AUTHORITY_MANAGER,
    experience: "at least 3 years of finance or accounting management experience.",
  }),

  // ----- Dispatch -----
  jd({
    key: "dispMgr",
    docId: "1ANGZ4p-vkXtoAwSpyjBz2zDIVlhj86zt4p5RIICG13o",
    title: "Dispatch Manager",
    department: "Dispatch",
    reportsTo: "COO",
    purpose: "Manages the work of the dispatchers and the freight schedule.",
    duties: [
      "Organize the work of Senior and Junior Dispatchers, the Load Planner and the Broker Relation.",
      "Together with the Broker Relation, oversee load negotiations with brokers, rate confirmations and shipping terms.",
      "Plan work taking into account truck availability, pickup/delivery windows and HOS restrictions.",
      "Manage escalation when a problem arises between the driver, broker and customer.",
      "Verify the accuracy of load status, contracts and operational records in the TMS.",
      "Prohibit instructions for illegal, unsafe or undocumented shipments.",
    ],
    authority: AUTHORITY_MANAGER,
    experience: "at least 2–3 years of US trucking dispatch experience.",
  }),
  jd({
    key: "srDisp",
    docId: "1PJGHv_zBtQNwzRGC2CSq1jBU_7rzQtlXSkgZ0b44FHg",
    title: "Senior Dispatcher",
    department: "Dispatch",
    reportsTo: "Dispatch Manager",
    purpose: "Handles complex loads and supports the junior dispatchers.",
    duties: [
      "Negotiate rates and terms with brokers for assigned loads.",
      "Monitor the loading, transit and delivery stages in real time.",
      "Document load cancellations, detention, layover and breakdown cases.",
      "Guide Junior Dispatchers on operating procedures.",
      "Coordinate with the ELD/Safety team on drivers' working and rest hours.",
    ],
    experience: "US trucking dispatch experience and the ability to resolve complex situations.",
  }),
  jd({
    key: "disp",
    docId: "17i_DgqMBxr99vVSUQra__vIoqBK5gi3IzuqheWzuENg",
    title: "Junior Dispatcher",
    department: "Dispatch",
    reportsTo: "Senior Dispatcher / Dispatch Manager",
    purpose: "Tracks assigned loads on a daily basis.",
    duties: [
      "Collect status updates from brokers and drivers and enter them into the TMS.",
      "Verify pickup/delivery addresses, appointments and rate confirmation details.",
      "Raise problems with the Senior Dispatcher in a timely manner.",
      "Pass POD, BOL and other shipping documents to the relevant department.",
      "Do not give drivers instructions that encourage violating HOS or Safety requirements.",
    ],
    experience: "knowledge of dispatch processes and working-level English communication skills.",
  }),
  jd({
    key: "loadPl",
    docId: "17SaH8B4QWXXJF1DXJ2CToXndAMSvZhNfsUBZesdAoY4",
    title: "Load Planner",
    department: "Dispatch",
    reportsTo: "Dispatch Manager",
    purpose: "Ensures efficient planning between available trucks and available loads.",
    duties: [
      "Prepare load options based on truck location, availability and the driver's working hours.",
      "Take into account pickup/delivery appointments, deadhead and transit conditions.",
      "Coordinate broker offers with the dispatchers.",
      "Promptly inform the driver and relevant staff when the plan changes.",
      "Keep route, time and equipment data in the TMS up to date.",
    ],
    experience: "load planning skills, knowledge of geography and experience with a TMS.",
  }),
  jd({
    key: "broker",
    docId: "18CWt_iHIt760aXBgo51iwMCpf8-vv-2oKTFgLncTDGc",
    title: "Broker Relation",
    department: "Dispatch",
    reportsTo: "Dispatch Manager",
    purpose: "Maintains long-term partnerships with brokers and negotiates rates and contract terms.",
    duties: [
      "Maintain regular contact with existing brokers and monitor the quality of the partnership.",
      "Negotiate rates in coordination with the Dispatch Manager and Senior Dispatchers.",
      "Maintain broker contracts, carrier setup documents and payment terms.",
      "Monitor market rates and freight demand and provide analytical input to the Dispatch Manager.",
      "Attract new brokers and formalize partnerships with them.",
      "Inform the Dispatch Manager and the Accounting Manager about broker disputes and payment delays.",
    ],
    experience: "experience working with US trucking brokers, rate negotiation and contracts.",
  }),

  // ----- Fleet & Maintenance -----
  jd({
    key: "fleetMgr",
    docId: "1qz7bEIDkTK1irLa0qkbIwhMQnqSYVhqsAffFZUFOGJU",
    title: "Fleet Manager",
    department: "Fleet & Maintenance",
    reportsTo: "COO",
    purpose: "Remotely manages the technical readiness of vehicles in the USA.",
    duties: [
      "Distribute the work among the Fleet Coordinator, Fleet Specialist, Fuel & Cost Analyst and Fleet Administrator.",
      "Coordinate preventive maintenance, service bookings, breakdowns and roadside repairs.",
      "Monitor the expiration dates of truck and trailer documents.",
      "Review repair invoices and service quotes within the scope of authority.",
      "Do not approve dispatching a vehicle that is unfit for safe operation.",
      "Report to the COO on the technical condition of the fleet and its problems.",
    ],
    authority: AUTHORITY_MANAGER,
    experience: "at least 2 years of fleet management or technical coordination experience.",
  }),
  jd({
    key: "fleetCoord",
    docId: "1rGEgqmSuj6lInophI5fobqWxDr9CQylBqAXGLiSfMFY",
    title: "Fleet Coordinator",
    department: "Fleet & Maintenance",
    reportsTo: "Fleet Manager",
    purpose: "Maintains continuous communication between service providers, drivers and the Fleet department.",
    duties: [
      "Receive breakdown reports and set their priority.",
      "Contact shops, road service and towing providers in the USA.",
      "Reflect repair time, location and status in the TMS/ERP.",
      "Inform the Driver and Dispatch about vehicle readiness.",
      "Pass service documents to the Fleet Administrator.",
    ],
    experience: "transport coordination and communication skills with service providers.",
  }),
  jd({
    key: "fleetSpec",
    docId: "1DcCqFaOOoH2GcdewsUZ_giZKAUtUznu7hIc_gJrvJLI",
    title: "Fleet Specialist",
    department: "Fleet & Maintenance",
    reportsTo: "Fleet Manager",
    purpose: "Monitors the technical and operational issues of the vehicles.",
    duties: [
      "Check service history, preventive maintenance and defect records.",
      "Collect information and photos about breakdowns reported by the driver.",
      "Compare data on spare parts and service work.",
      "Report technical deficiencies related to DOT inspections to the Fleet Manager.",
      "Verify post-repair documents and that the work has been completed.",
      "Track the status of technical work performed by shops, road service and service teams, and report to the Fleet Manager.",
    ],
    experience: "knowledge of vehicle maintenance processes or fleet support.",
  }),
  jd({
    key: "fuel",
    docId: "1eeVpypASU-gHVenLU6hVg0H-VSXVg-KOeH0XpxLR-d8",
    title: "Fuel & Cost Analyst",
    department: "Fleet & Maintenance",
    reportsTo: "Fleet Manager",
    purpose: "Analyzes and controls fuel and fleet costs.",
    duties: [
      "Review fuel card and fuel transactions and identify unusual spending.",
      "Calculate fuel efficiency (MPG), cost per mile and other cost indicators by truck.",
      "Analyze service, parts and repair costs based on the Fleet Administrator's documents.",
      "Prepare reports and recommendations for the Fleet Manager on rising costs or inefficient vehicles.",
      "Reconcile fleet cost data with the Financial Analyst and the Accounting Manager.",
      "Comply with access rights for fuel card and cost data.",
    ],
    experience: "cost analysis, spreadsheets and fleet or fuel accounting.",
  }),
  jd({
    key: "fleetAdmin",
    docId: "1sr-XYgV5PvV9GrwJvxXEU_Ud13ZEE5AuBmjC0YmKyQA",
    title: "Fleet Administrator",
    department: "Fleet & Maintenance",
    reportsTo: "Fleet Manager",
    purpose: "Maintains fleet documents and the equipment database.",
    duties: [
      "Keep the truck/trailer list, VINs, plates, cab cards and inspection due dates in order.",
      "Register service invoices, expenses and repair documents.",
      "Send registration and insurance documents to the relevant staff on time.",
      "Record new or removed units in the ERP.",
      "Comply with access rights for confidential documents.",
    ],
    experience: "skills in working with documents, spreadsheets and electronic databases.",
  }),

  // ----- ELD & IT Operations -----
  jd({
    key: "eldLead",
    docId: "1cVYdsnmxd-4LrE9fz7fR4sF7L2lW3IgfeW68tTd0U1Q",
    title: "ELD Operations Lead",
    department: "ELD & IT Operations",
    reportsTo: "COO",
    purpose: "Manages the ELD and IT support team.",
    duties: [
      "Organize the work of the ELD Specialists and IT Support on tickets and outages.",
      "Coordinate device connection, integration and usage problems.",
      "Provide technical support on driver logs within the limits of authority agreed with Safety.",
      "Prevent falsification of HOS records and escalate identified risks to Safety.",
      "Liaise with ELD providers on service and technical issues.",
    ],
    authority: AUTHORITY_MANAGER,
    experience: "experience in ELD, HOS and operations practice.",
  }),
  jd({
    key: "eldSpec",
    docId: "1C3laHHkQ2ohGSpo1W0Qwhb3V2ck72jqe01D3_FR9tbA",
    title: "ELD Specialist",
    department: "ELD & IT Operations",
    reportsTo: "ELD Operations Lead",
    purpose: "Provides drivers with technical support on the ELD system.",
    duties: [
      "Activate the ELD device and instruct drivers on using the application.",
      "Identify login, Bluetooth, GPS, diagnostic and malfunction problems.",
      "Escalate faults to the provider or the ELD Operations Lead.",
      "Record technical support requests in the ticket system.",
      "Do not make illegal edits to driver logs.",
    ],
    experience: "knowledge of ELD platforms and HOS basics.",
  }),
  jd({
    key: "eldIt",
    docId: "1KqkcvM9mwi5jNHEbf7TcPE_PzN2JUx6YxZg4uBF7jUk",
    title: "IT Support",
    department: "ELD & IT Operations",
    reportsTo: "ELD Operations Lead",
    purpose: "Provides day-to-day IT and equipment support to office staff.",
    duties: [
      "Receive and resolve requests concerning computers, printers, phones and other office equipment.",
      "Monitor the office-side technical condition of ELD devices, tablets and communication tools.",
      "Fix basic faults related to the network, VPN and system access.",
      "Escalate complex problems to the IT Manager or the System Administrator.",
      "Record requests in the ticket system.",
      "Manage passwords and user permissions only in the approved manner.",
    ],
    experience: "skills in servicing computers, networks and office equipment.",
  }),

  // ----- Safety & Compliance -----
  jd({
    key: "safetyMgr",
    docId: "1fS9JuWqGEjg6T3ruKcW-85Db9mBc6icLB1juh1DiVyg",
    title: "Safety Manager",
    department: "Safety & Compliance",
    reportsTo: "COO",
    purpose: "Oversees transport safety and compliance with regulations in the USA.",
    duties: [
      "Organize the review of Driver Qualification Files and driver documents.",
      "Oversee FMCSA, DOT, HOS, drug testing and Clearinghouse processes within the scope of authority.",
      "Review incidents, inspections and violations.",
      "Manage the work of the Safety Specialist, Compliance Coordinator and Risk & Claims Specialist.",
      "Send objective warnings to the COO and CEO in case of safety violations.",
      "Immediately advise authorized managers on stopping an unsafe trip.",
    ],
    authority: AUTHORITY_MANAGER,
    experience: "at least 2 years of trucking safety or compliance experience.",
  }),
  jd({
    key: "safetySpec",
    docId: "15YhJamjTmxaq4WUe1wYR56Qxn8tdFTQ3K1tl7292B0s",
    title: "Safety Specialist",
    department: "Safety & Compliance",
    reportsTo: "Safety Manager",
    purpose: "Verifies safety data related to drivers and loads.",
    duties: [
      "Monitor the validity of CDL, medical card, MVR and other DQ documents.",
      "Log DOT inspections and violations.",
      "Collect documents and organize evidence for HOS audits.",
      "Communicate approved safety reminders to drivers.",
      "Send identified deficiencies to the Safety Manager.",
    ],
    experience: "knowledge of truck safety and document verification.",
  }),
  jd({
    key: "compliance",
    docId: "1RT9_7d9HmYAW9Kj_zOadlxpojY6T6QFPmLHvErLbe1c",
    title: "Compliance Coordinator",
    department: "Safety & Compliance",
    reportsTo: "Safety Manager",
    purpose: "Maintains the register of regulatory documents and deadlines.",
    duties: [
      "Organize driver qualification, inspection and required compliance records.",
      "Notify the relevant departments about documents that are about to expire.",
      "Prepare materials required for audits and check the consistency of documents.",
      "Inform the Safety Manager about changes in carrier requirements and internal policy.",
      "Do not disclose confidential personal data without authorization.",
    ],
    experience: "compliance documentation and record-keeping skills.",
  }),
  jd({
    key: "risk",
    docId: "1k7u0yxA-99Q4PUJYXnoSUKRNW9sw011a2w0MjHDnSt4",
    title: "Risk & Claims Specialist",
    department: "Safety & Compliance",
    reportsTo: "Safety Manager",
    purpose: "Maintains the paperwork flow for incidents and insurance claims.",
    duties: [
      "Collect accident, cargo damage and property damage reports.",
      "Organize evidence relating to the driver, broker and insurance agent.",
      "Keep the claim number, deadlines, contact history and documents in the register.",
      "Do not make unconfirmed promises about coverage or legal liability.",
      "Escalate complex cases or those with potential litigation to the Safety Manager.",
    ],
    experience: "knowledge of incident reporting or insurance claims processes.",
  }),

  // ----- US HR (Driver Recruiting) -----
  jd({
    key: "ushrMgr",
    docId: "1mooV2JJ3KXAtqtAbS0aG4fZIpbE2ukxDZqD5GeTVB_o",
    title: "US HR Manager",
    department: "US HR",
    reportsTo: "COO",
    purpose: "Manages the recruiting of US drivers and the HR processes related to them.",
    duties: [
      "Manage the Driver Recruiter, Driver Onboarding and Driver Retention staff.",
      "Organize the screening process for CDL-A driver candidates.",
      "Coordinate document, background and compliance checks with Safety.",
      "Coordinate drivers' start of work and communication issues.",
      "Pass driver complaints and reasons for leaving to the COO.",
      "Do not report to the UZB HR Manager; do not interfere with the authority to manage office staff.",
    ],
    authority:
      "Reports directly to the COO and manages the US HR team. Does not report to the UZB HR Manager; does not manage HR matters of the Uzbekistan office staff.",
    experience: "at least 2 years of driver recruitment or trucking HR experience.",
  }),
  jd({
    key: "recruiter",
    docId: "1iKBGJa1TGCS18edKtgsytQY2OahWKKckpaTgpqbFzlo",
    title: "Driver Recruiter",
    department: "US HR",
    reportsTo: "US HR Manager",
    purpose: "Attracts truck drivers in the USA.",
    duties: [
      "Communicate with candidates by phone, SMS and recruiting platforms.",
      "Determine CDL experience, start availability, equipment type and working conditions.",
      "Explain the company's offer clearly, based on approved information.",
      "Record candidate data in the CRM and organize follow-ups.",
      "Agree the final decision on documents and compliance with Safety.",
    ],
    experience: "communication and candidate screening skills in driver recruiting.",
  }),
  jd({
    key: "onboard",
    docId: "1JRgVR7WYB2HwkuCGVWrnqZM-ipnQf06f0kvx45pyKwM",
    title: "Driver Onboarding Specialist",
    department: "US HR",
    reportsTo: "US HR Manager",
    purpose: "Takes approved drivers through the onboarding process.",
    duties: [
      "Collect the CDL, medical card, MVR, inspection and carrier-required documents.",
      "Coordinate the checks and drug test processes approved by Safety.",
      "Maintain electronic contracts and internal registers in the established manner.",
      "Verify readiness to start work with ELD, Dispatch and Fleet.",
      "Communicate approved information on pay and working conditions to the driver.",
    ],
    experience: "onboarding and electronic document handling skills.",
  }),
  jd({
    key: "retention",
    docId: "1fa5S3JA9DXkpYOS-HM5ln4PL6wPOHHcPPzEEId0zUV8",
    title: "Driver Retention Specialist",
    department: "US HR",
    reportsTo: "US HR Manager",
    purpose: "Manages communication with drivers, their requests, and measures to retain them at the company.",
    duties: [
      "Receive and record driver requests and route them to the relevant departments.",
      "Pass responses agreed with Payroll, Dispatch, Safety and Fleet to the driver.",
      "Escalate communication breakdowns and disputes in a timely manner.",
      "Pass reasons for leaving and recurring problems to the US HR Manager for analysis.",
      "Keep personal data and requests confidential.",
      "Carry out driver retention measures in the manner agreed with the US HR Manager.",
    ],
    experience: "customer service or experience working with drivers.",
  }),

  // ----- CFO / Finance -----
  jd({
    key: "acctMgr",
    docId: "1jbupjlNSljlfrzzbdjSfzk8QyjUiln7kO0VHZ7rFXjQ",
    title: "Accounting Manager",
    department: "Finance",
    reportsTo: "CFO",
    purpose: "Manages day-to-day accounting, billing and settlements processes.",
    duties: [
      "Coordinate the work of the AR, AP, payroll and settlements specialists.",
      "Verify the accuracy of broker billing, POD, invoices and payment reconciliation.",
      "Identify discrepancies in payments, receivables and accounting entries.",
      "Ensure accounting documents are fully stored in the ERP/accounting system.",
      "Report problematic payments and financial uncertainties to the CFO.",
    ],
    authority: AUTHORITY_MANAGER,
    experience: "at least 2 years of accounting or trucking accounting experience.",
  }),
  jd({
    key: "ar",
    docId: "1hKMeuJMPWX4OASlKo9vkzcvMZDc-UOTd4GsELmsehcI",
    title: "Accounts Receivable Specialist",
    department: "Finance",
    reportsTo: "Accounting Manager",
    purpose: "Records and tracks incoming payments from brokers and customers.",
    duties: [
      "Prepare invoices and supporting documents for delivered loads.",
      "Track payments received from brokers, factoring companies and customers.",
      "Update the aging report and monitor overdue payments.",
      "Clarify BOL/POD and rate confirmation discrepancies with Dispatch.",
      "Verify receipt of payments from the bank or another approved source.",
    ],
    experience: "skills in billing and receivables management.",
  }),
  jd({
    key: "ap",
    docId: "1eo8--thsP8aLU_fdGKgJhfy_8liHryxyaV_Y8qKpFgw",
    title: "Accounts Payable Specialist",
    department: "Finance",
    reportsTo: "Accounting Manager",
    purpose: "Maintains records of amounts owed to suppliers and service providers.",
    duties: [
      "Receive fuel, repair, insurance and other vendor invoice documents.",
      "Verify invoice amounts, terms and confirmation of the service.",
      "Present the payment-ready register to the authorized approver.",
      "Send duplicate, incorrect and suspicious invoices to the manager.",
      "Keep payment and vendor data in the electronic system.",
    ],
    experience: "skills in handling invoices and payment documents.",
  }),
  jd({
    key: "payroll",
    docId: "1qWE1Q5mLMUh9nExEp-kdI3zI4iPb3rs11Zqsx1jqkUY",
    title: "Payroll & Settlements Specialist",
    department: "Finance",
    reportsTo: "Accounting Manager",
    purpose: "Prepares driver settlements and office payroll data.",
    duties: [
      "Prepare weekly driver settlement calculations based on approved rates and documents.",
      "Verify the documents for fuel, insurance, ELD and other agreed deductions.",
      "Collect attendance and approved change data for payroll.",
      "Resolve questions about calculations through the Accounting Manager.",
      "Do not change the payment list without approval and protect personal financial data.",
    ],
    experience: "knowledge of payroll or trucking driver settlement processes.",
  }),
  jd({
    key: "finAn",
    docId: "1WY4zzdtZGXl-1mMa5hCAwYTmEUUm3BDqUjhJlhfPn_8",
    title: "Financial Analyst",
    department: "Finance",
    reportsTo: "CFO",
    purpose: "Prepares analytical conclusions based on financial data.",
    duties: [
      "Prepare revenue and expense analysis by truck, lane and cost category.",
      "Prepare cash flow forecasts and budget estimates.",
      "Identify unusual discrepancies in financial data.",
      "Create clear tables, reports and explanations for the CFO.",
      "Do not present unverified data as a final financial result.",
    ],
    experience: "financial analysis and spreadsheet modeling skills.",
  }),

  // ----- UZB HR (Office Staff) -----
  jd({
    key: "uzbMgr",
    docId: "1IIJqRV758XwsuA7wIV4KrNViYuynQ3p4sfDAYIYygyg",
    title: "UZB HR Manager",
    department: "UZB HR",
    reportsTo: "CEO",
    purpose: "Organizes the HR policy and day-to-day personnel work of the Uzbekistan office.",
    duties: [
      "Coordinate the daily work of the Office Recruiters, HR Administrator, HR Support and Training staff.",
      "Oversee vacancies, interviews, hiring and office onboarding.",
      "Verify that attendance and leave data are maintained correctly.",
      "Escalate deficiencies in personnel documents to the CEO.",
      "Do not give instructions to US HR staff and do not interfere in the driver recruiting process.",
      "Define the Uzbekistan office's headcount needs, hiring and employee relations procedures.",
      "Oversee that employment contracts, the unified personnel register (YAMMT) and internal policy documents are maintained lawfully.",
    ],
    authority:
      "Organizes only the Uzbekistan office HR processes, within the CEO's assignment. Does not manage the US HR Department or the driver recruiting function.",
    experience: "at least 2 years of HR or office personnel management experience.",
    procedure: PROCEDURE_UZB_HR,
  }),
  jd({
    key: "offRec",
    docId: "1RYOe7XyMRo_rmofFgUs_Ey0k98eT4qRc1jhEODQusyk",
    title: "UZB Office Recruiter",
    department: "UZB HR",
    reportsTo: "UZB HR Manager",
    purpose: "Selects staff for the Uzbekistan office only.",
    duties: [
      "Prepare announcements and vacancy descriptions for office positions.",
      "Search for candidates on hh.uz and other sources and screen CVs.",
      "Schedule phone and office interviews and assess candidates.",
      "Compile a shortlist taking into account the requirements of department heads.",
      "Store candidates' personal data securely.",
    ],
    experience: "candidate communication and office recruitment skills.",
    procedure: PROCEDURE_UZB_HR,
  }),
  jd({
    key: "kadr",
    docId: "1Ok18tMqUj16P1X6F0dbts4wobQiWhAhNf8eWGJS7_q8",
    title: "HR Administrator (Kadrovik)",
    department: "UZB HR",
    reportsTo: "UZB HR Manager",
    purpose: "Maintains the official personnel records of the Uzbekistan office.",
    duties: [
      "Prepare employment contracts, orders, supplementary agreements and other personnel documents.",
      "Enter and update records in the unified national personnel register (YAMMT/ЕНСТ) within the scope of authority.",
      "Lawfully formalize hiring, transfers, leave and termination.",
      "Ensure employee personal files and documents are properly stored.",
      "Comply with the documentation requirements of labor law and report errors to the manager.",
    ],
    experience: "at least 2 years of personnel records administration experience.",
    procedure: PROCEDURE_UZB_HR,
  }),
  jd({
    key: "hrSup",
    docId: "122L-rJgEKYFkiCch61qD88TCI4_gfe8Fl34DLjEyd-k",
    title: "UZB HR Support Specialist",
    department: "UZB HR",
    reportsTo: "UZB HR Manager",
    purpose: "Performs supporting organizational work for the Uzbekistan HR team.",
    duties: [
      "Update the interview calendar, employee lists and internal HR records.",
      "Coordinate onboarding documents and office readiness for new employees.",
      "Organize, scan and file documents in permitted folders.",
      "Collect the information the HR Manager needs.",
      "Do not share another person's personal data without authorization.",
    ],
    experience: "skills in working with office documents and spreadsheets.",
    procedure: PROCEDURE_UZB_HR,
  }),
  jd({
    key: "training",
    docId: "1MK0OKBDH0N73pa-E7rgrU6mKw_S0GS4J1SsQ2xcg36g",
    title: "Training & Development Specialist",
    department: "UZB HR",
    reportsTo: "UZB HR Manager",
    purpose: "Supports the development of office employees' knowledge and skills.",
    duties: [
      "Identify training needs together with department heads.",
      "Prepare the internal training plan, materials and schedule.",
      "Coordinate training sessions on ERP, security, business communication and role processes.",
      "Keep attendance records and training materials in order.",
      "Do not introduce unapproved working methods as mandatory standards.",
    ],
    experience: "skills in preparing training materials and training employees.",
    procedure: PROCEDURE_UZB_HR,
  }),

  // ----- IT Department -----
  jd({
    key: "itMgr",
    docId: "1OaAdrh6D0UG5h42be-dPQCjWgiOmlSiXq1nRbD26fjk",
    title: "IT Manager",
    department: "IT",
    reportsTo: "CEO",
    purpose: "Manages the company's IT infrastructure, systems and technology security.",
    duties: [
      "Coordinate the System Administrator, IT Support Specialist, Automation and ERP/TMS specialists.",
      "Ensure the continuity of the office network, user devices, servers and cloud services.",
      "Define procedures for role-based access, backup, incident response and system changes.",
      "Oversee development work on ERP, TMS, RingCentral and other integrations.",
      "Immediately escalate critical security incidents to the CEO.",
    ],
    authority: AUTHORITY_MANAGER,
    experience: "IT infrastructure and team management experience.",
  }),
  jd({
    key: "sysAdm",
    docId: "1q0kvqsRWmy02pudtcgurLNxP3vw9IwTKeYljPQpsb94",
    title: "System Administrator",
    department: "IT",
    reportsTo: "IT Manager",
    purpose: "Ensures that workstations, the network and servers operate reliably.",
    duties: [
      "Configure computers, printers, VPN, routers and the corporate network.",
      "Monitor servers, backups, updates and system health.",
      "Manage user accounts and permissions in the approved manner.",
      "Record and resolve faults in the ticket system.",
      "Keep passwords, keys and administrator rights secure.",
    ],
    experience: "skills in network, Windows and server administration.",
  }),
  jd({
    key: "itSup",
    docId: "1Rf86TyvASmWvR5Ca9grjod5Ahvwlwp8MJ1m1G_k_Fxc",
    title: "IT Support Specialist",
    department: "IT",
    reportsTo: "IT Manager",
    purpose: "Provides technical support to IT users and helps keep systems running.",
    duties: [
      "Receive IT requests from users and set their priority.",
      "Provide technical support on software, user accounts and office applications.",
      "Install, configure and update devices and software.",
      "Record and close requests in the ticket system.",
      "Escalate complex cases to the System Administrator or the IT Manager.",
      "Follow security rules for confidential data and permissions.",
    ],
    experience: "technical support (helpdesk) and software experience.",
  }),
  jd({
    key: "auto",
    docId: "1TNHjkZxArE5prEu15gBhOOm5YmDMKHNBSnuc4HYSStw",
    title: "Automation Specialist",
    department: "IT",
    reportsTo: "IT Manager",
    purpose: "Automates repetitive office processes.",
    duties: [
      "Gather automation needs across HR, Dispatch, Finance and IT processes.",
      "Develop approved bot, webhook and API integrations.",
      "Prevent errors and repeated operations in data transfers.",
      "Implement logging, monitoring and recovery methods for automation scripts.",
      "Agree access to confidential data and external service permissions with the IT Manager.",
    ],
    experience: "knowledge of workflow automation and API integration.",
  }),
  jd({
    key: "erp",
    docId: "1QgQ_okr6nczX9gxw1o_DpzHZVGPOZBOI2T-JI6ctbeo",
    title: "ERP / TMS Specialist",
    department: "IT",
    reportsTo: "IT Manager",
    purpose: "Supports the correct operation of the internal ERP and transport management systems.",
    duties: [
      "Receive user requests and identify functional problems.",
      "Configure approved roles and permissions in the systems.",
      "Check data consistency between the Dispatch, Fleet, HR and Accounting modules.",
      "Prepare tests, guides and user training for new features.",
      "Verify approval and backup before bulk data changes.",
    ],
    experience: "knowledge of ERP or TMS system administration.",
  }),
];

export const JOB_DESCRIPTIONS: Record<JDKey, JobDescription> = Object.fromEntries(
  JD_LIST.map((j) => [j.key, j]),
) as Record<JDKey, JobDescription>;

// ---------------------------------------------------------------------------
// Executives (not counted in office headcount)
// ---------------------------------------------------------------------------

export const OWNER = {
  title: "Owner",
  description: "Strategic Direction · Business Growth",
};

export interface ExecNode {
  key: "ceo" | "coo" | "cfo" | "advisor";
  title: string;
  subtitle: string;
  jd: JDKey;
  manages: string[];
}

export const EXECS: Record<ExecNode["key"], ExecNode> = {
  advisor: { key: "advisor", title: "Advisor / Consultant", subtitle: "Advisory line to Owner", jd: "advisor", manages: [] },
  ceo: {
    key: "ceo",
    title: "CEO",
    subtitle: "Chief Executive Officer",
    jd: "ceo",
    manages: ["COO", "CFO", "UZB HR Manager", "IT Manager"],
  },
  coo: {
    key: "coo",
    title: "COO",
    subtitle: "Chief Operating Officer",
    jd: "coo",
    manages: ["Dispatch Manager", "Fleet Manager", "ELD Operations Lead", "Safety Manager", "US HR Manager"],
  },
  cfo: {
    key: "cfo",
    title: "CFO",
    subtitle: "Chief Financial Officer",
    jd: "cfo",
    manages: ["Accounting Manager", "Financial Analyst"],
  },
};

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export type DeptKey = "dispatch" | "fleet" | "eld" | "safety" | "ushr" | "cfo" | "uzbhr" | "it";

export interface Department {
  key: DeptKey;
  index: number;
  /** Card title */
  name: string;
  /** Used in breadcrumbs / drawer titles */
  longName: string;
  /** Short name for compact labels */
  shortName: string;
  parent: "COO" | "CEO";
  tagline: string;
  responsibilities: string[];
  /** For CFO, the department head is an executive (not counted in headcount) */
  headExec?: ExecNode["key"];
}

export const DEPARTMENTS: Department[] = [
  {
    key: "dispatch",
    index: 1,
    name: "Dispatch",
    longName: "Dispatch Department",
    shortName: "Dispatch",
    parent: "COO",
    tagline: "Load booking, broker negotiation & live load tracking",
    responsibilities: [
      "Load Planning", "Route Optimization", "Broker Relations", "Driver Communication",
      "Track & Monitor Loads", "Detention & Layover", "KPI Monitoring",
    ],
  },
  {
    key: "fleet",
    index: 2,
    name: "Fleet & Maintenance",
    longName: "Fleet Department",
    shortName: "Fleet",
    parent: "COO",
    tagline: "Truck maintenance, breakdowns & fleet costs",
    responsibilities: [
      "Truck Maintenance", "Breakdown Support", "Shop Coordination", "Equipment Procurement",
      "Fuel Management", "Parts & Inventory", "Terminal & Yard",
    ],
  },
  {
    key: "eld",
    index: 3,
    name: "ELD & IT Operations",
    longName: "ELD & IT Operations",
    shortName: "ELD & IT Ops",
    parent: "COO",
    tagline: "ELD devices, HOS log support & office IT",
    responsibilities: [
      "ELD Monitoring", "HOS Compliance", "Driver Support", "Hardware Management",
      "Network & Systems", "Troubleshooting", "Office IT Support",
    ],
  },
  {
    key: "safety",
    index: 4,
    name: "Safety & Compliance",
    longName: "Safety & Compliance",
    shortName: "Safety",
    parent: "COO",
    tagline: "DOT / FMCSA compliance, driver files & claims",
    responsibilities: [
      "DOT / FMCSA Compliance", "Driver Qualification", "HOS & ELD Monitoring", "Audit Preparation",
      "Incident Management", "Claims Management", "Safety Training", "Regulatory Reporting",
    ],
  },
  {
    key: "ushr",
    index: 5,
    name: "US HR (Driver Recruiting)",
    longName: "US HR (Driver Recruiting)",
    shortName: "US HR",
    parent: "COO",
    tagline: "Driver recruitment & onboarding",
    responsibilities: [
      "Driver Recruiting", "Initial Screening", "Interviews", "Offer & Onboarding",
      "Driver Relations", "Retention Programs", "Coordination with Safety", "Recruiting Strategy",
    ],
  },
  {
    key: "cfo",
    index: 6,
    name: "CFO",
    longName: "CFO Department",
    shortName: "CFO",
    parent: "CEO",
    tagline: "Billing, payments, payroll & driver settlements",
    responsibilities: [
      "Customer Invoicing", "Payment Collection", "Vendor Payments", "Payroll Processing",
      "Driver Settlements", "Budget & Forecasting", "Cost Analysis", "Financial Reporting", "Tax & Compliance",
    ],
    headExec: "cfo",
  },
  {
    key: "uzbhr",
    index: 7,
    name: "UZB HR (Office Staff)",
    longName: "UZB HR (Office Staff)",
    shortName: "UZB HR",
    parent: "CEO",
    tagline: "Office hiring, contracts & staff training",
    responsibilities: [
      "Office Staff Recruiting", "HR Administration", "Employment Contracts", "Personnel Documentation",
      "Attendance & Performance", "Employee Relations", "Training & Development", "Internal HR Policies",
    ],
  },
  {
    key: "it",
    index: 8,
    name: "IT Department",
    longName: "IT Department",
    shortName: "IT",
    parent: "CEO",
    tagline: "ERP / TMS, network, security & automation",
    responsibilities: [
      "ERP / TMS Management", "Network & Security", "Systems & Hardware", "Software Support",
      "Automation & Integration", "Cybersecurity", "Technical Support",
    ],
  },
];

export const DEPT_BY_KEY = Object.fromEntries(DEPARTMENTS.map((d) => [d.key, d])) as Record<DeptKey, Department>;

// ---------------------------------------------------------------------------
// Headcount model by fleet size
// ---------------------------------------------------------------------------

export interface RoleSeat {
  /** Stable id across sizes (used for deltas / NEW badges) */
  id: string;
  title: string;
  count: number;
  /** One or more JDs (several = one person covers merged roles) */
  jds: JDKey[];
  /** Department manager — listed first, accent dot */
  lead?: boolean;
}

export interface DeptModel {
  roles: RoleSeat[];
  /** Shown when the department has 0 staff */
  coveredBy?: string;
}

export interface FleetModel {
  trucks: number;
  name: string;
  departments: Record<DeptKey, DeptModel>;
}

export const TRUCK_STOPS = [5, 25, 50, 75, 100] as const;
export type TruckStop = (typeof TRUCK_STOPS)[number];

const r = (id: string, title: string, count: number, jds: JDKey[], lead = false): RoleSeat => ({
  id, title, count, jds, ...(lead ? { lead } : {}),
});

export const FLEET_MODELS: Record<TruckStop, FleetModel> = {
  5: {
    trucks: 5,
    name: "Micro Model",
    departments: {
      dispatch: { roles: [r("dispCombo", "Dispatcher (+ Load Planning, Broker & ELD)", 1, ["disp", "loadPl", "broker", "eldSpec"], true)] },
      fleet: { roles: [r("fleetSafety", "Fleet & Safety Coordinator", 1, ["fleetCoord", "safetySpec"], true)] },
      eld: { roles: [], coveredBy: "Covered by Dispatch" },
      safety: { roles: [], coveredBy: "Covered by Fleet" },
      ushr: { roles: [r("recruiterOnb", "Driver Recruiter (+ Onboarding)", 1, ["recruiter", "onboard"], true)] },
      cfo: { roles: [r("accountantHr", "Accountant (+ Office HR Admin)", 1, ["ar", "ap", "payroll", "kadr"], true)] },
      uzbhr: { roles: [], coveredBy: "Covered by CFO" },
      it: { roles: [], coveredBy: "Covered by an external IT vendor" },
    },
  },
  25: {
    trucks: 25,
    name: "Starter Model",
    departments: {
      dispatch: {
        roles: [
          r("dispMgr", "Dispatch Manager", 1, ["dispMgr"], true),
          r("disp", "Dispatcher", 2, ["disp"]),
          r("loadBroker", "Load Planner / Broker Relation", 1, ["loadPl", "broker"]),
        ],
      },
      fleet: {
        roles: [
          r("fleetMgr", "Fleet Manager", 1, ["fleetMgr"], true),
          r("fleetSpec", "Fleet Specialist", 1, ["fleetSpec"]),
        ],
      },
      eld: {
        roles: [
          r("eldLead", "ELD Operations Lead", 1, ["eldLead"], true),
          r("eldSpec", "ELD Specialist", 1, ["eldSpec"]),
        ],
      },
      safety: {
        roles: [
          r("safetyMgr", "Safety Manager", 1, ["safetyMgr"], true),
          r("safetySpec", "Safety Specialist", 1, ["safetySpec"]),
          r("compliance", "Compliance Coordinator", 1, ["compliance"]),
        ],
      },
      ushr: {
        roles: [
          r("ushrMgr", "US HR Manager", 1, ["ushrMgr"], true),
          r("recruiterOnb", "Driver Recruiter (+ Onboarding)", 1, ["recruiter", "onboard"]),
        ],
      },
      cfo: {
        roles: [
          r("acctMgr", "Accounting Manager", 1, ["acctMgr"], true),
          r("accountant", "Accountant (AR / AP / Payroll)", 1, ["ar", "ap", "payroll"]),
        ],
      },
      uzbhr: {
        roles: [
          r("uzbMgrRec", "UZB HR Manager (+ Recruiting)", 1, ["uzbMgr", "offRec"], true),
          r("kadr", "HR Administrator (Кадровик)", 1, ["kadr"]),
        ],
      },
      it: {
        roles: [
          r("itMgrSys", "IT Manager (+ SysAdmin)", 1, ["itMgr", "sysAdm"], true),
          r("itSup", "IT Support Specialist", 1, ["itSup"]),
        ],
      },
    },
  },
  50: {
    trucks: 50,
    name: "Growth Model",
    departments: {
      dispatch: {
        roles: [
          r("dispMgr", "Dispatch Manager", 1, ["dispMgr"], true),
          r("srDisp", "Senior Dispatcher", 1, ["srDisp"]),
          r("disp", "Dispatcher", 3, ["disp"]),
          r("loadPl", "Load Planner", 1, ["loadPl"]),
          r("broker", "Broker Relation", 1, ["broker"]),
        ],
      },
      fleet: {
        roles: [
          r("fleetMgr", "Fleet Manager", 1, ["fleetMgr"], true),
          r("fleetCoord", "Fleet Coordinator", 1, ["fleetCoord"]),
          r("fleetSpec", "Fleet Specialist", 1, ["fleetSpec"]),
          r("fleetAdmin", "Fleet Administrator", 1, ["fleetAdmin"]),
        ],
      },
      eld: {
        roles: [
          r("eldLead", "ELD Operations Lead", 1, ["eldLead"], true),
          r("eldSpec", "ELD Specialist", 2, ["eldSpec"]),
        ],
      },
      safety: {
        roles: [
          r("safetyMgr", "Safety Manager", 1, ["safetyMgr"], true),
          r("safetySpec", "Safety Specialist", 2, ["safetySpec"]),
          r("compliance", "Compliance Coordinator", 1, ["compliance"]),
          r("risk", "Risk & Claims Specialist", 1, ["risk"]),
        ],
      },
      ushr: {
        roles: [
          r("ushrMgr", "US HR Manager", 1, ["ushrMgr"], true),
          r("recruiter", "Driver Recruiter", 2, ["recruiter"]),
          r("onboard", "Driver Onboarding", 1, ["onboard"]),
          r("retention", "Driver Retention", 1, ["retention"]),
        ],
      },
      cfo: {
        roles: [
          r("acctMgr", "Accounting Manager", 1, ["acctMgr"], true),
          r("arap", "AR + AP Specialist", 1, ["ar", "ap"]),
          r("payroll", "Payroll & Settlements", 1, ["payroll"]),
        ],
      },
      uzbhr: {
        roles: [
          r("uzbMgr", "UZB HR Manager", 1, ["uzbMgr"], true),
          r("offRec", "Office Recruiter", 1, ["offRec"]),
          r("kadr", "HR Administrator (Кадровик)", 1, ["kadr"]),
          r("hrSupTr", "HR Support / Training", 1, ["hrSup", "training"]),
        ],
      },
      it: {
        roles: [
          r("itMgr", "IT Manager", 1, ["itMgr"], true),
          r("sysAdm", "System Administrator", 1, ["sysAdm"]),
          r("itSup", "IT Support Specialist", 1, ["itSup"]),
          r("autoErp", "Automation + ERP / TMS", 1, ["auto", "erp"]),
        ],
      },
    },
  },
  75: {
    trucks: 75,
    name: "Scale Model",
    departments: {
      dispatch: {
        roles: [
          r("dispMgr", "Dispatch Manager", 1, ["dispMgr"], true),
          r("srDisp", "Senior Dispatcher", 2, ["srDisp"]),
          r("disp", "Dispatcher", 5, ["disp"]),
          r("loadPl", "Load Planner", 1, ["loadPl"]),
          r("broker", "Broker Relation", 1, ["broker"]),
        ],
      },
      fleet: {
        roles: [
          r("fleetMgr", "Fleet Manager", 1, ["fleetMgr"], true),
          r("fleetCoord", "Fleet Coordinator", 1, ["fleetCoord"]),
          r("fleetSpec", "Fleet Specialist", 1, ["fleetSpec"]),
          r("fuel", "Fuel & Cost Analyst", 1, ["fuel"]),
          r("fleetAdmin", "Fleet Administrator", 1, ["fleetAdmin"]),
        ],
      },
      eld: {
        roles: [
          r("eldLead", "ELD Operations Lead", 1, ["eldLead"], true),
          r("eldSpec", "ELD Specialist", 2, ["eldSpec"]),
          r("eldIt", "IT Support", 1, ["eldIt"]),
        ],
      },
      safety: {
        roles: [
          r("safetyMgr", "Safety Manager", 1, ["safetyMgr"], true),
          r("safetySpec", "Safety Specialist", 3, ["safetySpec"]),
          r("compliance", "Compliance Coordinator", 1, ["compliance"]),
          r("risk", "Risk & Claims Specialist", 1, ["risk"]),
        ],
      },
      ushr: {
        roles: [
          r("ushrMgr", "US HR Manager", 1, ["ushrMgr"], true),
          r("recruiter", "Driver Recruiter", 3, ["recruiter"]),
          r("onboard", "Driver Onboarding", 1, ["onboard"]),
          r("retention", "Driver Retention", 1, ["retention"]),
        ],
      },
      cfo: {
        roles: [
          r("acctMgr", "Accounting Manager", 1, ["acctMgr"], true),
          r("ar", "Accounts Receivable", 1, ["ar"]),
          r("ap", "Accounts Payable", 1, ["ap"]),
          r("payroll", "Payroll & Settlements", 1, ["payroll"]),
        ],
      },
      uzbhr: {
        roles: [
          r("uzbMgr", "UZB HR Manager", 1, ["uzbMgr"], true),
          r("offRec", "Office Recruiter", 1, ["offRec"]),
          r("kadr", "HR Administrator (Кадровик)", 2, ["kadr"]),
          r("hrSup", "HR Support", 1, ["hrSup"]),
          r("training", "Training & Development", 1, ["training"]),
        ],
      },
      it: {
        roles: [
          r("itMgr", "IT Manager", 1, ["itMgr"], true),
          r("sysAdm", "System Administrator", 1, ["sysAdm"]),
          r("itSup", "IT Support Specialist", 2, ["itSup"]),
          r("auto", "Automation Specialist", 1, ["auto"]),
          r("erp", "ERP / TMS Specialist", 1, ["erp"]),
        ],
      },
    },
  },
  100: {
    trucks: 100,
    name: "Standard Model",
    departments: {
      dispatch: {
        roles: [
          r("dispMgr", "Dispatch Manager", 1, ["dispMgr"], true),
          r("srDisp", "Senior Dispatcher", 2, ["srDisp"]),
          r("disp", "Dispatcher", 7, ["disp"]),
          r("loadPl", "Load Planner", 1, ["loadPl"]),
          r("broker", "Broker Relation", 1, ["broker"]),
        ],
      },
      fleet: {
        roles: [
          r("fleetMgr", "Fleet Manager", 1, ["fleetMgr"], true),
          r("fleetCoord", "Fleet Coordinator", 2, ["fleetCoord"]),
          r("fleetSpec", "Fleet Specialist", 1, ["fleetSpec"]),
          r("fuel", "Fuel & Cost Analyst", 1, ["fuel"]),
          r("fleetAdmin", "Fleet Administrator", 1, ["fleetAdmin"]),
        ],
      },
      eld: {
        roles: [
          r("eldLead", "ELD Operations Lead", 1, ["eldLead"], true),
          r("eldSpec", "ELD Specialist", 3, ["eldSpec"]),
          r("eldIt", "IT Support", 1, ["eldIt"]),
        ],
      },
      safety: {
        roles: [
          r("safetyMgr", "Safety Manager", 1, ["safetyMgr"], true),
          r("safetySpec", "Safety Specialist", 4, ["safetySpec"]),
          r("compliance", "Compliance Coordinator", 2, ["compliance"]),
          r("risk", "Risk & Claims Specialist", 1, ["risk"]),
        ],
      },
      ushr: {
        roles: [
          r("ushrMgr", "US HR Manager", 1, ["ushrMgr"], true),
          r("recruiter", "Driver Recruiter", 4, ["recruiter"]),
          r("onboard", "Driver Onboarding", 2, ["onboard"]),
          r("retention", "Driver Retention", 1, ["retention"]),
        ],
      },
      cfo: {
        roles: [
          r("acctMgr", "Accounting Manager", 1, ["acctMgr"], true),
          r("ar", "Accounts Receivable", 1, ["ar"]),
          r("ap", "Accounts Payable", 1, ["ap"]),
          r("payroll", "Payroll & Settlements", 1, ["payroll"]),
          r("finAn", "Financial Analyst", 1, ["finAn"]),
        ],
      },
      uzbhr: {
        roles: [
          r("uzbMgr", "UZB HR Manager", 1, ["uzbMgr"], true),
          r("offRec", "Office Recruiter", 2, ["offRec"]),
          r("kadr", "HR Administrator (Кадровик)", 2, ["kadr"]),
          r("hrSup", "HR Support", 1, ["hrSup"]),
          r("training", "Training & Development", 1, ["training"]),
        ],
      },
      it: {
        roles: [
          r("itMgr", "IT Manager", 1, ["itMgr"], true),
          r("sysAdm", "System Administrator", 2, ["sysAdm"]),
          r("itSup", "IT Support Specialist", 2, ["itSup"]),
          r("auto", "Automation Specialist", 1, ["auto"]),
          r("erp", "ERP / TMS Specialist", 1, ["erp"]),
        ],
      },
    },
  },
};

export const DEFAULT_TRUCKS: TruckStop = 100;
