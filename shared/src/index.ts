import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Constants shared by API and UI                                      */
/* ------------------------------------------------------------------ */

export const SLOT_MINUTES = 30;
export const MIN_LEAD_MINUTES = 60;
export const MAX_DAYS_AHEAD = 60;

/** Limits on every text a person can type or send. One definition for the API schemas and the UI inputs. */
export const LIMITS = {
  /** Username and password: at most 32 characters each. */
  username: 32,
  password: 32,
  /** Record ids (vehicle, service, dealership, appointment). Real ids are far shorter; the cap keeps keys inside DynamoDB's limits. */
  id: 64,
  /** The staff search box. */
  search: 100,
} as const;

export const ROLES = ['customer', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const SKILLS = [
  { id: 'oil', name: 'Oil & Fluids' },
  { id: 'brakes', name: 'Brakes' },
  { id: 'tyres', name: 'Tyres & Wheels' },
  { id: 'engine', name: 'Engine & Transmission' },
  { id: 'electrical', name: 'Electrical & Battery' },
  { id: 'climate', name: 'Climate Control' },
  { id: 'servicing', name: 'Servicing, MOT & Inspection' },
] as const;

export const skillIdSchema = z.enum(['oil', 'brakes', 'tyres', 'engine', 'electrical', 'climate', 'servicing']);
export type SkillId = z.infer<typeof skillIdSchema>;

export const APPOINTMENT_STATUSES = ['BOOKED', 'CANCELLED'] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export const ERROR_CODES = [
  'INVALID_INPUT',
  'INVALID_START_TIME',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'NOT_FOUND',
  'SLOT_UNAVAILABLE',
  'VEHICLE_BUSY',
  'ALREADY_CANCELLED',
  'CANNOT_CANCEL_PAST',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    /** For SLOT_UNAVAILABLE: nearest free start times (ISO, UTC) for the same service. */
    alternatives?: string[];
  };
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const idSchema = z.string().min(1).max(LIMITS.id);

export const loginRequestSchema = z.object({
  username: z.string().min(1).max(LIMITS.username),
  password: z.string().min(1).max(LIMITS.password),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userSchema = z.object({
  username: z.string(),
  displayName: z.string(),
  role: z.enum(ROLES),
  imageKey: z.string(),
});
export type UserDto = z.infer<typeof userSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  user: userSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

export interface BayDto {
  id: string;
  name: string;
}

export interface TechnicianDto {
  id: string;
  name: string;
  skills: SkillId[];
  imageKey: string;
}

export interface DealershipDto {
  id: string;
  name: string;
  city: string;
  address: string;
  timezone: string;
  /** ISO weekdays that are open, Monday = 1 ... Saturday = 6. */
  openDays: number[];
  /** Local opening and closing time, HH:mm, on a 30 minute grid. */
  openTime: string;
  closeTime: string;
  imageKey: string;
  bays: BayDto[];
  technicians: TechnicianDto[];
}

export interface ServiceTypeDto {
  id: string;
  name: string;
  description: string;
  skill: SkillId;
  durationMinutes: number;
}

export interface CatalogDto {
  dealerships: DealershipDto[];
  services: ServiceTypeDto[];
  skills: { id: SkillId; name: string }[];
}

export interface VehicleDto {
  id: string;
  make: string;
  model: string;
  year: number;
  plate: string;
  imageKey: string;
}

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

/** True for a real calendar day written YYYY-MM-DD (rejects 2026-02-30, month 13, year 0000). */
export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCFullYear(y); // years 0 to 99 would otherwise map to 1900 to 1999
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const availabilityQuerySchema = z.object({
  dealershipId: idSchema,
  serviceTypeId: idSchema,
  date: z.string().refine(isRealDate, 'date must be a real calendar day written YYYY-MM-DD'),
  vehicleId: idSchema.optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export interface AvailabilitySlot {
  /** ISO instant, UTC. */
  startTime: string;
  endTime: string;
  available: boolean;
}

export interface AvailabilityDto {
  dealershipId: string;
  serviceTypeId: string;
  date: string;
  timezone: string;
  durationMinutes: number;
  open: boolean;
  slots: AvailabilitySlot[];
}

/* ------------------------------------------------------------------ */
/* Appointments                                                        */
/* ------------------------------------------------------------------ */

export const createAppointmentSchema = z.object({
  vehicleId: idSchema,
  serviceTypeId: idSchema,
  dealershipId: idSchema,
  startTime: z.iso.datetime({ message: 'startTime must be an ISO 8601 UTC instant' }),
});
export type CreateAppointmentRequest = z.infer<typeof createAppointmentSchema>;

export const listAppointmentsQuerySchema = z.object({
  dealershipId: idSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  status: appointmentStatusSchema.optional(),
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

export interface AppointmentDto {
  id: string;
  /** Short human reference, for example ASA-3F9A1C2B. */
  reference: string;
  status: AppointmentStatus;
  customer: string;
  customerName: string;
  vehicleId: string;
  vehicleLabel: string;
  vehiclePlate: string;
  vehicleImageKey: string;
  serviceTypeId: string;
  serviceName: string;
  skill: SkillId;
  durationMinutes: number;
  dealershipId: string;
  dealershipName: string;
  technicianId: string;
  technicianName: string;
  technicianImageKey: string;
  bayId: string;
  bayName: string;
  startTime: string;
  endTime: string;
  createdAt: string;
  cancelledAt?: string;
}

/* ------------------------------------------------------------------ */
/* Appointment phase (shared by the UI and the tests)                  */
/* ------------------------------------------------------------------ */

export type AppointmentPhase = 'upcoming' | 'in-progress' | 'past' | 'cancelled';

/**
 * Where an appointment is in its life. Half-open interval: the start instant is already "in progress",
 * the end instant is already "past". A cancelled appointment stays cancelled whatever the clock says.
 */
export function appointmentPhase(
  a: Pick<AppointmentDto, 'status' | 'startTime' | 'endTime'>,
  nowMs: number = Date.now(),
): AppointmentPhase {
  if (a.status === 'CANCELLED') return 'cancelled';
  if (Date.parse(a.endTime) <= nowMs) return 'past';
  if (Date.parse(a.startTime) <= nowMs) return 'in-progress';
  return 'upcoming';
}
