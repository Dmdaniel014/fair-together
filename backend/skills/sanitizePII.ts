// ─────────────────────────────────────────────────────────────────────────────
//  skills/sanitizePII.ts
//  Strip personally-identifying information before sending user-authored text
//  to Anthropic or persisting it in the shared chat/analyzer history.
//
//  Covers (Israel-specific):
//    - Israeli ID (ת.ז) — weighted Luhn validation (avoids matching random 9-digit strings)
//    - Credit card — standard Luhn
//    - IBAN (IL##...)
//    - Phone numbers (0##-### ####)
//    - Email addresses
//
//  Fail-safe: only replaces when the candidate passes the checksum.
//  Returns the cleaned string and a list of hit types for audit logs.
// ─────────────────────────────────────────────────────────────────────────────

const IL_ID_RE  = /(?<![\d])\d{9}(?![\d])/g;
const CC_RE     = /(?<![\d])(?:\d[ -]?){13,19}(?![\d])/g;
const PHONE_RE  = /\b0\d{1,2}[- ]?\d{3}[- ]?\d{4}\b/g;
const IBAN_RE   = /\bIL\d{2}[ -]?(?:\d[ -]?){17,20}\b/gi;
const EMAIL_RE  = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;

// Standard Luhn (credit cards).
function luhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, '').split('').map(Number);
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0, parity = digits.length % 2;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[i];
    if (i % 2 === parity) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

// Israeli ID check — weighted 1,2,1,2,... sum mod 10.
function validIsraeliId(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let x = Number(d[i]) * ((i % 2) + 1);
    if (x > 9) x -= 9;
    sum += x;
  }
  return sum % 10 === 0;
}

export type PIIHit = 'IL_ID' | 'CC' | 'IBAN' | 'PHONE' | 'EMAIL';

export function sanitizePII(input: string): { clean: string; hits: PIIHit[] } {
  if (!input) return { clean: input, hits: [] };
  const hits: PIIHit[] = [];
  let out = input;

  // Order matters: IBAN before CC (IBAN also looks like a long digit run),
  // CC before IL_ID (CC can overlap a 9-digit window),
  // phone and email last.
  out = out.replace(IBAN_RE, () => { hits.push('IBAN'); return '[IBAN הוסתר]'; });
  out = out.replace(CC_RE,   m  => { if (luhn(m))           { hits.push('CC');    return '[כרטיס אשראי הוסתר]'; } return m; });
  out = out.replace(IL_ID_RE, m => { if (validIsraeliId(m)) { hits.push('IL_ID'); return '[ת.ז הוסתרה]'; } return m; });
  out = out.replace(PHONE_RE, () => { hits.push('PHONE'); return '[טלפון הוסתר]'; });
  out = out.replace(EMAIL_RE, () => { hits.push('EMAIL'); return '[אימייל הוסתר]'; });

  return { clean: out, hits };
}
