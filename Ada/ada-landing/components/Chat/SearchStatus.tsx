'use client';

import { useState } from 'react';
import styles from './Chat.module.css';

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
  status?: 'searching' | 'complete';
}

export interface StatusInfo {
  message: string;
  step: number;
  icon: 'thinking' | 'searching' | 'evaluating' | 'generating';
}

interface SearchStatusProps {
  status?: StatusInfo | null;
  searchHistory: SearchEntry[];
  isStreaming: boolean;
}

export default function SearchStatus({ searchHistory }: SearchStatusProps) {
  const [expandedSearches, setExpandedSearches] = useState<Set<number>>(new Set());

  const toggleSearch = (iteration: number) => {
    setExpandedSearches(prev => {
      const newSet = new Set(prev);
      if (newSet.has(iteration)) {
        newSet.delete(iteration);
      } else {
        newSet.add(iteration);
      }
      return newSet;
    });
  };

  // Don't render if no search history
  if (searchHistory.length === 0) {
    return null;
  }

  return (
    <div className={styles.searchStatusContainer}>
      {/* Search History Pills */}
      <div className={styles.searchHistoryList}>
        {searchHistory.map((search, index) => {
          const isExpanded = expandedSearches.has(search.iteration);
          const isSearching = search.status === 'searching';
          
          return (
            <div key={`search-${search.iteration}-${index}`} className={styles.searchEntry}>
              <button
                className={`${styles.searchPill} ${isExpanded ? styles.searchPillExpanded : ''} ${isSearching ? styles.searchPillSearching : ''}`}
                onClick={() => !isSearching && toggleSearch(search.iteration)}
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
