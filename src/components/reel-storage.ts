import {
  readReelState,
  REEL_STORAGE_KEY,
  type ReelSettings,
  type ReelState,
  type ReelVote,
} from "@/core/reels";

// The visitor's Reels place and votes, kept on their device only. Reels and
// the night map read and write the same record, so a like on either one
// shapes both.

export function saveReelState(
  settings: ReelSettings | null,
  votes: ReelVote[],
) {
  try {
    localStorage.setItem(
      REEL_STORAGE_KEY,
      JSON.stringify({ version: 1, settings, votes }),
    );
    window.dispatchEvent(new Event("evryvibe-reels-change"));
  } catch {
    // Storage full or blocked: the feed keeps working for this visit.
  }
}

export function loadReelState(): ReelState {
  try {
    const raw = localStorage.getItem(REEL_STORAGE_KEY);
    return readReelState(raw ? JSON.parse(raw) : null);
  } catch {
    return readReelState(null);
  }
}

/** Saves votes from another surface without touching the stored place. */
export function saveReelVotes(votes: ReelVote[]) {
  saveReelState(loadReelState().settings, votes);
}
