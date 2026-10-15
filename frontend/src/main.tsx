import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { ApiError } from './api';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { Book } from './pages/Book';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Staff } from './pages/Staff';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    // The library's default pauses every request while the browser is offline, which leaves the page waiting with no message.
    // Always attempt the call so the API client can say "You appear to be offline" at once.
    mutations: { networkMode: 'always' },
    queries: {
      networkMode: 'always',
      refetchOnWindowFocus: true,
      // Client mistakes (4xx) will not fix themselves; only retry network and server faults.
      retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
    },
  },
});

function Protected() {
  const { user, loading, manualExit } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Signing you in" />;
  // Remember where the visitor was heading so sign-in can take them there.
  if (!user) return <Navigate to="/login" replace state={{ from: manualExit ? '/' : `${location.pathname}${location.search}` }} />;
  return <Layout />;
}

function Home() {
  const { user } = useAuth();
  return user?.role === 'staff' ? <Staff /> : <Dashboard />;
}

function CustomerOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'customer' ? <>{children}</> : <Navigate to="/" replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Protected />}>
              <Route index element={<Home />} />
              <Route
                path="book"
                element={
                  <CustomerOnly>
                    <Book />
                  </CustomerOnly>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
