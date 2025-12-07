'use client';

import styles from './AboutSection.module.css';

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
        <h2 className={styles.title}>About Us</h2>
        
        <div className={styles.contentBox}>
          <div className={styles.textArea}>
            {/* Placeholder content - replace with actual about content */}
            <p className={styles.placeholder}>
              [About Us content goes here]
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

