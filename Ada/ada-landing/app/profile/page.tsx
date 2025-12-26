'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useCreditsContext } from '@/context/CreditsContext';
import { formatPremiumExpiry } from '@/lib/creditsService';
import styles from './profile.module.css';

export default function ProfilePage() {
  const { user, loading, logout, updateUsername } = useAuth();
  const { credits, maxCredits, isPremium, premiumExpiresAt, upgradeToPremium, refreshCredits } = useCreditsContext();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [updateLoading, setUpdateLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Code entry state
  const [code, setCode] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [codeSuccess, setCodeSuccess] = useState('');

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

  const handleSubmitCode = async () => {
    if (!code.trim()) {
      setCodeError('Please enter a code');
      return;
    }

    setCodeLoading(true);
    setCodeError('');
    setCodeSuccess('');

    try {
      const result = await upgradeToPremium(code.trim());
      if (result.success) {
        setCodeSuccess(result.message);
        setCode('');
        await refreshCredits();
      } else {
        setCodeError(result.message);
      }
    } catch {
      setCodeError('Failed to apply code');
    } finally {
      setCodeLoading(false);
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

            {/* Premium Code Entry - Only show if not premium */}
            {!isPremium && (
              <div className={styles.infoGroup}>
                <label className={styles.label}>Upgrade Code</label>
                {codeError && <p className={styles.codeError}>{codeError}</p>}
                {codeSuccess && <p className={styles.codeSuccess}>{codeSuccess}</p>}
                <div className={styles.codeForm}>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className={styles.codeInput}
                    placeholder="Enter upgrade code"
                    disabled={codeLoading}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button 
                    onClick={handleSubmitCode} 
                    className={styles.codeButton}
                    disabled={codeLoading}
                  >
                    {codeLoading ? 'Applying...' : 'Apply'}
                  </button>
                </div>
              </div>
            )}

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
