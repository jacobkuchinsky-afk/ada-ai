'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import {
  getUserCredits,
  useCredits as useCreditsService,
  upgradeToPremium as upgradeToPremiumService,
  UserCredits,
} from '@/lib/creditsService';

interface CreditsContextType {
  credits: number;
  maxCredits: number;
  isPremium: boolean;
  premiumExpiresAt: Date | null;
  isLoading: boolean;
  useCredits: (amount: number) => Promise<boolean>;
  refreshCredits: () => Promise<void>;
  upgradeToPremium: (code: string) => Promise<{ success: boolean; message: string }>;
}

const CreditsContext = createContext<CreditsContextType | undefined>(undefined);

export function CreditsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [creditsData, setCreditsData] = useState<UserCredits | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load credits on mount and when user changes
  const loadCredits = useCallback(async () => {
    if (!user) {
      setCreditsData(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const data = await getUserCredits(user.uid);
      setCreditsData(data);
    } catch (error) {
      console.error('Error loading credits:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadCredits();
  }, [loadCredits]);

  const refreshCredits = useCallback(async () => {
    await loadCredits();
  }, [loadCredits]);

  const useCredits = useCallback(async (amount: number): Promise<boolean> => {
    if (!user) return false;

    const success = await useCreditsService(user.uid, amount);
    if (success) {
      // Update local state
      setCreditsData(prev => prev ? { ...prev, credits: prev.credits - amount } : null);
    }
    return success;
  }, [user]);

  const upgradeToPremium = useCallback(async (code: string): Promise<{ success: boolean; message: string }> => {
    if (!user) return { success: false, message: 'Not logged in' };

    const result = await upgradeToPremiumService(user.uid, code);
    if (result.success) {
      // Refresh credits to get updated state
      await loadCredits();
    }
    return result;
  }, [user, loadCredits]);

  const value: CreditsContextType = {
    credits: creditsData?.credits ?? 0,
    maxCredits: creditsData?.maxCredits ?? 10,
    isPremium: creditsData?.isPremium ?? false,
    premiumExpiresAt: creditsData?.premiumExpiresAt ?? null,
    isLoading,
    useCredits,
    refreshCredits,
    upgradeToPremium,
  };

  return (
    <CreditsContext.Provider value={value}>
      {children}
    </CreditsContext.Provider>
  );
}

export function useCreditsContext() {
  const context = useContext(CreditsContext);
  if (context === undefined) {
    throw new Error('useCreditsContext must be used within a CreditsProvider');
  }
  return context;
}


