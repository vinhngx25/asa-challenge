import type { AppointmentDto, AvailabilityDto, CatalogDto, DealershipDto, VehicleDto } from '@asa/shared';

const dealership = (id: string, name: string): DealershipDto => ({
  id,
  name,
  city: 'London',
  address: '1 High Street',
  timezone: 'Europe/London',
  openDays: [0, 1, 2, 3, 4, 5, 6],
  openTime: '08:00',
  closeTime: '18:00',
  imageKey: `dealership-${id}`,
  bays: [{ id: `${id}-bay-1`, name: 'Bay 1' }],
  technicians: [],
});

export const catalog: CatalogDto = {
  dealerships: [dealership('north', 'North Garage'), dealership('south', 'South Garage')],
  services: [
    { id: 'oil-change', name: 'Oil Change', description: 'Fresh oil and filter.', skill: 'oil', durationMinutes: 30 },
    { id: 'brake-check', name: 'Brake Check', description: 'Pads and discs.', skill: 'brakes', durationMinutes: 60 },
  ],
  skills: [
    { id: 'oil', name: 'Oil & Fluids' },
    { id: 'brakes', name: 'Brakes' },
  ],
};

export const vehicles: VehicleDto[] = [
  { id: 'car-1', make: 'Ford', model: 'Mustang', year: 1969, plate: 'AB69 CDE', imageKey: 'vehicle-car-1' },
  { id: 'car-2', make: 'Dodge', model: 'Charger', year: 2011, plate: 'FG11 HIJ', imageKey: 'vehicle-car-2' },
];

/** Two free times on the requested day (10:00 and 11:00 UTC). */
export const availability = (date: string): AvailabilityDto => ({
  dealershipId: 'north',
  serviceTypeId: 'oil-change',
  date,
  timezone: 'Europe/London',
  durationMinutes: 30,
  open: true,
  slots: [
    { startTime: `${date}T10:00:00.000Z`, endTime: `${date}T10:30:00.000Z`, available: true },
    { startTime: `${date}T11:00:00.000Z`, endTime: `${date}T11:30:00.000Z`, available: true },
  ],
});

export const confirmed: AppointmentDto = {
  id: 'appt-1',
  reference: 'ASA-0001',
  status: 'BOOKED',
  customer: 'JoinWick',
  customerName: 'John Wick',
  vehicleId: 'car-1',
  vehicleLabel: '1969 Ford Mustang',
  vehiclePlate: 'AB69 CDE',
  vehicleImageKey: 'vehicle-car-1',
  serviceTypeId: 'oil-change',
  serviceName: 'Oil Change',
  skill: 'oil',
  durationMinutes: 30,
  dealershipId: 'north',
  dealershipName: 'North Garage',
  technicianId: 'tech-1',
  technicianName: 'Oliver Hughes',
  technicianImageKey: 'tech-oliver',
  bayId: 'north-bay-1',
  bayName: 'Bay 1',
  startTime: '2030-01-01T10:00:00.000Z',
  endTime: '2030-01-01T10:30:00.000Z',
  createdAt: '2029-12-01T10:00:00.000Z',
};
