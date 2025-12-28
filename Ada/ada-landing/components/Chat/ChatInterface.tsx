'use client';

import { useEffect, useRef } from 'react';
import ChatInput from './ChatInput';
import ChatMessage, { Message } from './ChatMessage';
import styles from './Chat.module.css';

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  statusMessage?: string;
  onSkipSearch?: () => void;  // Callback to skip searching and go to generation
  fastMode: boolean;
  onToggleFastMode: () => void;
}

export default function ChatInterface({ messages, onSendMessage, isLoading, statusMessage, onSkipSearch, fastMode, onToggleFastMode }: ChatInterfaceProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const isEmpty = messages.length === 0;

  if (isEmpty) {
    return (
      <div className={styles.chatContainer}>
        <div className={styles.emptyState}>
          <h1 className={styles.delvedTitle}>Delved AI</h1>
          <div className={styles.centeredInput}>
            <ChatInput onSubmit={onSendMessage} disabled={isLoading} fastMode={fastMode} onToggleFastMode={onToggleFastMode} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.chatContainer}>
      <div className={styles.messagesContainer}>
        <div className={styles.messagesList}>
          {messages.map((message) => (
            <ChatMessage 
              key={message.id} 
              message={message} 
              onSkipSearch={onSkipSearch}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
      
      <div className={styles.inputContainer}>
        <ChatInput onSubmit={onSendMessage} disabled={isLoading} fastMode={fastMode} onToggleFastMode={onToggleFastMode} />
      </div>
    </div>
  );
}
