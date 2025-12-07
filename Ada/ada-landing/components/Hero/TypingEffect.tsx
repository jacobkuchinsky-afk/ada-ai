'use client';

import { useTypingEffect } from '@/hooks/useTypingEffect';
import styles from './Hero.module.css';

const SEARCH_PHRASES = [
  "Research the American Revolution",
  "Explain quantum computing simply",
  "Compare React vs Vue frameworks",
  "Summarize today's AI news",
  "How does photosynthesis work",
  "Best practices for REST APIs",
  "History of the Roman Empire",
  "Explain machine learning basics",
  "What causes climate change",
  "Compare Python vs JavaScript",
];

export default function TypingEffect() {
  const { currentText } = useTypingEffect({ phrases: SEARCH_PHRASES });

  return (
    <h1 className={styles.typingText}>
      {currentText}
      <span className={styles.cursor}>|</span>
    </h1>
  );
}

