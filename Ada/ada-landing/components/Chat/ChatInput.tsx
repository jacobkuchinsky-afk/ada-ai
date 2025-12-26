'use client';

import { useState, KeyboardEvent } from 'react';
import styles from './Chat.module.css';

interface ChatInputProps {
  onSubmit: (message: string, fastMode: boolean) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSubmit, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [fastMode, setFastMode] = useState(false);

  const handleSubmit = () => {
    if (message.trim() && !disabled) {
      onSubmit(message.trim(), fastMode);
      setMessage('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleFastMode = () => {
    setFastMode(!fastMode);
  };

  return (
    <div className={styles.inputOuterWrapper}>
      <div className={styles.inputWrapper}>
        <textarea
          className={styles.input}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          rows={1}
          disabled={disabled}
        />
        <button 
          className={styles.submitButton}
          onClick={handleSubmit}
          disabled={!message.trim() || disabled}
          title="Send message"
        >
          <svg 
            width="20" 
            height="20" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </div>
      <div className={styles.inputActionsRow}>
        <button
          className={`${styles.fastModeButton} ${fastMode ? styles.fastModeActive : ''}`}
          onClick={toggleFastMode}
          type="button"
          title={fastMode ? 'Fast mode enabled - quicker responses with less depth' : 'Enable fast mode for quicker responses'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill={fastMode ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span>Fast</span>
        </button>
      </div>
    </div>
  );
}
