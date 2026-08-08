import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import App from './App.tsx';
import { AuthProvider } from './auth/AuthContext.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { queryClient } from './lib/query-client.ts';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1e293b', // slate-800
            color: '#f1f5f9', // slate-100
            border: '1px solid #334155', // slate-700
          },
        }}
      />
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
