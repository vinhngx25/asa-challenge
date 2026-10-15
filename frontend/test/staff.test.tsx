import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { Staff } from '../src/pages/Staff';
import { catalog, confirmed } from './fixtures';
import { renderPage } from './render';

vi.mock('../src/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api')>();
  return { ...real, api: { catalog: vi.fn(), appointments: vi.fn() } };
});

const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.catalog.mockResolvedValue(catalog);
  mocked.appointments.mockResolvedValue([confirmed]);
});

describe('staff overview', () => {
  it('names the problem when From is after To', async () => {
    renderPage(<Staff />);
    await screen.findByText('Oil Change');
    const [from, to] = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));

    fireEvent.change(from!, { target: { value: '2030-02-10' } });
    fireEvent.change(to!, { target: { value: '2030-02-01' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('"From" is after "To"');
  });

  it('finds a booking by customer name, and shows an empty state for no match', async () => {
    renderPage(<Staff />);
    await screen.findByText('Oil Change');
    const search = screen.getByRole('searchbox');

    fireEvent.change(search, { target: { value: 'wick' } });
    expect(screen.getByText('Oil Change')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'nobody' } });
    expect(await screen.findByText('No bookings match')).toBeInTheDocument();
  });
});
