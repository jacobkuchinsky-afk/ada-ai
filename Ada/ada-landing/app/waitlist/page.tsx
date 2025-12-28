'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import FloatingShapes from '@/components/Background/FloatingShapes';
import Logo from '@/components/Logo/Logo';
import styles from './waitlist.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export default function WaitlistPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [position, setPosition] = useState<number>(0);
  const [totalWaiting, setTotalWaiting] = useState<number>(0);
  const [estimatedWait, setEstimatedWait] = useState<string>('');
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusLoading, setStatusLoading] = useState(true);

  // Check waitlist status periodically
  useEffect(() => {
    if (!loading && !user) {
      router.push('/signup');
      return;
    }

    if (!user?.emailVerified) {
      router.push('/verify-email');
      return;
    }

    const checkStatus = async () => {
      if (!user) return;

      try {
        const response = await fetch(`${API_URL}/api/waitlist-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId: user.uid }),
        });

        const data = await response.json();

        if (!data.onWaitlist) {
          // User is no longer on waitlist, redirect to dashboard
          router.push('/dashboard');
          return;
        }

        setPosition(data.position || 0);
        setTotalWaiting(data.totalWaiting || 0);
        setEstimatedWait(data.estimatedWait || 'Unknown');
      } catch (err) {
        console.error('Error checking waitlist status:', err);
      } finally {
        setStatusLoading(false);
      }
    };

    // Initial check
    checkStatus();

    // Poll every 30 seconds
    const interval = setInterval(checkStatus, 30000);

    return () => clearInterval(interval);
  }, [user, loading, router]);

  const handleUpgradeToPremium = async () => {
    if (!user) return;
    
    setUpgradeLoading(true);
    setError('');
    
    try {
      const response = await fetch(`${API_URL}/api/create-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.uid,
          email: user.email,
        }),
      });
      
      const data = await response.json();
      
      if (data.url) {
        // Redirect to Stripe checkout
        window.location.href = data.url;
      } else {
        setError('Something went wrong. Please try again in a bit.');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setError('Something went wrong. Please try again in a bit.');
    } finally {
      setUpgradeLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/signup');
  };

  if (loading || statusLoading) {
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
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          
          <h1 className={styles.title}>You&apos;re on the Waitlist</h1>
          
          <p className={styles.message}>
            We&apos;re growing fast! Due to high demand, we&apos;re limiting new free users.
          </p>

          <div className={styles.positionContainer}>
            <div className={styles.positionNumber}>{position}</div>
            <div className={styles.positionLabel}>Your Position</div>
          </div>

          <div className={styles.statsRow}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{totalWaiting}</span>
              <span className={styles.statLabel}>In Line</span>
            </div>
            <div className={styles.statDivider}></div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{estimatedWait}</span>
              <span className={styles.statLabel}>Est. Wait</span>
            </div>
          </div>

          <p className={styles.instruction}>
            When more users upgrade to premium, spots open up for free users. 
            We&apos;ll notify you when it&apos;s your turn!
          </p>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.skipSection}>
            <p className={styles.skipText}>Skip the line instantly</p>
            <button 
              onClick={handleUpgradeToPremium} 
              className={styles.upgradeButton}
              disabled={upgradeLoading}
            >
              {upgradeLoading ? (
                <span className={styles.buttonSpinner}></span>
              ) : (
                <>
                  <svg 
                    width="20" 
                    height="20" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Upgrade to Premium
                </>
              )}
            </button>
            <p className={styles.premiumPerks}>
              Get 200 daily credits • Priority support • Skip the waitlist
            </p>
          </div>

          <button onClick={handleLogout} className={styles.logoutButton}>
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}

