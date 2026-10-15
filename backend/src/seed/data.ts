import type { DealershipDto, ServiceTypeDto, SkillId, VehicleDto } from '@asa/shared';

/**
 * Demo data. Everything here is fictional: dealerships, technicians and plates.
 * Cars are inspired by the vehicles seen in the John Wick and James Bond films.
 */

export interface SeedUser {
  username: string;
  password: string;
  displayName: string;
  role: 'customer' | 'staff';
  imageKey: string;
}

export const USERS: SeedUser[] = [
  { username: 'JoinWick', password: 'JoinWick', displayName: 'John Wick', role: 'customer', imageKey: 'user-joinwick' },
  { username: 'JamesBond', password: 'JamesBond', displayName: 'James Bond', role: 'customer', imageKey: 'user-jamesbond' },
  { username: 'Winston', password: 'Winston', displayName: 'Winston Scott', role: 'staff', imageKey: 'user-winston' },
];

export const VEHICLES: (VehicleDto & { owner: string })[] = [
  { id: 'wick-mustang', owner: 'JoinWick', make: 'Ford', model: 'Mustang Mach 1', year: 1969, plate: 'JW69 MCH', imageKey: 'vehicle-wick-mustang' },
  { id: 'wick-chevelle', owner: 'JoinWick', make: 'Chevrolet', model: 'Chevelle SS', year: 1970, plate: 'JW70 SSS', imageKey: 'vehicle-wick-chevelle' },
  { id: 'wick-charger', owner: 'JoinWick', make: 'Dodge', model: 'Charger', year: 2011, plate: 'JW11 CHG', imageKey: 'vehicle-wick-charger' },
  { id: 'bond-db5', owner: 'JamesBond', make: 'Aston Martin', model: 'DB5', year: 1964, plate: 'JB64 007', imageKey: 'vehicle-bond-db5' },
  { id: 'bond-esprit', owner: 'JamesBond', make: 'Lotus', model: 'Esprit S1', year: 1977, plate: 'JB77 LTS', imageKey: 'vehicle-bond-esprit' },
  { id: 'bond-dbs', owner: 'JamesBond', make: 'Aston Martin', model: 'DBS', year: 2006, plate: 'JB06 DBS', imageKey: 'vehicle-bond-dbs' },
  { id: 'bond-2000gt', owner: 'JamesBond', make: 'Toyota', model: '2000GT', year: 1967, plate: 'JB67 TGT', imageKey: 'vehicle-bond-2000gt' },
];

const MON_SAT = [1, 2, 3, 4, 5, 6];

type SeedDealership = Omit<DealershipDto, 'bays' | 'technicians'> & {
  bayCount: number;
  technicians: { id: string; name: string; skills: SkillId[] }[];
};

export const DEALERSHIPS: SeedDealership[] = [
  {
    id: 'kensington',
    name: 'Kensington Motor Works',
    city: 'London',
    address: '14 Queen\'s Gate Mews, London SW7',
    timezone: 'Europe/London',
    openDays: MON_SAT,
    openTime: '08:00',
    closeTime: '18:00',
    imageKey: 'dealership-kensington',
    bayCount: 2,
    technicians: [
      { id: 'oliver-hughes', name: 'Oliver Hughes', skills: ['oil', 'servicing', 'brakes'] },
      { id: 'harriet-clarke', name: 'Harriet Clarke', skills: ['tyres', 'brakes', 'servicing'] },
      { id: 'callum-reid', name: 'Callum Reid', skills: ['engine', 'electrical'] },
      { id: 'priya-patel', name: 'Priya Patel', skills: ['electrical', 'climate', 'oil'] },
      { id: 'edward-whitfield', name: 'Edward Whitfield', skills: ['engine', 'tyres', 'climate'] },
    ],
  },
  {
    id: 'birmingham',
    name: 'Brum Auto Centre',
    city: 'Birmingham',
    address: '52 Digbeth High Street, Birmingham B5',
    timezone: 'Europe/London',
    openDays: MON_SAT,
    openTime: '08:00',
    closeTime: '17:30',
    imageKey: 'dealership-birmingham',
    bayCount: 2,
    technicians: [
      { id: 'amelia-brooks', name: 'Amelia Brooks', skills: ['servicing', 'oil', 'climate'] },
      { id: 'joseph-bennett', name: 'Joseph Bennett', skills: ['brakes', 'tyres', 'engine'] },
      { id: 'freya-mitchell', name: 'Freya Mitchell', skills: ['electrical', 'climate', 'servicing'] },
      { id: 'thomas-ashworth', name: 'Thomas Ashworth', skills: ['engine', 'oil', 'electrical'] },
    ],
  },
  {
    id: 'manchester',
    name: 'Northern Quarter Garage',
    city: 'Manchester',
    address: '9 Tib Street, Manchester M4',
    timezone: 'Europe/London',
    openDays: MON_SAT,
    openTime: '08:30',
    closeTime: '17:30',
    imageKey: 'dealership-manchester',
    bayCount: 1,
    technicians: [
      { id: 'lewis-fletcher', name: 'Lewis Fletcher', skills: ['brakes', 'tyres', 'servicing'] },
      { id: 'megan-doyle', name: 'Megan Doyle', skills: ['oil', 'electrical', 'climate'] },
      { id: 'declan-murphy', name: 'Declan Murphy', skills: ['engine', 'brakes', 'oil'] },
      { id: 'sophie-hargreaves', name: 'Sophie Hargreaves', skills: ['servicing', 'electrical', 'tyres'] },
    ],
  },
];

