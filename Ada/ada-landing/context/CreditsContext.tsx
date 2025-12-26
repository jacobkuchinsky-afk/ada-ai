'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import {
  getUserCredits,
  useCredits as useCreditsService,
  UserCredits,
  SubscriptionStatus,
} from '@/lib/creditsService';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

interface CreditsContextType {
  credits: number;
  maxCredits: number;
  isPremium: boolean;
  premiumExpiresAt: Date | null;
  subscriptionStatus: SubscriptionStatus;
  isLoading: boolean;
  useCredits: (amount: number) => Promise<boolean>;
  refreshCredits: () => Promise<void>;
  createCheckoutSession: () => Promise<{ success: boolean; url?: string; error?: string }>;
  cancelSubscription: () => Promise<{ success: boolean; message: string }>;
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

  const createCheckoutSession = useCallback(async (): Promise<{ success: boolean; url?: string; error?: string }> => {
    if (!user) return { success: false, error: 'Not logged in' };

    const apiUrl = `${API_URL}/api/create-checkout`;
    console.log('[Checkout] Calling API:', apiUrl);
    console.log('[Checkout] User ID:', user.uid);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({
          userId: user.uid,
          email: user.email,
        }),
      });

      console.log('[Checkout] Response status:', response.status);
      
      // Get response text first to debug
      const responseText = await response.text();
      console.log('[Checkout] Response text:', responseText);
      
      // Try to parse as JSON
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[Checkout] Failed to parse JSON:', parseError);
        return { success: false, error: `Server returned invalid response: ${responseText.substring(0, 100)}` };
      }

      if (!response.ok) {
        return { success: false, error: data.error || `Server error: ${response.status}` };
      }

      return { success: true, url: data.url };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Checkout] Fetch error:', errorMessage);
      return { success: false, error: `Connection failed: ${errorMessage}` };
    }
  }, [user]);

  const cancelSubscription = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    if (!user) return { success: false, message: 'Not logged in' };

    try {
      const response = await fetch(`${API_URL}/api/cancel-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({
          userId: user.uid,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, message: data.error || 'Failed to cancel subscription' };
      }

      // Refresh credits to get updated subscription status
      await loadCredits();

      return { success: true, message: data.message || 'Subscription cancelled' };
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      return { success: false, message: 'Failed to connect to server' };
    }
  }, [user, loadCredits]);

  const value: CreditsContextType = {
    credits: creditsData?.credits ?? 0,
    maxCredits: creditsData?.maxCredits ?? 20,
    isPremium: creditsData?.isPremium ?? false,
    premiumExpiresAt: creditsData?.premiumExpiresAt ?? null,
    subscriptionStatus: creditsData?.subscriptionStatus ?? 'none',
    isLoading,
    useCredits,
    refreshCredits,
    createCheckoutSession,
    cancelSubscription,
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
