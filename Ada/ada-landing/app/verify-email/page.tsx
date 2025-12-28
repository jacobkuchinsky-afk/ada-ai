'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import FloatingShapes from '@/components/Background/FloatingShapes';
import Logo from '@/components/Logo/Logo';
import styles from './verify-email.module.css';

export default function VerifyEmailPage() {
  const { user, loading, resendVerificationEmail, logout, checkWaitlistStatus } = useAuth();
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  // Check verification status periodically
  useEffect(() => {
    if (!loading && !user) {
      router.push('/signup');
      return;
    }

    const handleVerified = async () => {
      if (!user) return;
      
      // Check if user is on waitlist
      const pendingWaitlist = sessionStorage.getItem('pendingWaitlist');
      if (pendingWaitlist === 'true') {
        sessionStorage.removeItem('pendingWaitlist');
        router.push('/waitlist');
        return;
      }
      
      // Double-check with API
      const status = await checkWaitlistStatus(user.uid);
      if (status.onWaitlist) {
        router.push('/waitlist');
      } else {
        router.push('/dashboard');
      }
    };

    if (user?.emailVerified) {
      handleVerified();
      return;
    }

    // Poll for email verification
    const interval = setInterval(async () => {
      if (user) {
        await user.reload();
        if (user.emailVerified) {
          handleVerified();
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [user, loading, router, checkWaitlistStatus]);

  const handleResend = async () => {
    setResendLoading(true);
    setError('');
    setResendSuccess(false);

    try {
      await resendVerificationEmail();
      setResendSuccess(true);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      if (errorMessage.includes('too-many-requests')) {
        setError('Please wait before requesting another email');
      } else {
        setError('Something went wrong. Please try again in a bit.');
      }
    } finally {
      setResendLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/signup');
  };

  if (loading) {
    return (
      <main className={styles.main}>
        <FloatingShapes />
        <Logo />
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
        </div>
      </main>
    );
  }

  if (!user) {
    return null; // Will redirect
  }

  return (
    <main className={styles.main}>
      <FloatingShapes />
      <Logo />
      <div className={styles.content}>
        <div className={styles.card}>
          <div className={styles.iconContainer}>
            <svg 
              className={styles.icon} 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="1.5"
            >
              <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          
          <h1 className={styles.title}>Check Your Email</h1>
          
          <p className={styles.message}>
            We&apos;ve sent a verification link to
          </p>
          <p className={styles.email}>{user.email}</p>
          <p className={styles.instruction}>
            Click the link in the email to verify your account. This page will automatically update once verified.
          </p>

          {error && <p className={styles.error}>{error}</p>}
          {resendSuccess && <p className={styles.success}>Verification email sent!</p>}

          <button 
            onClick={handleResend} 
            className={styles.resendButton}
            disabled={resendLoading}
          >
            {resendLoading ? (
              <span className={styles.buttonSpinner}></span>
            ) : (
              'Resend Verification Email'
            )}
          </button>

          <button onClick={handleLogout} className={styles.logoutButton}>
            Sign out and use a different email
          </button>
        </div>
      </div>
    </main>
  );
}
