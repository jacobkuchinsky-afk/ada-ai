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

// Table parsing types
interface ContentSegment {
  type: 'text' | 'table' | 'table-loading';
  content: string;
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

// Parse pipe-delimited table data into structured format
function parseTableData(tableContent: string): ParsedTable | null {
  const lines = tableContent.trim().split('\n').filter(line => line.trim());
  if (lines.length < 1) return null;
  
  const headers = lines[0].split('|').map(cell => cell.trim());
  const rows = lines.slice(1).map(line => 
    line.split('|').map(cell => cell.trim())
  );
  
  return { headers, rows };
}

// Parse content for §TABLE§ markers and return segments
function parseContentWithTables(content: string, isStreaming: boolean): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const tableStartMarker = '§TABLE§';
  const tableEndMarker = '§/TABLE§';
  
  let remaining = content;
  
  while (remaining.length > 0) {
    const startIdx = remaining.indexOf(tableStartMarker);
    
    if (startIdx === -1) {
      // No more tables, add remaining text
      if (remaining.trim()) {
        segments.push({ type: 'text', content: remaining });
      }
      break;
    }
    
    // Add text before the table
    if (startIdx > 0) {
      const textBefore = remaining.substring(0, startIdx);
      if (textBefore.trim()) {
        segments.push({ type: 'text', content: textBefore });
      }
    }
    
    // Find the end of the table
    const afterStart = remaining.substring(startIdx + tableStartMarker.length);
    const endIdx = afterStart.indexOf(tableEndMarker);
    
    if (endIdx === -1) {
      // Table is not complete yet
      if (isStreaming) {
        // Show loading indicator while streaming
        segments.push({ type: 'table-loading', content: afterStart });
      } else {
        // If not streaming but no end marker, show what we have as text
        segments.push({ type: 'text', content: remaining.substring(startIdx) });
      }
      break;
    }
    
    // Complete table found
    const tableContent = afterStart.substring(0, endIdx);
    segments.push({ type: 'table', content: tableContent });
    
    // Continue with remaining content
    remaining = afterStart.substring(endIdx + tableEndMarker.length);
  }
  
  return segments;
}

// Table loading component with dot animation
function TableLoading() {
  return (
    <div className={styles.tableLoading}>
      <div className={styles.tableLoadingIcon}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
      </div>
      <span className={styles.tableLoadingText}>Creating table</span>
      <span className={styles.tableLoadingDots}>
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </div>
  );
}

// Table component for rendering parsed tables
function DataTable({ tableContent }: { tableContent: string }) {
  const tableData = parseTableData(tableContent);
  
  if (!tableData || tableData.headers.length === 0) {
    return <div className={styles.tableError}>Unable to parse table</div>;
  }
  
  return (
    <div className={styles.tableContainer}>
      <table className={styles.dataTable}>
        <thead>
          <tr>
            {tableData.headers.map((header, idx) => (
              <th key={idx} className={styles.tableHeader}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableData.rows.map((row, rowIdx) => (
            <tr key={rowIdx} className={rowIdx % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd}>
              {row.map((cell, cellIdx) => (
                <td key={cellIdx} className={styles.tableCell}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Render content segments (text, tables, loading states)
function RenderContent({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const segments = parseContentWithTables(content, isStreaming);
  
  return (
    <>
      {segments.map((segment, idx) => {
        switch (segment.type) {
          case 'text':
            return (
              <ReactMarkdown key={idx}>{segment.content}</ReactMarkdown>
            );
          case 'table':
            return <DataTable key={idx} tableContent={segment.content} />;
          case 'table-loading':
            return <TableLoading key={idx} />;
          default:
            return null;
        }
      })}
    </>
  );
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
              <RenderContent content={message.content} isStreaming={message.isStreaming || false} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

