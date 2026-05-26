import { apiRequest, clearAuthToken, setAuthToken } from './client';
import type { AuthUser, CurrentUserResponse, LoginRequest, LoginResponse, RegisterRequest } from '../types/auth';

const AUTH_USER_KEY = 'labelhub_current_user';

export function getStoredAuthUser(): AuthUser | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const value = window.localStorage.getItem(AUTH_USER_KEY);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as AuthUser;
  } catch {
    window.localStorage.removeItem(AUTH_USER_KEY);
    return null;
  }
}

export function setStoredAuthUser(user: AuthUser) {
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function clearStoredAuthUser() {
  window.localStorage.removeItem(AUTH_USER_KEY);
}

export const authApi = {
  async login(payload: LoginRequest): Promise<LoginResponse> {
    const response = await apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipAuth: true,
    });

    setAuthToken(response.accessToken);
    setStoredAuthUser(response.user);
    return response;
  },

  async logout(): Promise<void> {
    try {
      await apiRequest<void>('/auth/logout', {
        method: 'POST',
      });
    } finally {
      clearAuthToken();
      clearStoredAuthUser();
    }
  },

  async getCurrentUser(): Promise<CurrentUserResponse> {
    const response = await apiRequest<CurrentUserResponse>('/auth/me');
    setStoredAuthUser(response.user);
    return response;
  },

  register(payload: RegisterRequest): Promise<AuthUser> {
    return apiRequest<AuthUser>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipAuth: true,
    });
  },
};
