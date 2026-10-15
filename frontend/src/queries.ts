import { useQuery } from '@tanstack/react-query';
import type { ListAppointmentsQuery } from '@asa/shared';
import { api } from './api';

export const useCatalog = () =>
  useQuery({ queryKey: ['catalog'], queryFn: api.catalog, staleTime: 5 * 60_000 });

export const useVehicles = () => useQuery({ queryKey: ['vehicles'], queryFn: api.vehicles, staleTime: 5 * 60_000 });

export const useAppointments = (filters: ListAppointmentsQuery = {}) =>
  useQuery({ queryKey: ['appointments', filters], queryFn: () => api.appointments(filters) });
