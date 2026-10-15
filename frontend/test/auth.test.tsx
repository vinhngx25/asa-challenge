import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, tokenStore } from '../src/api';
import { AuthProvider, useAuth } from '../src/auth';

vi.mock('../src/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api')>();
  return { ...real, api: { login: vi.fn(), me: vi.fn() } };
});

const mocked = vi.mocked(api);
const person = (username: string) => ({
  username,
  displayName: username,
  role: 'customer' as const,
  imageKey: `user-${username}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

function setup() {
  const queryClient = new QueryClient();
  let auth!: ReturnType<typeof useAuth>;
  const Probe = () => {
    auth = useAuth();
    return null;
  };
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { queryClient, auth: () => auth };
}

describe('sign-in and sign-out', () => {
  it('signing out removes the token and the previous person\'s cached data', async () => {
    mocked.login.mockResolvedValue({ token: 'token-a', expiresAt: '2030-01-01T00:00:00.000Z', user: person('JoinWick') });
    const { queryClient, auth } = setup();
    await act(() => auth().signIn('JoinWick', 'JoinWick'));
    queryClient.setQueryData(['appointments', {}], ['private booking']);
    expect(tokenStore.get()).toBe('token-a');

    act(() => auth().signOut(true));

    expect(tokenStore.get()).toBeNull();
    expect(auth().user).toBeNull();
    expect(auth().manualExit).toBe(true);
    expect(queryClient.getQueryData(['appointments', {}])).toBeUndefined();
  });

  it('signing in as someone else starts with an empty cache', async () => {
    mocked.login.mockResolvedValue({ token: 'token-b', expiresAt: '2030-01-01T00:00:00.000Z', user: person('JamesBond') });
    const { queryClient, auth } = setup();
    queryClient.setQueryData(['vehicles'], ['an earlier person\'s car']);

    await act(() => auth().signIn('JamesBond', 'JamesBond'));

    expect(queryClient.getQueryData(['vehicles'])).toBeUndefined();
    expect(auth().user?.username).toBe('JamesBond');
    expect(auth().manualExit).toBe(false);
  });
});
