import { create } from "zustand";
import type { AuthResponse, User } from "@mtg/shared";
import { api } from "@/api/client";

interface AuthState {
  user: User | null;
  loading: boolean;
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (data: { username: string; displayName: string; password: string; inviteCode: string }) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  init: async () => {
    try {
      const res = await api.get<AuthResponse>("/api/auth/me");
      set({ user: res.user, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },
  login: async (username, password) => {
    const res = await api.post<AuthResponse>("/api/auth/login", { username, password });
    set({ user: res.user });
  },
  register: async (data) => {
    const res = await api.post<AuthResponse>("/api/auth/register", data);
    set({ user: res.user });
  },
  logout: async () => {
    await api.post("/api/auth/logout");
    set({ user: null });
  },
}));
