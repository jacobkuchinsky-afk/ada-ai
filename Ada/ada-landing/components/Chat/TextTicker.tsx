'use client';

import { useEffect, useState } from 'react';
import styles from './Chat.module.css';

interface TextTickerProps {
  text: string;
  isActive: boolean;
}

export default function TextTicker({ text, isActive }: TextTickerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isActive && text) {
      setVisible(true);
    } else {
      // Fade out with delay
      const timeout = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timeout);
    }
  }, [isActive, text]);

  if (!visible || !text) {
    return null;
  }

  // Duplicate text for seamless loop effect
  const displayText = `${text}  •  ${text}  •  ${text}`;

  return (
    <div className={`${styles.textTickerContainer} ${!isActive ? styles.textTickerFadeOut : ''}`}>
      <div className={styles.textTickerLabel}>parsing</div>
      <div className={styles.textTickerBox}>
        <div className={styles.textTickerContent}>
          {displayText}
        </div>
      </div>
    </div>
  );
}