const svc = (
  id: string,
  name: string,
  skill: SkillId,
  durationMinutes: number,
  description: string,
): ServiceTypeDto => ({ id, name, skill, durationMinutes, description });

/** 24 services: 6 x 30 min, 8 x 60 min, 6 x 120 min, 4 x 240 min. */
export const SERVICES: ServiceTypeDto[] = [
  svc('fluid-check', 'Fluid Top-up & Check', 'oil', 30, 'Top up and inspect all fluid levels.'),
  svc('oil-change', 'Oil & Filter Change', 'oil', 60, 'Fresh engine oil and a new oil filter.'),
  svc('coolant-flush', 'Coolant Flush', 'oil', 60, 'Drain and refill the cooling system.'),

  svc('brake-fluid', 'Brake Fluid Change', 'brakes', 60, 'Replace brake fluid and bleed the system.'),
  svc('front-pads', 'Front Brake Pads', 'brakes', 120, 'Replace front pads and check the discs.'),
  svc('discs-pads', 'Brake Discs & Pads', 'brakes', 240, 'Replace discs and pads on one axle.'),

  svc('puncture', 'Tyre Puncture Repair', 'tyres', 30, 'Find and repair a puncture.'),
  svc('alignment', 'Wheel Alignment', 'tyres', 60, 'Laser alignment of all four wheels.'),
  svc('rotation', 'Tyre Rotation & Balancing', 'tyres', 60, 'Rotate and balance all tyres.'),
  svc('new-tyres', 'New Tyres (Set of 4)', 'tyres', 120, 'Supply and fit four tyres, balanced.'),

  svc('gearbox-oil', 'Gearbox Oil Service', 'engine', 120, 'Replace transmission fluid and filter.'),
  svc('exhaust', 'Exhaust Repair', 'engine', 120, 'Diagnose and repair exhaust faults.'),
  svc('timing-belt', 'Timing Belt Replacement', 'engine', 240, 'Replace belt, tensioner and water pump.'),
  svc('clutch', 'Clutch Replacement', 'engine', 240, 'Replace clutch kit and flywheel check.'),

  svc('battery-test', 'Battery Test', 'electrical', 30, 'Load test the battery and charging system.'),
  svc('headlight', 'Headlight Bulb Replacement', 'electrical', 30, 'Replace and aim headlight bulbs.'),
  svc('battery-replace', 'Battery Replacement', 'electrical', 60, 'Supply and fit a new battery.'),
  svc('alternator', 'Alternator Replacement', 'electrical', 120, 'Replace the alternator and test charging.'),

  svc('cabin-filter', 'Cabin Filter Replacement', 'climate', 30, 'Fit a new pollen filter.'),
  svc('aircon', 'Air-Con Regas', 'climate', 60, 'Recharge and leak-test the air conditioning.'),

  svc('winter-check', 'Winter Health Check', 'servicing', 30, 'Lights, tyres, battery and antifreeze check.'),
  svc('mot', 'MOT Test', 'servicing', 60, 'Annual MOT test.'),
  svc('interim', 'Interim Service', 'servicing', 120, 'Six-monthly service with safety checks.'),
  svc('full-service', 'Full Service', 'servicing', 240, 'Comprehensive annual service.'),
];

export interface SeedBooking {
  username: string;
  vehicleId: string;
  serviceId: string;
  dealershipId: string;
  /** Days from the seed day. Sundays move to Monday. */
  dayOffset: number;
  /** Local start time HH:mm. */
  time: string;
  cancel?: boolean;
}

export const BOOKINGS: SeedBooking[] = [
  { username: 'JoinWick', vehicleId: 'wick-mustang', serviceId: 'full-service', dealershipId: 'kensington', dayOffset: -21, time: '09:00' },
  { username: 'JoinWick', vehicleId: 'wick-charger', serviceId: 'mot', dealershipId: 'kensington', dayOffset: -9, time: '11:00' },
  { username: 'JoinWick', vehicleId: 'wick-chevelle', serviceId: 'front-pads', dealershipId: 'birmingham', dayOffset: 3, time: '10:00' },
  { username: 'JoinWick', vehicleId: 'wick-mustang', serviceId: 'oil-change', dealershipId: 'manchester', dayOffset: 8, time: '14:00' },
  { username: 'JoinWick', vehicleId: 'wick-charger', serviceId: 'aircon', dealershipId: 'kensington', dayOffset: 5, time: '13:00', cancel: true },
  { username: 'JamesBond', vehicleId: 'bond-db5', serviceId: 'interim', dealershipId: 'kensington', dayOffset: -14, time: '10:00' },
  { username: 'JamesBond', vehicleId: 'bond-dbs', serviceId: 'battery-replace', dealershipId: 'birmingham', dayOffset: -4, time: '09:30' },
  { username: 'JamesBond', vehicleId: 'bond-esprit', serviceId: 'clutch', dealershipId: 'manchester', dayOffset: 4, time: '09:00' },
  { username: 'JamesBond', vehicleId: 'bond-2000gt', serviceId: 'alignment', dealershipId: 'kensington', dayOffset: 6, time: '15:00' },
  { username: 'JamesBond', vehicleId: 'bond-db5', serviceId: 'timing-belt', dealershipId: 'birmingham', dayOffset: 10, time: '08:30', cancel: true },
];
