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
function parseTable(tableContent: string, keyStart: number): { element: React.ReactNode; key: number } {
  const lines = tableContent.trim().split('\n').filter(line => line.trim());
  
  if (lines.length < 1) {
    return { element: null, key: keyStart };
  }
  
  // First line is headers
  const headers = lines[0].split('|').map(h => h.trim()).filter(h => h);
  
  // Rest are data rows
  const rows = lines.slice(1).map(line => 
    line.split('|').map(cell => cell.trim()).filter(cell => cell)
  ).filter(row => row.length > 0);
  
  const table = (
    <div key={keyStart} className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th key={i} className={styles.tableHeader}>{parseInlineMarkdown(header)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className={rowIndex % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={styles.tableCell}>{parseInlineMarkdown(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  
  return { element: table, key: keyStart + 1 };
}

// Parse markdown and return formatted JSX
function parseMarkdown(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let key = 0;
  
  // First, extract and process tables
  const tableRegex = /\[TABLE\]([\s\S]*?)\[\/TABLE\]/gi;
  let lastIndex = 0;
  let match;
  const textParts: { type: 'text' | 'table'; content: string }[] = [];
  
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
    textParts.push({ type: 'text', content: text.slice(lastIndex) });
  }
  
  // If no tables found, process as regular text
  if (textParts.length === 0) {
    textParts.push({ type: 'text', content: text });
  }
  
  // Process each part
  for (const part of textParts) {
    if (part.type === 'table') {
      const result = parseTable(part.content, key);
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
