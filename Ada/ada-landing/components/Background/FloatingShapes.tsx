'use client';

import styles from './FloatingShapes.module.css';

export default function FloatingShapes() {
  return (
    <div className={styles.container}>
      {/* Large organic shapes */}
      <div className={`${styles.shape} ${styles.shape1}`} />
      <div className={`${styles.shape} ${styles.shape2}`} />
      <div className={`${styles.shape} ${styles.shape3}`} />
      <div className={`${styles.shape} ${styles.shape4}`} />
      <div className={`${styles.shape} ${styles.shape5}`} />
      <div className={`${styles.shape} ${styles.shape6}`} />
      
      {/* Medium shapes */}
      <div className={`${styles.shape} ${styles.shape7}`} />
      <div className={`${styles.shape} ${styles.shape8}`} />
      <div className={`${styles.shape} ${styles.shape9}`} />
      
      {/* Small accent shapes */}
      <div className={`${styles.shape} ${styles.shape10}`} />
      <div className={`${styles.shape} ${styles.shape11}`} />
      <div className={`${styles.shape} ${styles.shape12}`} />
    </div>
  );
}

