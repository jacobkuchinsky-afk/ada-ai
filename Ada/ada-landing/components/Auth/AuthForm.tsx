'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import styles from './AuthForm.module.css';

type AuthMode = 'login' | 'signup' | 'forgot';

/**
 * Validate password strength and return hints.
 * Returns null if password is strong enough.
 */
function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Include at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Include at least one lowercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Include at least one number';
  }
  return null;
}

export default function AuthForm() {
  const [mode, setMode] = useState<AuthMode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { signup, login, resetPassword } = useAuth();
  const router = useRouter();

  // Password strength validation (only shown for signup)
  const passwordHint = useMemo(() => {
    if (mode !== 'signup' || password.length === 0) return null;
    return validatePassword(password);
  }, [password, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        if (!username.trim()) {
          throw new Error('Username is required');
        }
        
        // Check password strength before submitting
        const pwError = validatePassword(password);
        if (pwError) {
          throw new Error(pwError);
        }
        
        const result = await signup(email, password, username);
        // Store waitlist status for after email verification
        if (result.shouldWaitlist) {
          sessionStorage.setItem('pendingWaitlist', 'true');
        }
        router.push('/verify-email');
      } else if (mode === 'login') {
        await login(email, password);
        // Check if email is verified after login
        const { user } = await import('@/lib/firebase').then(m => ({ user: m.auth.currentUser }));
        if (user && !user.emailVerified) {
          router.push('/verify-email');
        } else {
          router.push('/dashboard');
        }
      } else if (mode === 'forgot') {
        await resetPassword(email);
        setSuccess('Password reset email sent! Check your inbox.');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      // Clean up Firebase error messages
      if (errorMessage.includes('auth/email-already-in-use')) {
        setError('This email is already registered');
      } else if (errorMessage.includes('auth/weak-password')) {
        setError('Password should be at least 6 characters');
      } else if (errorMessage.includes('auth/invalid-email')) {
        setError('Invalid email address');
      } else if (errorMessage.includes('auth/user-not-found')) {
        setError('No account found with this email');
      } else if (errorMessage.includes('auth/wrong-password') || errorMessage.includes('auth/invalid-credential')) {
        setError('Incorrect email or password');
      } else {
        setError('Something went wrong. Please try again in a bit.');
      }
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setError('');
    setSuccess('');
  };

  return (
    <div className={styles.formContainer}>
      <h1 className={styles.title}>
        {mode === 'signup' && 'Create Account'}
        {mode === 'login' && 'Welcome Back'}
        {mode === 'forgot' && 'Reset Password'}
      </h1>
      
      <p className={styles.subtitle}>
        {mode === 'signup' && 'Join Delved to start your AI-powered search journey'}
        {mode === 'login' && 'Sign in to continue with Delved'}
        {mode === 'forgot' && 'Enter your email to receive a reset link'}
      </p>

      <form onSubmit={handleSubmit} className={styles.form}>
        {mode === 'signup' && (
          <div className={styles.inputGroup}>
            <label htmlFor="username" className={styles.label}>Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={styles.input}
              placeholder="Choose a username"
              required
              disabled={loading}
            />
          </div>
        )}

        <div className={styles.inputGroup}>
          <label htmlFor="email" className={styles.label}>Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.input}
            placeholder="Enter your email"
            required
            disabled={loading}
          />
        </div>

        {mode !== 'forgot' && (
          <div className={styles.inputGroup}>
            <label htmlFor="password" className={styles.label}>Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              placeholder="Enter your password"
              required
              disabled={loading}
              minLength={8}
            />
            {/* Password strength hint for signup */}
            {mode === 'signup' && passwordHint && (
              <p className={styles.passwordHint}>{passwordHint}</p>
            )}
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}
        {success && <p className={styles.success}>{success}</p>}

        <button 
          type="submit" 
          className={styles.submitButton}
          disabled={loading}
        >
          {loading ? (
            <span className={styles.spinner}></span>
          ) : (
            <>
              {mode === 'signup' && 'Sign Up'}
              {mode === 'login' && 'Log In'}
              {mode === 'forgot' && 'Send Reset Link'}
            </>
          )}
        </button>
      </form>

      <div className={styles.footer}>
        {mode === 'login' && (
          <>
            <button 
              onClick={() => switchMode('forgot')} 
              className={styles.linkButton}
            >
              Forgot password?
            </button>
            <p className={styles.switchText}>
              Don&apos;t have an account?{' '}
              <button onClick={() => switchMode('signup')} className={styles.linkButton}>
                Sign up
              </button>
            </p>
          </>
        )}
        
        {mode === 'signup' && (
          <p className={styles.switchText}>
            Already have an account?{' '}
            <button onClick={() => switchMode('login')} className={styles.linkButton}>
              Log in
            </button>
          </p>
        )}
        
        {mode === 'forgot' && (
          <p className={styles.switchText}>
            Remember your password?{' '}
            <button onClick={() => switchMode('login')} className={styles.linkButton}>
              Back to login
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

