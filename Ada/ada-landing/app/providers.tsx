'use client';

import { AuthProvider } from '@/context/AuthContext';
import { CreditsProvider } from '@/context/CreditsContext';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CreditsProvider>
        {children}
      </CreditsProvider>
    </AuthProvider>
  );
}

