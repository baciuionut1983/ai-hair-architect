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
// pattern below requires the candidate to start with a real Unicode LETTER,
// which already excludes a UUID, which starts with a digit).
// matchClientNameCandidates only ever compares that string against
// `fullName` on REAL rows the caller already fetched from a real,
// owner-scoped repository call (listClientsForOwner -- see
// orchestrator-service.ts) -- it never reads or matches against `.id` at
// all, so even a candidate string that happens to literally BE a real
// client's id can only ever resolve by (im)probably equaling that client's
// actual fullName text, never as an id shortcut.
//
// SCOPE (deliberately narrow, matching orchestrator-intent-classifier.ts's
// own EN/RO-only precedent): recognizes three families of phrasing:
//  - the word "client" (or a Romanian inflection of it: clientul/
//    clientului/clienta/clientei/clienți), optionally through a short
//    connector (pe/cu/on/with) -- this task's own originally reported
//    production failure ("clientul Baciu");
//  - a "lucr"-rooted Romanian verb form (lucrez/lucrăm/lucra/lucrați, "to
//    work") or an English "work"-rooted one, optionally through the same
//    connector -- Voice Input Integration's own explicit required
//    phrasing ("Vreau să lucrez pe Baciu." / "I want to work on Baciu");
//  - PRODUCTION FIX (real production evidence: "Vreau să văd rezultatul
//    pentru Baciu." never resolved a client) -- a bare "pentru"/"despre"/
//    "for" directly followed by a name, e.g. "rezultatul pentru Baciu",
//    "ce avem despre Baciu", "the result for Baciu". Unlike the two
//    families above, these three words are ordinary, semantically-empty
//    prepositions that can precede ANY noun, not necessarily a name (e.g.
//    "o rezervare pentru mâine", "search for treatments") -- so, UNLIKE
//    client/lucr/work, the word immediately following them must be
//    CAPITALIZED (the same signal already used for an optional SECOND
//    word below). This is what keeps "pentru mâine"/"for treatments" from
//    ever being extracted as a candidate at all, while still catching
//    every one of this fix's own required real-world phrasings (a
//    properly-typed name is capitalized). A message needing the exact
//    "lowercase name after 'pentru'" leniency the client/lucr/work
//    families already have can still say "clientul <name>"/"lucrez pe
//    <name>" -- this new family only ever ADDS coverage, never narrows
//    the existing one.
//
// PRODUCTION BUG (real, confirmed, this fix's own reason for existing):
// the ORIGINAL version of this pattern required the captured word to START
// WITH AN UPPERCASE LETTER -- meant to distinguish "a name" from "an
// ordinary word" without any real NLP. A real production message, "vreau
// sa lucrez pe baciu" (typed all-lowercase, no diacritics -- extremely
// common casual typing, and exactly what many STT transcripts also
// produce for a name outside the provider's vocabulary), never matched
// that capture at all: extractCandidateClientName silently returned null,
// so a real, unique, owner-scoped "Baciu Ionuț Stelian" was never even
// attempted. The capitalization gate is now applied ONLY to the OPTIONAL
// second word of a two-word candidate (see below) -- never to the first --
// closing this exact bug while still bounding the blast radius.
// A missed pattern is always safe (falls through to the existing
// "no client selected" behavior, unchanged) -- a wrong-looking match is
// still always safe too, since it is only ever a CANDIDATE, subject to real
// DB verification below, never trusted on its own; a candidate that never
// matches any real client produces an honest "not found," never a wrong
// resolution (see this task's own explicit product rule: "if none match,
// say so honestly").

const MAX_CANDIDATE_NAME_LENGTH = 100;

// [Cc]/[Ll]/[Ww] (not the `i` flag) deliberately keep ONLY the trigger
// keyword case-insensitive -- a sentence-initial "Clientul Baciu..." or
// "Lucrez pe Baciu..." must still match. The FIRST captured word is
// deliberately case-INSENSITIVE now (any real letter, not just uppercase --
// see the PRODUCTION BUG note above) -- this is what makes "lucrez pe
// baciu" resolve. The OPTIONAL second word of a two-word candidate stays
// capitalization-gated ([\p{Lu}] only): loosening it too would let this
// regex greedily swallow an unrelated trailing lowercase word (e.g. "...pe
// Baciu azi" would otherwise capture "Baciu azi" as one candidate, which
// then fails to match "Baciu Ionuț Stelian" at all -- a real match lost by
// being too greedy). A single, case-insensitive first word is enough: the
// downstream token-subset matcher (isTokenMatch below) already lets a
// short candidate like "baciu" match a longer stored name like "Baciu
// Ionuț Stelian" on its own.
const CANDIDATE_NAME_PATTERN =
  /\b(?:[Cc]lient\p{L}*|[Ll]ucr\p{L}*|[Ww]ork\p{L}*)\s+(?:pe\s+|cu\s+|on\s+|with\s+)?(\p{L}[\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*)?)|\b(?:[Pp]entru|[Dd]espre|[Ff]or)\s+([\p{Lu}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*)?)/u;

// Guards against the regex's own optional connector (pe/cu/on/with) being
// captured AS the name when nothing real follows it (e.g. a message ending
// right after "lucrez pe") -- now that the capture is case-insensitive,
// the connector words themselves would otherwise be valid matches for it.
// Never a real candidate; case-insensitive since the capture itself is.
const RESERVED_CONNECTOR_WORDS = new Set(["pe", "cu", "on", "with"]);

export function extractCandidateClientName(message: string): string | null {
  const match = CANDIDATE_NAME_PATTERN.exec(message);
  if (!match) return null;
  // Exactly one of the two alternatives' capture groups is ever populated
  // for a given match -- group 1 for client/lucr/work, group 2 for the
  // capitalization-gated pentru/despre/for family (see this file's own
  // header comment on why the two families need different capture rules).
  const rawCandidate = match[1] ?? match[2];
  if (!rawCandidate) return null;
  const candidate = rawCandidate.trim().replace(/\s+/g, " ");
  if (!candidate || candidate.length > MAX_CANDIDATE_NAME_LENGTH) return null;
  if (RESERVED_CONNECTOR_WORDS.has(candidate.toLowerCase())) return null;
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
