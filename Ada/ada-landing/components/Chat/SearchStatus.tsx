'use client';

import { useState } from 'react';
import styles from './Chat.module.css';
import TextTicker from './TextTicker';

// Types for search functionality
export interface SourceInfo {
  url: string;
  title: string;
  domain: string;
  error?: string;
}

export interface SearchEntry {
  query: string;
  sources: SourceInfo[];
  iteration: number;
  queryIndex?: number;  // For parallel queries within same iteration
  status?: 'searching' | 'complete';
  textPreview?: string;  // Text preview from first source for visual feedback
}

export interface StatusInfo {
  message: string;
  step: number;
  icon: 'thinking' | 'searching' | 'evaluating' | 'generating';
  canSkip?: boolean;  // True when user can skip searching and go to generation
}

interface SearchStatusProps {
  status?: StatusInfo | null;
  searchHistory: SearchEntry[];
  isStreaming: boolean;
  onSkipSearch?: () => void;  // Callback to skip searching
  canSkip?: boolean;  // Whether skip is currently available
  textPreview?: string;  // Text preview for ticker animation
}

export default function SearchStatus({ searchHistory, isStreaming, canSkip, onSkipSearch, textPreview, status }: SearchStatusProps) {
  const [expandedSearches, setExpandedSearches] = useState<Set<string>>(new Set());

  // Create unique key for each search using iteration and queryIndex
  const getSearchKey = (search: SearchEntry) => `${search.iteration}-${search.queryIndex || 0}`;

  const toggleSearch = (searchKey: string) => {
    setExpandedSearches(prev => {
      const newSet = new Set(prev);
      if (newSet.has(searchKey)) {
        newSet.delete(searchKey);
      } else {
        newSet.add(searchKey);
      }
      return newSet;
    });
  };

  // Don't render if no search history
  if (searchHistory.length === 0) {
    return null;
  }

  // Check if any search is currently in progress
  const hasActiveSearch = searchHistory.some(s => s.status === 'searching');
  
  // Show skip button when: streaming, canSkip is true, and callback exists
  const showSkipButton = isStreaming && canSkip && onSkipSearch;

  // Get text preview from the most recent search entry that has one
  const activeTextPreview = textPreview || searchHistory.find(s => s.textPreview)?.textPreview;
  
  // Show ticker during search phase: streaming, have text preview, and not yet generating response
  const isGenerating = status?.icon === 'generating';
  const showTicker = isStreaming && activeTextPreview && !isGenerating;

  return (
    <div className={styles.searchStatusContainer}>
      {/* Single Skip Button at the top when in goodness loop */}
      {showSkipButton && (
        <button 
          className={styles.skipSearchButtonInline}
          onClick={onSkipSearch}
          type="button"
        >
          ⏭ Skip & Generate
        </button>
      )}
      
      {/* Text Ticker - shows parsed text flying through during search phase */}
      {showTicker && (
        <TextTicker 
          text={activeTextPreview} 
          isActive={true} 
        />
      )}
      
      {/* Search History Pills */}
      <div className={styles.searchHistoryList}>
        {searchHistory.map((search) => {
          const searchKey = getSearchKey(search);
          const isExpanded = expandedSearches.has(searchKey);
          const isSearching = search.status === 'searching';
          
          return (
            <div key={searchKey} className={styles.searchEntry}>
              <button
                className={`${styles.searchPill} ${isExpanded ? styles.searchPillExpanded : ''} ${isSearching ? styles.searchPillSearching : ''}`}
                onClick={() => !isSearching && toggleSearch(searchKey)}
                disabled={isSearching}
              >
                <span className={styles.searchIconText}>
                  {isSearching ? 'searching' : 'searched'}
                </span>
                <span className={styles.searchQuery}>
                  {search.query.length > 50 
                    ? search.query.substring(0, 50) + '...' 
                    : search.query
                  }
                </span>
                {!isSearching && search.sources.length > 0 && (
                  <span className={styles.sourceCount}>
                    {search.sources.length} sources
                  </span>
                )}
                {!isSearching && (
                  <span className={styles.expandIcon}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                )}
              </button>
              
              {/* Expanded Source List */}
              {isExpanded && search.sources.length > 0 && (
                <div className={styles.sourcesList}>
                  {search.sources.map((source, sourceIndex) => (
                    <a
                      key={`source-${sourceIndex}`}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.sourceLink}
                    >
                      <span className={styles.sourceDomain}>{source.domain}</span>
                      <span className={styles.sourceTitle}>{source.title}</span>
                      {source.error && (
                        <span className={styles.sourceError}>error</span>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
