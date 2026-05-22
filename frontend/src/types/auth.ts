export type UserRole = 'owner' | 'labeler' | 'reviewer' | 'admin';

export interface LoginRequest {
  username: string;
  password: string;
  role?: UserRole;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  roles: UserRole[];
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AuthUser;
}

export interface CurrentUserResponse {
  user: AuthUser;
  permissions: string[];
}
