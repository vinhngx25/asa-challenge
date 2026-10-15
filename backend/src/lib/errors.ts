import type { ErrorCode } from '@asa/shared';

const STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  INVALID_START_TIME: 422,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SLOT_UNAVAILABLE: 409,
  VEHICLE_BUSY: 409,
  ALREADY_CANCELLED: 409,
  CANNOT_CANCEL_PAST: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** A failure the caller can understand and act on. Anything else becomes INTERNAL. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly alternatives?: string[],
  ) {
    super(message);
    this.status = STATUS[code];
  }
}
