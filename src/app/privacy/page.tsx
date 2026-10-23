import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui";

export const metadata: Metadata = {
  title: "Drenix · Privacy Policy",
  description: "How the Drenix Assistant Telegram bot handles personal data and Google Calendar access.",
};

const UPDATED = "October 24, 2026";
const CONTACT = "drenixit@gmail.com";

export default function PrivacyPage() {
  return (
    <div className="legal">
      <header className="legal-head">
        <Link href="/" className="brand" aria-label="Drenix — organizational structure">
          <Logo />
          <span className="brand-word">DRENIX</span>
        </Link>
      </header>

      <main className="legal-body">
        <p className="legal-kicker">Drenix Assistant</p>
        <h1>Privacy Policy</h1>
        <p className="legal-meta">Last updated: {UPDATED}</p>

        <p>
          Drenix Assistant is an internal Telegram bot operated by Drenix (Tashkent, Uzbekistan). It helps our HR team
          receive hiring requests, plan their work and schedule interviews. This policy explains what data the bot uses
          and why.
        </p>

        <h2>Who uses the bot</h2>
        <ul>
          <li>Authorized Drenix staff, identified by their Telegram user ID.</li>
          <li>Job candidates who open a personal interview invitation link sent to them by our HR team.</li>
        </ul>

        <h2>Data we collect</h2>
        <ul>
          <li>
            <b>Telegram data:</b> user ID, name, username, chosen language, and the messages and voice notes you send to
            the bot.
          </li>
          <li>
            <b>Candidate details</b> provided by HR or by the candidate: name, contact (Telegram, phone, email), the
            position applied for and interview times.
          </li>
          <li>
            <b>Hiring requests</b> submitted through the recruitment form on this website.
          </li>
          <li>
            <b>Work data</b> created by staff: tasks, notes, reminders and reports.
          </li>
        </ul>

        <h2>Google Calendar access</h2>
        <p>
          With the account owner&apos;s permission, the bot connects to the company Google Calendar ({CONTACT}). It reads
          free/busy times to find open slots and creates, updates or cancels events and Google Meet links for meetings
          and interviews. When a candidate provides an email address, Google may send them a calendar invitation.
        </p>
        <p>
          Drenix Assistant&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Google data is used only to provide the scheduling features above.
          It is never sold, used for advertising, or shared with third parties.
        </p>

        <h2>How we use data</h2>
        <ul>
          <li>To deliver hiring requests to the HR team.</li>
          <li>To create tasks, plans, reminders and reports for staff.</li>
          <li>To schedule interviews and notify candidates about confirmations and changes.</li>
        </ul>

        <h2>Service providers</h2>
        <p>
          Messages are delivered through Telegram. Text and voice notes are processed by OpenAI to understand requests
          and transcribe speech; OpenAI does not use API data to train its models. Calendar features use Google
          Calendar. We do not share data with anyone else.
        </p>

        <h2>Storage and retention</h2>
        <p>
          Data is stored on Drenix&apos;s own server and is accessible only to authorized staff. If a candidate is not
          selected, the bot removes its conversation messages where Telegram allows it and closes the candidate&apos;s
          access. Staff work data is kept while it is needed for reporting.
        </p>

        <h2>Your choices</h2>
        <p>
          You can stop using the bot at any time by blocking it in Telegram. To ask for a copy of your data or its
          deletion, contact us at <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. The calendar connection can be revoked
          at any time from the Google Account security settings.
        </p>

        <h2>Contact</h2>
        <p>
          Drenix · 25 Jangoh St, 100015 Tashkent, Uzbekistan ·{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </main>
    </div>
  );
}
