'use client';

import styles from './Chat.module.css';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isTyping?: boolean;
  isStreaming?: boolean;
  searchHistory?: import('./SearchStatus').SearchEntry[];
  currentStatus?: import('./SearchStatus').StatusInfo | null;
  rawSearchData?: string;  // Raw search data for summarization on next message
}

interface ChatMessageProps {
  message: Message;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`${styles.message} ${isUser ? styles.userMessage : styles.assistantMessage}`}>
      <div className={styles.messageHeader}>
        <span className={styles.messageRole}>
          {isUser ? 'You' : 'Ada'}
        </span>
      </div>
      <div className={styles.messageContent}>
        {message.isTyping ? (
          <div className={styles.typingIndicator}>
            <span></span>
            <span></span>
            <span></span>
          </div>
        ) : (
          message.content
        )}
      </div>
    </div>
  );
}

