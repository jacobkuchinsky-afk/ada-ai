'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import styles from './Sidebar.module.css';
import { ChatPreview } from '@/lib/chatService';
import { useCreditsContext } from '@/context/CreditsContext';

interface SidebarProps {
  onNewChat: () => void;
  chats: ChatPreview[];
  currentChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  isLoadingChats: boolean;
  streamingChatId: string | null;
}

// Format relative time
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Sidebar({ 
  onNewChat, 
  chats, 
  currentChatId, 
  onSelectChat, 
  onDeleteChat,
  isLoadingChats,
  streamingChatId
}: SidebarProps) {
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { credits, maxCredits, isPremium, isLoading: isLoadingCredits } = useCreditsContext();

  const handleDeleteClick = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    onDeleteChat(chatId);
  };

  // Filter chats based on search query
  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return chats;
    const query = searchQuery.toLowerCase().trim();
    return chats.filter(chat => 
      chat.title.toLowerCase().includes(query)
    );
  }, [chats, searchQuery]);

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.topSection}>
        {/* Search Bar */}
        <div className={styles.searchContainer}>
          <svg 
            className={styles.searchIcon}
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button 
              className={styles.clearSearchButton}
              onClick={handleClearSearch}
              title="Clear search"
            >
              <svg 
                width="14" 
                height="14" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <button 
          className={styles.newChatButton} 
          onClick={onNewChat}
          title="New Chat"
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
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>New Chat</span>
        </button>
      </div>

      <div className={styles.chatList}>
        {isLoadingChats ? (
          <div className={styles.loadingChats}>
            <div className={styles.chatSkeleton}></div>
            <div className={styles.chatSkeleton}></div>
            <div className={styles.chatSkeleton}></div>
          </div>
        ) : chats.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No chats yet</p>
          </div>
        ) : filteredChats.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No chats found</p>
          </div>
        ) : (
          filteredChats.map((chat) => (
            <div
              key={chat.id}
              className={`${styles.chatItem} ${currentChatId === chat.id ? styles.active : ''}`}
              onClick={() => onSelectChat(chat.id)}
              onMouseEnter={() => setHoveredChatId(chat.id)}
              onMouseLeave={() => setHoveredChatId(null)}
            >
              {/* Streaming indicator */}
              {streamingChatId === chat.id && (
                <span className={styles.streamingIndicator} title="Generating..."></span>
              )}
              <div className={styles.chatItemContent}>
                <span className={styles.chatTitle}>{chat.title}</span>
                <span className={styles.chatTime}>
                  {formatRelativeTime(new Date(chat.updatedAt))}
                </span>
              </div>
              {hoveredChatId === chat.id && (
                <button
                  className={styles.deleteButton}
                  onClick={(e) => handleDeleteClick(e, chat.id)}
                  title="Delete chat"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <div className={styles.bottomSection}>
        {/* Credits Display */}
        <div className={styles.creditsDisplay}>
          {isLoadingCredits ? (
            <div className={styles.creditsSkeleton}></div>
          ) : (
            <>
              <div className={styles.creditsInfo}>
                <span className={styles.creditsCount}>{credits}/{maxCredits}</span>
                <span className={styles.creditsLabel}>credits</span>
              </div>
              {isPremium && (
                <span className={styles.premiumBadge}>PRO</span>
              )}
            </>
          )}
        </div>

        <Link 
          href="/profile" 
          className={`${styles.profileButton} ${isPremium ? styles.profileButtonPremium : ''}`} 
          title="Profile"
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
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span>Profile</span>
        </Link>
      </div>
    </aside>
  );
}
