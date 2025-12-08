'use client';

import FloatingShapes from '@/components/Background/FloatingShapes';
import Hero from '@/components/Hero/Hero';
import AboutSection from '@/components/AboutSection/AboutSection';
import { useScrollFade } from '@/hooks/useScrollFade';

export default function Home() {
  const { heroOpacity, aboutOpacity } = useScrollFade();

  return (
    <main>
      <FloatingShapes />
      <Hero opacity={heroOpacity} />
      <AboutSection opacity={aboutOpacity} />
    </main>
  );
}
