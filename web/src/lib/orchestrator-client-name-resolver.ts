import type { ClientRecord } from "@/lib/contracts";

// AI Concierge / Orchestrator -- Production Fix #1 (client name resolution).
// Pure, deterministic client-name-candidate extraction + matching. No DB, no
// AI provider, no React -- mirrors orchestrator-intent-classifier.ts's own
// established "pure logic file, fully unit-tested" split (that file's own
// caller, orchestrator-service.ts, wires this one to a real, owner-scoped
// DB read the exact same way).
//
// SECURITY (the one rule this whole module exists to enforce): this can
// NEVER produce or accept a client id from free text. extractCandidateClientName
// only ever returns a plain, untrusted NAME string pulled out of the raw
// message -- never an id, never anything id-shaped by construction (the
// pattern below requires the candidate to START with an uppercase LETTER,
// which already excludes a UUID). matchClientNameCandidates only ever
// compares that string against `fullName` on REAL rows the caller already
// fetched from a real, owner-scoped repository call (listClientsForOwner --
// see orchestrator-service.ts) -- it never reads or matches against `.id`
// at all, so even a candidate string that happens to literally BE a real
// client's id can only ever resolve by (im)probably equaling that client's
// actual fullName text, never as an id shortcut.
//
// SCOPE (deliberately narrow, matching orchestrator-intent-classifier.ts's
// own EN/RO-only precedent): recognizes two families of phrasing, each
// immediately (optionally through a short connector: pe/cu/on/with)
// followed by one or two capitalized words:
//  - the word "client" (or a Romanian inflection of it: clientul/
//    clientului/clienta/clientei/clienți) -- this task's own originally
//    reported production failure ("clientul Baciu");
//  - a "lucr"-rooted Romanian verb form (lucrez/lucrăm/lucra/lucrați, "to
//    work") or an English "work"-rooted one -- Voice Input Integration's
//    own explicit required phrasing ("Vreau să lucrez pe Baciu." / "I want
//    to work on Baciu"), added for that task, reusing this exact same
//    extraction+resolution mechanism rather than inventing a second one.
// A missed pattern is always safe (falls through to the existing
// "no client selected" behavior, unchanged) -- a wrong-looking match is
// still always safe too, since it is only ever a CANDIDATE, subject to real
// DB verification below, never trusted on its own.

const MAX_CANDIDATE_NAME_LENGTH = 100;

// [Cc]/[Ll]/[Ww] (not the `i` flag) deliberately keep ONLY the trigger
// keyword case-insensitive -- a sentence-initial "Clientul Baciu..." or
// "Lucrez pe Baciu..." must still match -- while the captured NAME itself
// stays fully case-sensitive (requires a real uppercase first letter),
// which is what keeps an ordinary lowercase word after the trigger from
// ever being extracted at all (see this module's own SCOPE note above).
// The optional connector (pe/cu/on/with) is consumed but never captured --
// "lucrez pe Baciu" and "clientul Baciu" both resolve to the identical
// candidate "Baciu".
const CANDIDATE_NAME_PATTERN = /\b(?:[Cc]lient\p{L}*|[Ll]ucr\p{L}*|[Ww]ork\p{L}*)\s+(?:pe\s+|cu\s+|on\s+|with\s+)?([\p{Lu}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*)?)/u;

export function extractCandidateClientName(message: string): string | null {
  const match = CANDIDATE_NAME_PATTERN.exec(message);
  if (!match) return null;
  const candidate = match[1].trim().replace(/\s+/g, " ");
  if (!candidate || candidate.length > MAX_CANDIDATE_NAME_LENGTH) return null;
  return candidate;
}

export interface ClientNameCandidate {
  clientId: string;
  fullName: string;
}

export type ClientNameMatchResult =
  | { kind: "resolved"; clientId: string }
  | { kind: "ambiguous"; candidates: ClientNameCandidate[] }
  | { kind: "not_found" };

// Diacritic-insensitive, case-insensitive, whitespace-collapsing --
// task's own required test list ("case differences", "whitespace
// differences", "diacritics where appropriate"). NFD + stripping combining
// marks handles Romanian's ă/â/î/ș/ț the same generic way it handles any
// other accented Latin letter -- no per-language special-casing needed.
function normalizeForNameMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(normalized: string): string[] {
  return normalized.length ? normalized.split(" ") : [];
}

// A client is a candidate match when EVERY token on one side appears among
// the other side's tokens, in either direction -- lets a short candidate
// ("Baciu") match a longer stored full name ("Baciu Ionuț") and, just as
// safely, a longer candidate match a shorter stored name, without doing a
// loose substring compare that could cross unrelated names. Deliberately
// permissive enough to catch every real duplicate (task's own required
// "duplicate/ambiguous names" case depends on this, not on cleverness) --
// over-matching only ever produces MORE ambiguity, never a wrong silent
// resolution, since a single non-unique match is never auto-selected
// (see matchClientNameCandidates below).
function isTokenMatch(candidateTokens: readonly string[], nameTokens: readonly string[]): boolean {
  if (candidateTokens.length === 0 || nameTokens.length === 0) return false;
  const candidateSet = new Set(candidateTokens);
  const nameSet = new Set(nameTokens);
  const candidateSubsetOfName = candidateTokens.every((token) => nameSet.has(token));
  const nameSubsetOfCandidate = nameTokens.every((token) => candidateSet.has(token));
  return candidateSubsetOfName || nameSubsetOfCandidate;
}

// Given an untrusted candidate name and the REAL list of an owner's real
// clients (already owner-scoped by the caller -- see this module's own
// header comment), returns exactly one of three safe states. Never guesses
// between multiple matches (`ambiguous`), never invents a client
// (`not_found`) -- the ONLY way this ever returns `resolved` is a single,
// unique match against a real row already present in `clients`.
export function matchClientNameCandidates(candidateName: string, clients: readonly ClientRecord[]): ClientNameMatchResult {
  const candidateTokens = tokenize(normalizeForNameMatch(candidateName));

  const matches: ClientNameCandidate[] = [];
  for (const client of clients) {
    const nameTokens = tokenize(normalizeForNameMatch(client.fullName));
    if (isTokenMatch(candidateTokens, nameTokens)) {
      matches.push({ clientId: client.id, fullName: client.fullName });
    }
  }

  if (matches.length === 1) return { kind: "resolved", clientId: matches[0].clientId };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
  return { kind: "not_found" };
}
