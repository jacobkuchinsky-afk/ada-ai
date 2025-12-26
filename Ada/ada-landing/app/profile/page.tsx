'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useCreditsContext } from '@/context/CreditsContext';
import { formatPremiumExpiry } from '@/lib/creditsService';
import styles from './profile.module.css';

export default function ProfilePage() {
  const { user, loading, logout, updateUsername } = useAuth();
  const { 
    credits, 
    maxCredits, 
    isPremium, 
    premiumExpiresAt, 
    subscriptionStatus,
    createCheckoutSession, 
    cancelSubscription,
    refreshCredits 
  } = useCreditsContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isEditing, setIsEditing] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [updateLoading, setUpdateLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Upgrade/cancel state
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/signup');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.displayName) {
      setNewUsername(user.displayName);
    }
  }, [user]);

  // Check for payment status from URL params
  useEffect(() => {
    const payment = searchParams.get('payment');
    if (payment === 'success') {
      setSuccess('Payment successful! Your premium subscription is now active.');
      // Refresh credits to get updated status
      refreshCredits();
      // Clear the URL param
      router.replace('/profile');
    } else if (payment === 'cancelled') {
      setError('Payment was cancelled.');
      router.replace('/profile');
    }
  }, [searchParams, refreshCredits, router]);

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  const handleEditUsername = () => {
    setIsEditing(true);
    setError('');
    setSuccess('');
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setNewUsername(user?.displayName || '');
    setError('');
  };

  const handleSaveUsername = async () => {
    if (!newUsername.trim()) {
      setError('Username cannot be empty');
      return;
    }

    setUpdateLoading(true);
    setError('');

    try {
      await updateUsername(newUsername.trim());
      setSuccess('Username updated successfully!');
      setIsEditing(false);
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError('Failed to update username');
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleUpgrade = async () => {
    setUpgradeLoading(true);
    setError('');

    try {
      const result = await createCheckoutSession();
      if (result.success && result.url) {
        // Redirect to Stripe Checkout
        window.location.href = result.url;
      } else {
        setError(result.error || 'Failed to start checkout');
      }
    } catch {
      setError('Failed to start checkout');
    } finally {
      setUpgradeLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelLoading(true);
    setError('');

    try {
      const result = await cancelSubscription();
      if (result.success) {
        setSuccess(result.message);
        setShowCancelConfirm(false);
        setTimeout(() => setSuccess(''), 5000);
      } else {
        setError(result.message);
      }
    } catch {
      setError('Failed to cancel subscription');
    } finally {
      setCancelLoading(false);
    }
  };

  if (loading) {
    return (
      <main className={styles.main}>
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
        </div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const getSubscriptionStatusText = () => {
    switch (subscriptionStatus) {
      case 'active':
        return 'Active';
      case 'cancelling':
        return 'Cancels at period end';
      case 'cancelled':
        return 'Cancelled';
      case 'payment_failed':
        return 'Payment failed';
      default:
        return 'Free';
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <Link href="/dashboard" className={styles.backButton}>
          <svg 
            width="20" 
            height="20" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to Chat
        </Link>

        <div className={styles.card}>
          <h1 className={styles.title}>Profile</h1>
          
          <div className={styles.avatar}>
            <svg 
              width="48" 
              height="48" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>

          {error && <p className={styles.error}>{error}</p>}
          {success && <p className={styles.success}>{success}</p>}

          <div className={styles.info}>
            {/* Credits Section */}
            <div className={styles.infoGroup}>
              <div className={styles.creditsHeader}>
                <label className={styles.label}>Credits</label>
                {isPremium && (
                  <span className={styles.premiumBadge}>PREMIUM</span>
                )}
              </div>
              <div className={styles.creditsDisplay}>
                <span className={styles.creditsNumber}>{credits}</span>
                <span className={styles.creditsMax}>/ {maxCredits} daily</span>
              </div>
              {isPremium && premiumExpiresAt && (
                <p className={styles.premiumExpiry}>
                  {formatPremiumExpiry(premiumExpiresAt)}
                </p>
              )}
            </div>

            {/* Subscription Section */}
            <div className={styles.infoGroup}>
              <label className={styles.label}>Subscription</label>
              <p className={styles.subscriptionStatus}>{getSubscriptionStatusText()}</p>
              
              {/* Upgrade Button - Show if not premium or if subscription cancelled/failed */}
              {(!isPremium || subscriptionStatus === 'cancelled' || subscriptionStatus === 'payment_failed') && (
                <button 
                  onClick={handleUpgrade} 
                  className={styles.upgradeButton}
                  disabled={upgradeLoading}
                >
                  {upgradeLoading ? (
                    <span className={styles.buttonSpinner}></span>
                  ) : (
                    <>
                      <svg 
                        width="18" 
                        height="18" 
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      Upgrade to Premium - $10/month
                    </>
                  )}
                </button>
              )}

              {/* Cancel Button - Show if premium and subscription is active */}
              {isPremium && subscriptionStatus === 'active' && !showCancelConfirm && (
                <button 
                  onClick={() => setShowCancelConfirm(true)} 
                  className={styles.cancelSubscriptionButton}
                >
                  Cancel Subscription
                </button>
              )}

              {/* Cancel Confirmation */}
              {showCancelConfirm && (
                <div className={styles.cancelConfirm}>
                  <p className={styles.cancelWarning}>
                    Are you sure? You&apos;ll keep premium until {premiumExpiresAt?.toLocaleDateString()}.
                  </p>
                  <div className={styles.cancelActions}>
                    <button 
                      onClick={() => setShowCancelConfirm(false)} 
                      className={styles.cancelKeepButton}
                      disabled={cancelLoading}
                    >
                      Keep Premium
                    </button>
                    <button 
                      onClick={handleCancelSubscription} 
                      className={styles.cancelConfirmButton}
                      disabled={cancelLoading}
                    >
                      {cancelLoading ? 'Cancelling...' : 'Yes, Cancel'}
                    </button>
                  </div>
                </div>
              )}

              {/* Cancelling status */}
              {subscriptionStatus === 'cancelling' && (
                <p className={styles.cancellingNote}>
                  Your subscription will end on {premiumExpiresAt?.toLocaleDateString()}
                </p>
              )}
            </div>

            <div className={styles.infoGroup}>
              <div className={styles.infoHeader}>
                <label className={styles.label}>Username</label>
                {!isEditing && (
                  <button onClick={handleEditUsername} className={styles.editButton}>
                    Edit
                  </button>
                )}
              </div>
              {isEditing ? (
                <div className={styles.editForm}>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className={styles.editInput}
                    placeholder="Enter new username"
                    disabled={updateLoading}
                  />
                  <div className={styles.editActions}>
                    <button 
                      onClick={handleCancelEdit} 
                      className={styles.cancelButton}
                      disabled={updateLoading}
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleSaveUsername} 
                      className={styles.saveButton}
                      disabled={updateLoading}
                    >
                      {updateLoading ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className={styles.value}>{user.displayName || 'Not set'}</p>
              )}
            </div>
            
            <div className={styles.infoGroup}>
              <label className={styles.label}>Email</label>
              <p className={styles.value}>{user.email}</p>
            </div>
            
            <div className={styles.infoGroup}>
              <label className={styles.label}>Account Status</label>
              <p className={styles.verifiedBadge}>
                {user.emailVerified ? 'Verified' : 'Not Verified'}
              </p>
            </div>
          </div>

          <button onClick={handleLogout} className={styles.logoutButton}>
            Sign Out
          </button>
        </div>
      </div>
    </main>
  );
}
