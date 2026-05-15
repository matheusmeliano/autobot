"use client";

import { create } from "zustand";

type SessionState = {
  email: string;
  setEmail: (email: string) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  email: "",
  setEmail: (email) => set({ email }),
}));

