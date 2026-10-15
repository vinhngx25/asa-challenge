import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/api';
import { Book } from '../src/pages/Book';
import { availability, catalog, confirmed, vehicles } from './fixtures';
import { renderPage } from './render';

vi.mock('../src/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api')>();
  return {
    ...real,
    api: { catalog: vi.fn(), vehicles: vi.fn(), availability: vi.fn(), book: vi.fn() },
  };
});

const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.catalog.mockResolvedValue(catalog);
  mocked.vehicles.mockResolvedValue(vehicles);
  mocked.availability.mockImplementation(async (p) => availability(p.date));
  mocked.book.mockResolvedValue(confirmed);
});

const choice = (name: RegExp) => screen.getByRole('button', { name });
const confirmButton = () => screen.getByRole('button', { name: /Confirm booking|Confirming/ });
const summary = () => screen.getByTestId('booking-bar-summary');
const times = () => within(screen.getByRole('group', { name: 'Available start times' })).getAllByRole('button');

type User = ReturnType<typeof userEvent.setup>;

/** Vehicle, service, dealership, then the first free time. */
async function chooseEverything(user: User) {
  await user.click(await screen.findByRole('button', { name: /Mustang/ }));
  await user.click(await screen.findByRole('button', { name: /Oil Change/ }));
  await user.click(await screen.findByRole('button', { name: /North Garage/ }));
  await waitFor(() => expect(times()).toHaveLength(2));
  await user.click(times()[0]!);
  expect(confirmButton()).toBeEnabled();
}

describe('booking page', () => {
  it('Book another keeps only the vehicle', async () => {
    const user = userEvent.setup();
    renderPage(<Book />);
    await chooseEverything(user);
    await user.click(confirmButton());
    await screen.findByRole('heading', { name: 'Booking confirmed' });

    await user.click(screen.getByRole('button', { name: 'Book another' }));

    expect(choice(/Mustang/)).toHaveAttribute('aria-pressed', 'true');
    expect(choice(/Oil Change/)).toHaveAttribute('aria-pressed', 'false');
    expect(choice(/North Garage/)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('group', { name: 'Available start times' })).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(summary()).toHaveTextContent('Step 2');
  });

  it('a category that hides the chosen service clears it', async () => {
    const user = userEvent.setup();
    renderPage(<Book />);
    await user.click(await screen.findByRole('button', { name: /Mustang/ }));
    await user.click(await screen.findByRole('button', { name: /Oil Change/ }));
    expect(summary()).toHaveTextContent('Step 3');

    await user.click(within(screen.getByRole('group', { name: 'Service categories' })).getByRole('button', { name: /Brakes/ }));

    expect(screen.queryByRole('button', { name: /Oil Change/ })).not.toBeInTheDocument();
    expect(summary()).toHaveTextContent('Step 2');
    expect(confirmButton()).toBeDisabled();
  });

  it('changing the dealership clears the chosen time', async () => {
    const user = userEvent.setup();
    renderPage(<Book />);
    await chooseEverything(user);

    await user.click(choice(/South Garage/));

    await waitFor(() => expect(confirmButton()).toBeDisabled());
    expect(summary()).toHaveTextContent('Step 4');
  });

  it('changing the vehicle clears the chosen time', async () => {
    const user = userEvent.setup();
    renderPage(<Book />);
    await chooseEverything(user);

    await user.click(choice(/Charger/));

    await waitFor(() => expect(confirmButton()).toBeDisabled());
  });

  it('shows the nearest times after a conflict and drops the message when a choice changes', async () => {
    mocked.book.mockRejectedValue(
      new ApiError('SLOT_UNAVAILABLE', 'That time was just taken.', 409, 'req-1', ['2030-01-02T10:00:00.000Z']),
    );
    const user = userEvent.setup();
    renderPage(<Book />);
    await chooseEverything(user);
    await user.click(confirmButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That time was just taken.');
    expect(alert).toHaveTextContent('Nearest free times');

    await user.click(times()[1]!);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('drops the conflict message when the dealership changes', async () => {
    mocked.book.mockRejectedValue(new ApiError('SLOT_UNAVAILABLE', 'That time was just taken.', 409, 'req-1', []));
    const user = userEvent.setup();
    renderPage(<Book />);
    await chooseEverything(user);
    await user.click(confirmButton());
    await screen.findByRole('alert');

    await user.click(choice(/South Garage/));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('sends one request when Confirm is clicked twice quickly', async () => {
    mocked.book.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderPage(<Book />);
    await chooseEverything(user);

    await user.dblClick(confirmButton());

    expect(mocked.book).toHaveBeenCalledTimes(1);
  });
});
