'use client';

import Link from 'next/link';
import styles from './Logo.module.css';

export default function Logo() {
  return (
    <Link href="/" className={styles.logo}>
      <span className={styles.logoText}>Ada</span>
    </Link>
  );
}
