export type UserRole = 'owner' | 'labeler' | 'reviewer' | 'ai_reviewer' | 'admin' | 'system_agent';

export interface LoginRequest {
  username: string;
  password: string;
  role?: UserRole;
  turnstileToken?: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  role?: Exclude<UserRole, 'admin' | 'system_agent' | 'ai_reviewer'>;
  inviteToken?: string;
  ownerInviteToken?: string;
  turnstileToken?: string;
}

export interface PasswordResetCodeRequest {
  username: string;
  email: string;
  turnstileToken?: string;
}

export interface PasswordResetCodeResponse {
  message: string;
  expiresInSeconds: number;
  resendCooldownSeconds: number;
}

export interface PasswordResetConfirmRequest {
  username: string;
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export interface PasswordResetConfirmResponse {
  message: string;
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

export interface CreateReviewerInvitationResponse {
  token: string;
  expiresAt: string;
}

export interface CreateOwnerInvitationResponse {
  token: string;
  expiresAt: string;
}

export interface ReviewerInvitationValidationResponse {
  valid: boolean;
  reason?: 'invalid' | 'expired' | 'used' | null;
  expiresAt?: string | null;
}

export interface OwnerInvitationValidationResponse {
  valid: boolean;
  reason?: 'invalid' | 'expired' | 'used' | null;
  expiresAt?: string | null;
}
