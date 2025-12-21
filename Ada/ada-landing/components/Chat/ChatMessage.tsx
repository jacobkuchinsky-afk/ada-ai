'use client';

import styles from './Chat.module.css';
import SearchStatus, { SearchEntry, StatusInfo } from './SearchStatus';
import ReactMarkdown from 'react-markdown';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isTyping?: boolean;
  isStreaming?: boolean;
  searchHistory?: SearchEntry[];
  currentStatus?: StatusInfo | null;
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
      
      {/* Show search status for assistant messages */}
      {!isUser && message.searchHistory && message.searchHistory.length > 0 && (
        <SearchStatus 
          searchHistory={message.searchHistory} 
          status={message.currentStatus}
          isStreaming={message.isStreaming || false}
        />
      )}
      
      {/* Show current status while processing (before content arrives) */}
      {!isUser && message.currentStatus && !message.content && (
        <div className={styles.statusIndicator}>
          <span className={styles.statusDot}></span>
          <span className={styles.statusText}>{message.currentStatus.message}</span>
        </div>
      )}
      
      {/* Show generating indicator if streaming but no content yet and no search history */}
      {!isUser && message.isStreaming && !message.content && !message.searchHistory?.length && !message.currentStatus && (
        <div className={styles.statusIndicator}>
          <span className={styles.statusDot}></span>
          <span className={styles.statusText}>Generating response...</span>
        </div>
      )}
      
      {/* Show fallback for loaded messages with search history but no content (interrupted response) */}
      {!isUser && !message.isStreaming && !message.content && message.searchHistory && message.searchHistory.length > 0 && (
        <div className={styles.incompleteMessage}>
          Response was interrupted. Please try again.
        </div>
      )}
      
      {/* Only show message content if there is content, or for user messages */}
      {(isUser || message.content) && (
        <div className={styles.messageContent}>
          {message.isTyping ? (
            <div className={styles.typingIndicator}>
              <span></span>
              <span></span>
              <span></span>
            </div>
          ) : isUser ? (
            message.content
          ) : (
            <div className={styles.markdownContent}>
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

