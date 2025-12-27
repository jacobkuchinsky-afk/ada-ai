'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { 
  User, 
  onAuthStateChanged, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile
} from 'firebase/auth';
import { auth } from '@/lib/firebase';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

interface WaitlistCheckResult {
  shouldWaitlist: boolean;
  position?: number;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signup: (email: string, password: string, username: string) => Promise<WaitlistCheckResult>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUsername: (newUsername: string) => Promise<void>;
  checkWaitlistStatus: (userId: string) => Promise<{ onWaitlist: boolean; position?: number }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signup = async (email: string, password: string, username: string): Promise<WaitlistCheckResult> => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Update display name with username
    await updateProfile(userCredential.user, {
      displayName: username
    });
    
    // Send verification email
    await sendEmailVerification(userCredential.user);
    
    // Check if user should be waitlisted
    try {
      const checkResponse = await fetch(`${API_URL}/api/check-waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userCredential.user.uid }),
      });
      
      const checkData = await checkResponse.json();
      
      if (checkData.shouldWaitlist) {
        // Add user to waitlist
        const joinResponse = await fetch(`${API_URL}/api/join-waitlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            userId: userCredential.user.uid,
            email: email 
          }),
        });
        
        const joinData = await joinResponse.json();
        return { shouldWaitlist: true, position: joinData.position };
      } else {
        // Register as free user
        await fetch(`${API_URL}/api/register-free-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: userCredential.user.uid }),
        });
        return { shouldWaitlist: false };
      }
    } catch (error) {
      console.error('Error checking waitlist:', error);
      // On error, allow user through (fail open)
      return { shouldWaitlist: false };
    }
  };

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const resendVerificationEmail = async () => {
    if (user && !user.emailVerified) {
      await sendEmailVerification(user);
    }
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const updateUsername = async (newUsername: string) => {
    if (user) {
      await updateProfile(user, {
        displayName: newUsername
      });
      // Force refresh the user object
      await user.reload();
      setUser({ ...user, displayName: newUsername } as User);
    }
  };

  const checkWaitlistStatus = async (userId: string): Promise<{ onWaitlist: boolean; position?: number }> => {
    try {
      const response = await fetch(`${API_URL}/api/waitlist-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      
      const data = await response.json();
      return {
        onWaitlist: data.onWaitlist || false,
        position: data.position,
      };
    } catch (error) {
      console.error('Error checking waitlist status:', error);
      return { onWaitlist: false };
    }
  };

  const value = {
    user,
    loading,
    signup,
    login,
    logout,
    resendVerificationEmail,
    resetPassword,
    updateUsername,
    checkWaitlistStatus
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
