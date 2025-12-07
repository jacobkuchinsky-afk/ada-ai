'use client';

import { useState, useEffect, useCallback } from 'react';

const TYPING_SPEED = 80;
const DELETING_SPEED = 40;
const PAUSE_DURATION = 2000;

interface UseTypingEffectProps {
  phrases: string[];
}

export function useTypingEffect({ phrases }: UseTypingEffectProps) {
  const [currentText, setCurrentText] = useState('');
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const currentPhrase = phrases[phraseIndex];

  const type = useCallback(() => {
    if (isPaused) return;

    if (isDeleting) {
      // Deleting characters
      if (currentText.length > 0) {
        setCurrentText(prev => prev.slice(0, -1));
      } else {
        // Done deleting, move to next phrase
        setIsDeleting(false);
        setPhraseIndex(prev => (prev + 1) % phrases.length);
      }
    } else {
      // Typing characters
      if (currentText.length < currentPhrase.length) {
        setCurrentText(prev => currentPhrase.slice(0, prev.length + 1));
      } else {
        // Done typing, pause then start deleting
        setIsPaused(true);
        setTimeout(() => {
          setIsPaused(false);
          setIsDeleting(true);
        }, PAUSE_DURATION);
      }
    }
  }, [currentText, currentPhrase, isDeleting, isPaused, phrases.length]);

  useEffect(() => {
    if (isPaused) return;

    const speed = isDeleting ? DELETING_SPEED : TYPING_SPEED;
    const timeout = setTimeout(type, speed);

    return () => clearTimeout(timeout);
  }, [type, isDeleting, isPaused]);

  return { currentText, isTyping: !isDeleting && !isPaused };
}

