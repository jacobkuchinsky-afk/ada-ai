'use client';

import styles from './AboutSection.module.css';
import Button from '@/components/Buttons/Button';

interface AboutSectionProps {
  opacity: number;
}

export default function AboutSection({ opacity }: AboutSectionProps) {
  return (
    <section 
      className={styles.about}
      style={{ opacity }}
    >
      <div className={styles.container}>
        <div className={styles.contentBox}>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Get Deeper Answers</h2>
            <p className={styles.sectionText}>
              Delved uses a specialized search agent to always get you the most factual 
              and comprehensive result. No tricks, no omissions, just searching.
            </p>
          </div>

          <div className={styles.divider} />

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>It&apos;s Free</h2>
            <p className={styles.sectionText}>
              Sign up for a free account now and start searching.
            </p>
            <div className={styles.buttonWrapper}>
              <Button href="/signup">Sign Up</Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
