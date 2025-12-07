'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import FloatingShapes from '@/components/Background/FloatingShapes';
import Logo from '@/components/Logo/Logo';
import AuthForm from '@/components/Auth/AuthForm';
import styles from './signup.module.css';

export default function SignUpPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      if (user.emailVerified) {
        router.push('/dashboard');
      } else {
        router.push('/verify-email');
      }
    }
  }, [user, loading, router]);

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

  if (user) {
    return null; // Will redirect
  }

  return (
    <main className={styles.main}>
      <FloatingShapes />
      <Logo />
      <div className={styles.content}>
        <AuthForm />
      </div>
    </main>
  );
}
