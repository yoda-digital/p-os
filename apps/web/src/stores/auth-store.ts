import { create } from 'zustand';
import { api, type User } from '../lib/api';

interface AuthState {
  token: string | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  loadProfile: () => Promise<void>;
  initialize: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  loading: false,
  error: null,

  initialize: () => {
    try {
      const token = localStorage.getItem('pos_token');
      if (token) {
        set({ token });
      }
    } catch {
      // localStorage unavailable
    }
  },

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const res = await api.login(email, password);
      localStorage.setItem('pos_token', res.token);
      set({ token: res.token, user: res.user, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Login failed' });
      throw err;
    }
  },

  register: async (email, password, displayName) => {
    set({ loading: true, error: null });
    try {
      const res = await api.register(email, password, displayName);
      localStorage.setItem('pos_token', res.token);
      set({ token: res.token, user: res.user, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Registration failed' });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem('pos_token');
    set({ token: null, user: null });
  },

  loadProfile: async () => {
    try {
      const user = await api.getProfile();
      set({ user });
    } catch {
      set({ token: null, user: null });
      localStorage.removeItem('pos_token');
    }
  },
}));

// Initialize on load
useAuthStore.getState().initialize();
