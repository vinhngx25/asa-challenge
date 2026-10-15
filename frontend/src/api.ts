import type {
  ApiErrorBody,
  AppointmentDto,
  AvailabilityDto,
  CatalogDto,
  CreateAppointmentRequest,
  ErrorCode,
  ListAppointmentsQuery,
  LoginResponse,
  UserDto,
  VehicleDto,
} from '@asa/shared';

const TOKEN_KEY = 'asa.token';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode: the session lasts until reload */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing stored */
    }
  },
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly alternatives: string[] = [],
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void): void => {
  onUnauthorized = fn;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError('INTERNAL', 'Cannot reach the server. Check your connection and try again.', 0);
  }

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = (data as ApiErrorBody | undefined)?.error;
    if (res.status === 429) {
      // API Gateway answers a throttled request with its own body, not our error format.
      throw new ApiError('RATE_LIMITED', 'Too many requests right now. Please wait a few seconds and try again.', 429);
    }
    if (res.status === 401 && e?.code === 'UNAUTHENTICATED') onUnauthorized();
    throw new ApiError(
      e?.code ?? 'INTERNAL',
      e?.message ?? 'Something went wrong.',
      res.status,
      e?.requestId,
      e?.alternatives,
    );
  }
  return data as T;
}

const qs = (params: Record<string, string | undefined>): string => {
  const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
};

export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>('POST', '/auth/login', { username, password }),
  me: () => request<UserDto>('GET', '/me'),
  catalog: () => request<CatalogDto>('GET', '/catalog'),
  vehicles: () => request<VehicleDto[]>('GET', '/vehicles'),
  availability: (p: { dealershipId: string; serviceTypeId: string; date: string; vehicleId?: string }) =>
    request<AvailabilityDto>('GET', `/availability${qs(p)}`),
  appointments: (q: ListAppointmentsQuery = {}) => request<AppointmentDto[]>('GET', `/appointments${qs(q)}`),
  book: (input: CreateAppointmentRequest) => request<AppointmentDto>('POST', '/appointments', input),
  cancel: (id: string) => request<AppointmentDto>('POST', `/appointments/${id}/cancel`),
};
