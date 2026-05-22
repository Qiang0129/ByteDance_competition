import { apiRequest, clearAuthToken, setAuthToken } from './client';
import type { CurrentUserResponse, LoginRequest, LoginResponse } from '../types/auth';

export const authApi = {
  async login(payload: LoginRequest): Promise<LoginResponse> {
    const response = await apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipAuth: true,
    });

    setAuthToken(response.accessToken);
    return response;
  },

  async logout(): Promise<void> {
    try {
      await apiRequest<void>('/auth/logout', {
        method: 'POST',
      });
    } finally {
      clearAuthToken();
    }
  },

  getCurrentUser(): Promise<CurrentUserResponse> {
    return apiRequest<CurrentUserResponse>('/auth/me');
  },
};
