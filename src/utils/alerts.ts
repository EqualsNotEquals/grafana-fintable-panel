// Edge-triggered de-dup: an alert popup should fire once per new qualifying
// RFQ id, not on every panel refresh while it's still open. Tracked in
// sessionStorage (per browser tab) so it survives panel re-renders.
function loadSeenIds(storageKey: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeenIds(storageKey: string, ids: Set<string>) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(Array.from(ids)));
  } catch {
    // sessionStorage unavailable (e.g. private browsing) — de-dup falls back
    // to in-memory only for this render.
  }
}

export function pickNewAlertIds(storageKey: string, candidateIds: string[]): string[] {
  const seen = loadSeenIds(storageKey);
  // Dedup within this batch too, not just against what's already persisted
  // — otherwise the same id appearing more than once in candidateIds (e.g.
  // rapid successive filter-model updates handing over overlapping lists)
  // would all pass the "not seen yet" check at once, since `seen` isn't
  // updated until after the whole batch is filtered.
  const fresh: string[] = [];
  for (const id of candidateIds) {
    if (!seen.has(id)) {
      seen.add(id);
      fresh.push(id);
    }
  }
  if (fresh.length > 0) {
    saveSeenIds(storageKey, seen);
  }
  return fresh;
}
