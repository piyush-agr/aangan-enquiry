import fs from "node:fs";
import path from "node:path";
import type { Turn } from "@/lib/qualification/extract";

/**
 * Parses the phone section (T01–T20) of knowledge/test-material/Aangan_Sep2026_Enquiries.extracted.txt
 * (text extracted verbatim from "Aangan_Sep 2026_Enquiries.pdf"). WhatsApp (W) and web-form (F) records
 * are NOT parsed as phone calls — they are a different channel.
 *
 * The transcripts are TEST MATERIAL. They are never inserted into the production database.
 */

export interface PhoneTranscript {
  id: string;
  header: string;
  date: Date;
  missed: boolean;
  /** For T17 the record holds two calls. */
  calls: Turn[][];
  notes: string[];
}

const FILE = path.resolve(__dirname, "../../knowledge/test-material/Aangan_Sep2026_Enquiries.extracted.txt");

function parseDate(header: string): Date {
  const m = /·\s*(\d{1,2})\s+September\s*·\s*(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(header);
  if (!m) throw new Error(`Cannot parse date from ${header}`);
  let h = Number(m[2]) % 12;
  if (m[4]!.toLowerCase() === "pm") h += 12;
  // IST → UTC
  return new Date(Date.UTC(2026, 8, Number(m[1]), h - 5, Number(m[3]) - 30));
}

export function loadPhoneTranscripts(): PhoneTranscript[] {
  const raw = fs.readFileSync(FILE, "utf8");
  const phone = raw.slice(raw.indexOf("SECTION 1 — PHONE CALLS"), raw.indexOf("SECTION 2 — WHATSAPP"));
  const lines = phone.split("\n");
  const out: PhoneTranscript[] = [];
  let cur: PhoneTranscript | null = null;
  let call: Turn[] = [];
  let last: Turn | null = null;
  const flush = () => {
    if (cur && call.length) cur.calls.push(call);
    call = [];
    last = null;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const head = /^(T\d\d) · Phone · (.*)$/.exec(line);
    if (head) {
      flush();
      if (cur) out.push(cur);
      cur = { id: head[1]!, header: line, date: parseDate(line), missed: /MISSED CALL/.test(line), calls: [], notes: [] };
      continue;
    }
    if (!cur) continue;
    if (/^(First call|Second call)/.test(line)) {
      flush();
      continue;
    }
    const fd = /^Front Desk:\s*(.*)$/.exec(line);
    const cl = /^Caller:\s*(.*)$/.exec(line);
    if (fd) {
      last = { role: "AGENT", text: fd[1]! };
      call.push(last);
    } else if (cl) {
      last = { role: "CALLER", text: cl[1]! };
      call.push(last);
    } else if (/^Note:/.test(line) || (cur.missed && line)) {
      cur.notes.push(line);
      last = null;
    } else if (line && last) {
      last.text += " " + line;
    }
  }
  flush();
  if (cur) out.push(cur);
  return out;
}

export function transcript(id: string): PhoneTranscript {
  const t = loadPhoneTranscripts().find((x) => x.id === id);
  if (!t) throw new Error(`Transcript ${id} not found`);
  return t;
}
