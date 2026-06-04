const DEFAULT_API_BASE_URL = '/api';
const AUTH_TOKEN_KEY = 'labelhub_access_token';

export interface ApiRequestOptions extends RequestInit {
  skipAuth?: boolean;
  token?: string | null;
  responseType?: 'json' | 'text' | 'blob';
}

function readPayloadText(payload: unknown, field: 'code' | 'message') {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export class ApiError extends Error {
  status: number;
  payload: unknown;
  code?: string;

  constructor(status: number, statusText: string, payload: unknown) {
    const message = readPayloadText(payload, 'message');
    const code = readPayloadText(payload, 'code');
    super((message ?? code ?? statusText) || `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    this.code = code ?? undefined;
  }
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export function getAuthToken() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string) {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function buildApiUrl(path: string) {
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(
    /\/$/,
    '',
  );
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${apiBaseUrl}${normalizedPath}`;
}

export async function apiRequest<TResponse>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TResponse> {
  const {
    skipAuth = false,
    token,
    headers: customHeaders,
    responseType,
    ...requestInit
  } = options;
  const headers = new Headers(customHeaders);

  const isFormData =
    typeof FormData !== 'undefined' && requestInit.body instanceof FormData;

  if (requestInit.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const authToken = token ?? getAuthToken();
  if (!skipAuth && authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const response = await fetch(buildApiUrl(path), {
    ...requestInit,
    headers,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const payload = responseType === 'blob'
    ? await response.blob()
    : responseType === 'text'
      ? await response.text()
      : contentType.includes('application/json')
        ? await response.json()
        : await response.text();

  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, payload);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return payload as TResponse;
}
