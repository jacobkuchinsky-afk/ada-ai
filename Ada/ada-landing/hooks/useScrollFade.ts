'use client';

import { useState, useEffect } from 'react';

interface UseScrollFadeReturn {
  heroOpacity: number;
  aboutOpacity: number;
  scrollToAbout: () => void;
}

export function useScrollFade(): UseScrollFadeReturn {
  const [heroOpacity, setHeroOpacity] = useState(1);
  const [aboutOpacity, setAboutOpacity] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const windowHeight = window.innerHeight;
      
      // Faster fade - completes at 30% of viewport scroll (was 60%)
      const scrollProgress = Math.min(scrollY / (windowHeight * 0.3), 1);
      
      // Hero fades out quickly as user scrolls
      setHeroOpacity(1 - scrollProgress);
      
      // About section fades in
      setAboutOpacity(scrollProgress);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial call

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToAbout = () => {
    window.scrollTo({
      top: window.innerHeight * 0.5,
      behavior: 'smooth'
    });
  };

  return { heroOpacity, aboutOpacity, scrollToAbout };
}
