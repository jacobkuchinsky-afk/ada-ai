'use client';

import styles from './Hero.module.css';
import TypingEffect from './TypingEffect';
import Button from '../Buttons/Button';
import Logo from '../Logo/Logo';

interface HeroProps {
  opacity: number;
  onAboutClick: () => void;
}

export default function Hero({ opacity, onAboutClick }: HeroProps) {
  return (
    <>
      <Logo />
      <section 
        className={styles.hero}
        style={{ opacity }}
      >
        <div className={styles.content}>
          <div className={styles.typingContainer}>
            <TypingEffect />
          </div>
          
          <p className={styles.tagline}>Your new search agent</p>
          
          <div className={styles.buttons}>
            <Button variant="primary" onClick={onAboutClick}>
              About Us
            </Button>
            <Button variant="primary" href="/signup">
              Sign Up for Free
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
