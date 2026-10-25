import { create } from 'zustand';

// Find me, both sides. The finder asks over the mesh; the friend's phone
// buzzes; one tap and the friend's phone helps (live GPS, Ultra Wideband).
// In memory only: a search is minutes long and doesn't survive a relaunch.

/** My search for someone. */
export interface Outgoing {
  target: number;
  askedAt: number;
  remindedAt: number | null;
  positionAskedAt: number | null; // last direct request to their radio
  helping: boolean | null;        // null: no answer yet
}

/** Someone asking me for help, not answered yet. */
export interface Incoming {
  finder: number;
  finderName: string;
  at: number;
}

/** I'm helping someone find me. */
export interface Helping {
  finder: number;
  finderName: string;
  startedAt: number;
  liveSentAt: number | null;
}

interface FindState {
  outgoing: Outgoing | null;
  incoming: Incoming | null;
  helping: Helping | null;
  setOutgoing: (o: Outgoing | null) => void;
  setIncoming: (i: Incoming | null) => void;
  setHelping: (h: Helping | null) => void;
}

export const useFindStore = create<FindState>((set) => ({
  outgoing: null,
  incoming: null,
  helping: null,
  setOutgoing: (outgoing) => set({ outgoing }),
  setIncoming: (incoming) => set({ incoming }),
  setHelping: (helping) => set({ helping }),
}));
