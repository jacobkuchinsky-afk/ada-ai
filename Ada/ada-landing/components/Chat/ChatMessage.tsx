'use client';

import styles from './Chat.module.css';
import SearchStatus, { SearchEntry, StatusInfo } from './SearchStatus';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isTyping?: boolean;
  isStreaming?: boolean;
  searchHistory?: SearchEntry[];
  currentStatus?: StatusInfo | null;
}

interface ChatMessageProps {
  message: Message;
}

// Parse a table from [TABLE]...[/TABLE] format
function parseTable(tableContent: string, keyStart: number, isIncomplete: boolean = false): { element: React.ReactNode; key: number } {
  // Split by newlines and filter out empty lines
  const lines = tableContent.trim().split('\n').filter(line => line.trim());
  
  // For incomplete tables during streaming, show loading state if no content yet
  if (lines.length < 1) {
    if (isIncomplete) {
      const loadingElement = (
        <div key={keyStart} className={styles.tableLoading}>
          <span className={styles.tableLoadingDot}></span>
          <span>Building table...</span>
        </div>
      );
      return { element: loadingElement, key: keyStart + 1 };
    }
    return { element: null, key: keyStart };
  }
  
  // First line is headers - split by | but keep structure
  const headerParts = lines[0].split('|').map(h => h.trim());
  // Remove empty strings at start/end (from leading/trailing |)
  const headers = headerParts.filter((h, i) => 
    !(i === 0 && h === '') && !(i === headerParts.length - 1 && h === '')
  );
  
  if (headers.length === 0) {
    if (isIncomplete) {
      const loadingElement = (
        <div key={keyStart} className={styles.tableLoading}>
          <span className={styles.tableLoadingDot}></span>
          <span>Building table...</span>
        </div>
      );
      return { element: loadingElement, key: keyStart + 1 };
    }
    return { element: null, key: keyStart };
  }
  
  // Rest are data rows - preserve empty cells!
  const rows = lines.slice(1).map(line => {
    const cellParts = line.split('|').map(cell => cell.trim());
    // Remove empty strings at start/end (from leading/trailing |)
    const cells = cellParts.filter((c, i) => 
      !(i === 0 && c === '') && !(i === cellParts.length - 1 && c === '')
    );
    return cells;
  }).filter(row => row.some(cell => cell !== '')); // Keep rows that have at least one non-empty cell
  
  const table = (
    <div key={keyStart} className={`${styles.tableWrapper} ${isIncomplete ? styles.tableStreaming : ''}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th key={i} className={styles.tableHeader}>{parseInlineMarkdown(header) || '\u00A0'}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className={rowIndex % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd}>
              {headers.map((_, cellIndex) => (
                <td key={cellIndex} className={styles.tableCell}>
                  {row[cellIndex] ? parseInlineMarkdown(row[cellIndex]) : '\u00A0'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {isIncomplete && (
        <div className={styles.tableStreamingIndicator}>
          <span className={styles.tableLoadingDot}></span>
        </div>
      )}
    </div>
  );
  
  return { element: table, key: keyStart + 1 };
}

// Parse markdown and return formatted JSX
function parseMarkdown(text: string, isStreaming: boolean = false): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let key = 0;
  
  // First, extract and process tables
  const tableRegex = /\[TABLE\]([\s\S]*?)\[\/TABLE\]/gi;
  let lastIndex = 0;
  let match;
  const textParts: { type: 'text' | 'table' | 'incomplete_table'; content: string }[] = [];
  
  while ((match = tableRegex.exec(text)) !== null) {
    // Add text before the table
    if (match.index > lastIndex) {
      textParts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    // Add the table
    textParts.push({ type: 'table', content: match[1] });
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text after last table
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    
    // Check for incomplete table (has [TABLE] but no [/TABLE])
    const incompleteTableMatch = remainingText.match(/\[TABLE\]([\s\S]*)$/i);
    if (incompleteTableMatch) {
      // Add text before the incomplete table
      const beforeTable = remainingText.slice(0, incompleteTableMatch.index);
      if (beforeTable) {
        textParts.push({ type: 'text', content: beforeTable });
      }
      // Add incomplete table marker
      textParts.push({ type: 'incomplete_table', content: incompleteTableMatch[1] });
    } else {
      textParts.push({ type: 'text', content: remainingText });
    }
  }
  
  // If no tables found, check for incomplete table at the start
  if (textParts.length === 0) {
    const incompleteTableMatch = text.match(/\[TABLE\]([\s\S]*)$/i);
    if (incompleteTableMatch) {
      const beforeTable = text.slice(0, incompleteTableMatch.index);
      if (beforeTable) {
        textParts.push({ type: 'text', content: beforeTable });
      }
      textParts.push({ type: 'incomplete_table', content: incompleteTableMatch[1] });
    } else {
      textParts.push({ type: 'text', content: text });
    }
  }
  
  // Process each part
  for (const part of textParts) {
    if (part.type === 'table') {
      const result = parseTable(part.content, key);
      if (result.element) {
        elements.push(result.element);
        key = result.key;
      }
    } else if (part.type === 'incomplete_table') {
      // Render incomplete table (streaming) - show table being built
      const result = parseTable(part.content, key, true);
      if (result.element) {
        elements.push(result.element);
        key = result.key;
      }
    } else {
      // Process regular text content
      const lines = part.content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Handle bullet points
        if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
          elements.push(
            <div key={key++} className={styles.bulletPoint}>
              {parseInlineMarkdown(line.trim().substring(2))}
            </div>
          );
          continue;
        }
        
        // Handle numbered lists
        const numberedMatch = line.trim().match(/^(\d+)\.\s(.+)/);
        if (numberedMatch) {
          elements.push(
            <div key={key++} className={styles.numberedItem}>
              <span className={styles.listNumber}>{numberedMatch[1]}.</span>
              {parseInlineMarkdown(numberedMatch[2])}
            </div>
          );
          continue;
        }
        
        // Handle headers
        if (line.trim().startsWith('### ')) {
          elements.push(
            <h3 key={key++} className={styles.heading3}>
              {parseInlineMarkdown(line.trim().substring(4))}
            </h3>
          );
          continue;
        }
        
        if (line.trim().startsWith('## ')) {
          elements.push(
            <h2 key={key++} className={styles.heading2}>
              {parseInlineMarkdown(line.trim().substring(3))}
            </h2>
          );
          continue;
        }
        
        if (line.trim().startsWith('# ')) {
          elements.push(
            <h1 key={key++} className={styles.heading1}>
              {parseInlineMarkdown(line.trim().substring(2))}
            </h1>
          );
          continue;
        }
        
        // Handle section headers (lines ending with :)
        if (line.trim().endsWith(':') && line.trim().length < 60 && !line.includes('http')) {
          elements.push(
            <div key={key++} className={styles.sectionHeader}>
              {parseInlineMarkdown(line)}
            </div>
          );
          continue;
        }
        
        // Regular paragraph
        if (line.trim()) {
          elements.push(
            <p key={key++} className={styles.paragraph}>
              {parseInlineMarkdown(line)}
            </p>
          );
          continue;
        }
        
        // Empty line for spacing
        elements.push(<div key={key++} className={styles.spacer} />);
      }
    }
  }
  
  return elements;
}

// Parse inline markdown (bold, italic, code, links)
function parseInlineMarkdown(text: string): React.ReactNode {
  const elements: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  
  while (remaining.length > 0) {
    // Bold with **text**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      elements.push(<strong key={key++} className={styles.bold}>{boldMatch[1]}</strong>);
      remaining = remaining.substring(boldMatch[0].length);
      continue;
    }
    
    // Bold with __text__
    const boldMatch2 = remaining.match(/^__(.+?)__/);
    if (boldMatch2) {
      elements.push(<strong key={key++} className={styles.bold}>{boldMatch2[1]}</strong>);
      remaining = remaining.substring(boldMatch2[0].length);
      continue;
    }
    
    // Italic with *text* or _text_
    const italicMatch = remaining.match(/^\*([^*]+?)\*/);
    if (italicMatch) {
      elements.push(<em key={key++} className={styles.italic}>{italicMatch[1]}</em>);
      remaining = remaining.substring(italicMatch[0].length);
      continue;
    }
    
    const italicMatch2 = remaining.match(/^_([^_]+?)_/);
    if (italicMatch2) {
      elements.push(<em key={key++} className={styles.italic}>{italicMatch2[1]}</em>);
      remaining = remaining.substring(italicMatch2[0].length);
      continue;
    }
    
    // Inline code with `code`
    const codeMatch = remaining.match(/^`([^`]+?)`/);
    if (codeMatch) {
      elements.push(<code key={key++} className={styles.inlineCode}>{codeMatch[1]}</code>);
      remaining = remaining.substring(codeMatch[0].length);
      continue;
    }
    
    // Links with [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+?)\]\(([^)]+?)\)/);
    if (linkMatch) {
      elements.push(
        <a key={key++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className={styles.link}>
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.substring(linkMatch[0].length);
      continue;
    }
    
    // Plain URL detection
    const urlMatch = remaining.match(/^(https?:\/\/[^\s]+)/);
    if (urlMatch) {
      elements.push(
        <a key={key++} href={urlMatch[1]} target="_blank" rel="noopener noreferrer" className={styles.link}>
          {urlMatch[1]}
        </a>
      );
      remaining = remaining.substring(urlMatch[0].length);
      continue;
    }
    
    // Regular text - find next special character
    const nextSpecial = remaining.search(/[\*_`\[]/);
    if (nextSpecial === -1) {
      elements.push(remaining);
      break;
    } else if (nextSpecial === 0) {
      // Special char but didn't match a pattern, treat as regular text
      elements.push(remaining[0]);
      remaining = remaining.substring(1);
    } else {
      elements.push(remaining.substring(0, nextSpecial));
      remaining = remaining.substring(nextSpecial);
    }
  }
  
  return elements.length === 1 ? elements[0] : elements;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const showTypingIndicator = message.isTyping && !message.content;

  return (
    <div className={`${styles.message} ${isUser ? styles.userMessage : styles.assistantMessage}`}>
      <div className={styles.messageHeader}>
        <span className={styles.messageRole}>
          {isUser ? 'You' : 'Ada'}
        </span>
      </div>
      <div className={styles.messageContent}>
        {showTypingIndicator ? (
          <div className={styles.typingIndicator}>
            <span></span>
            <span></span>
            <span></span>
          </div>
        ) : (
          <>
            {/* Current Status - Above Content */}
            {!isUser && message.isStreaming && message.currentStatus && !message.content && (
              <div className={styles.inlineStatus}>
                <div className={styles.statusDot}></div>
                <span>{message.currentStatus.message}</span>
              </div>
            )}
            
            {/* Search History - Clickable pills */}
            {!isUser && message.searchHistory && message.searchHistory.length > 0 && (
              <SearchStatus
                searchHistory={message.searchHistory}
                isStreaming={message.isStreaming || false}
              />
            )}
            
            {/* Message Content with Markdown */}
            <div className={styles.markdownContent}>
              {parseMarkdown(message.content)}
            </div>
            
            {/* Streaming Cursor */}
            {message.isStreaming && message.content && (
              <span className={styles.streamingCursor}>|</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
