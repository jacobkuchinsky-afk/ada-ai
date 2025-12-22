'use client';

import styles from './Chat.module.css';
import SearchStatus, { SearchEntry, StatusInfo } from './SearchStatus';
import ReactMarkdown from 'react-markdown';
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

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
  type: 'text' | 'table' | 'table-loading' | 'graph' | 'graph-loading';
  content: string;
}

// Graph parsing types
interface GraphData {
  type: 'line' | 'bar' | 'scatter';
  title?: string;
  xAxis?: { label?: string; type?: 'category' | 'number' };
  yAxis?: { label?: string };
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; name: string }>;
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

// Parse JSON graph data into structured format
function parseGraphData(graphContent: string): GraphData | null {
  try {
    const parsed = JSON.parse(graphContent.trim());
    if (!parsed.data || !Array.isArray(parsed.data)) return null;
    if (!parsed.series || !Array.isArray(parsed.series)) return null;
    return parsed as GraphData;
  } catch {
    return null;
  }
}

// Parse content for §TABLE§ and §GRAPH§ markers and return segments
function parseContentSegments(content: string, isStreaming: boolean): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const tableStartMarker = '§TABLE§';
  const tableEndMarker = '§/TABLE§';
  const graphStartMarker = '§GRAPH§';
  const graphEndMarker = '§/GRAPH§';
  
  let remaining = content;
  
  while (remaining.length > 0) {
    // Find the next marker (table or graph)
    const tableStartIdx = remaining.indexOf(tableStartMarker);
    const graphStartIdx = remaining.indexOf(graphStartMarker);
    
    // Determine which marker comes first (or if none exist)
    let nextMarkerType: 'table' | 'graph' | null = null;
    let nextMarkerIdx = -1;
    
    if (tableStartIdx === -1 && graphStartIdx === -1) {
      // No more markers, add remaining text
      if (remaining.trim()) {
        segments.push({ type: 'text', content: remaining });
      }
      break;
    } else if (tableStartIdx === -1) {
      nextMarkerType = 'graph';
      nextMarkerIdx = graphStartIdx;
    } else if (graphStartIdx === -1) {
      nextMarkerType = 'table';
      nextMarkerIdx = tableStartIdx;
    } else {
      // Both exist, pick the one that comes first
      if (tableStartIdx < graphStartIdx) {
        nextMarkerType = 'table';
        nextMarkerIdx = tableStartIdx;
      } else {
        nextMarkerType = 'graph';
        nextMarkerIdx = graphStartIdx;
      }
    }
    
    // Add text before the marker
    if (nextMarkerIdx > 0) {
      const textBefore = remaining.substring(0, nextMarkerIdx);
      if (textBefore.trim()) {
        segments.push({ type: 'text', content: textBefore });
      }
    }
    
    // Process the marker based on type
    if (nextMarkerType === 'table') {
      const afterStart = remaining.substring(nextMarkerIdx + tableStartMarker.length);
      const endIdx = afterStart.indexOf(tableEndMarker);
      
      if (endIdx === -1) {
        // Table is not complete yet
        if (isStreaming) {
          segments.push({ type: 'table-loading', content: afterStart });
        } else {
          segments.push({ type: 'text', content: remaining.substring(nextMarkerIdx) });
        }
        break;
      }
      
      // Complete table found
      const tableContent = afterStart.substring(0, endIdx);
      segments.push({ type: 'table', content: tableContent });
      remaining = afterStart.substring(endIdx + tableEndMarker.length);
    } else if (nextMarkerType === 'graph') {
      const afterStart = remaining.substring(nextMarkerIdx + graphStartMarker.length);
      const endIdx = afterStart.indexOf(graphEndMarker);
      
      if (endIdx === -1) {
        // Graph is not complete yet
        if (isStreaming) {
          segments.push({ type: 'graph-loading', content: afterStart });
        } else {
          segments.push({ type: 'text', content: remaining.substring(nextMarkerIdx) });
        }
        break;
      }
      
      // Complete graph found
      const graphContent = afterStart.substring(0, endIdx);
      segments.push({ type: 'graph', content: graphContent });
      remaining = afterStart.substring(endIdx + graphEndMarker.length);
    }
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

// Graph loading component with dot animation
function GraphLoading() {
  return (
    <div className={styles.graphLoading}>
      <div className={styles.graphLoadingIcon}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3v18h18" />
          <path d="M18 9l-5 5-4-4-3 3" />
        </svg>
      </div>
      <span className={styles.graphLoadingText}>Creating graph</span>
      <span className={styles.graphLoadingDots}>
        <span>.</span><span>.</span><span>.</span>
      </span>
    </div>
  );
}

// Color palette for graph series
const GRAPH_COLORS = ['#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

// Graph component for rendering charts
function DataGraph({ graphContent }: { graphContent: string }) {
  const graphData = parseGraphData(graphContent);
  
  if (!graphData || graphData.data.length === 0) {
    return <div className={styles.graphError}>Unable to parse graph data</div>;
  }
  
  const { type, title, xAxis, yAxis, data, series } = graphData;
  
  const renderChart = () => {
    switch (type) {
      case 'line':
        return (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis 
              dataKey="x" 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)'}} 
              label={xAxis?.label ? {value: xAxis.label, position: 'bottom', fill: 'rgba(255,255,255,0.6)', dy: 10} : undefined} 
            />
            <YAxis 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)'}} 
              label={yAxis?.label ? {value: yAxis.label, angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.6)'} : undefined} 
            />
            <Tooltip 
              contentStyle={{
                background: 'rgba(0,0,0,0.8)', 
                border: '1px solid rgba(255,255,255,0.2)', 
                borderRadius: '8px',
                color: 'rgba(255,255,255,0.9)'
              }} 
            />
            <Legend />
            {series.map((s, idx) => (
              <Line 
                key={s.key} 
                type="monotone" 
                dataKey={s.key} 
                name={s.name} 
                stroke={GRAPH_COLORS[idx % GRAPH_COLORS.length]} 
                strokeWidth={2} 
                dot={{fill: GRAPH_COLORS[idx % GRAPH_COLORS.length]}} 
              />
            ))}
          </LineChart>
        );
      case 'bar':
        return (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis 
              dataKey="x" 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)'}} 
            />
            <YAxis 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)'}} 
            />
            <Tooltip 
              contentStyle={{
                background: 'rgba(0,0,0,0.8)', 
                border: '1px solid rgba(255,255,255,0.2)', 
                borderRadius: '8px',
                color: 'rgba(255,255,255,0.9)'
              }} 
            />
            <Legend />
            {series.map((s, idx) => (
              <Bar 
                key={s.key} 
                dataKey={s.key} 
                name={s.name} 
                fill={GRAPH_COLORS[idx % GRAPH_COLORS.length]} 
                radius={[4, 4, 0, 0]} 
              />
            ))}
          </BarChart>
        );
      case 'scatter':
        return (
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis 
              type="number" 
              dataKey="x" 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)'}} 
              name={xAxis?.label} 
              label={xAxis?.label ? {value: xAxis.label, position: 'bottom', fill: 'rgba(255,255,255,0.6)', dy: 10} : undefined}
            />
            <YAxis 
              type="number" 
              dataKey="y" 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)'}} 
              name={yAxis?.label} 
              label={yAxis?.label ? {value: yAxis.label, angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.6)'} : undefined}
            />
            <Tooltip 
              contentStyle={{
                background: 'rgba(0,0,0,0.8)', 
                border: '1px solid rgba(255,255,255,0.2)', 
                borderRadius: '8px',
                color: 'rgba(255,255,255,0.9)'
              }} 
              cursor={{strokeDasharray: '3 3'}} 
            />
            <Legend />
            {series.map((s, idx) => (
              <Scatter 
                key={s.key} 
                name={s.name} 
                data={data} 
                fill={GRAPH_COLORS[idx % GRAPH_COLORS.length]} 
              />
            ))}
          </ScatterChart>
        );
      default:
        return <div className={styles.graphError}>Unknown graph type: {type}</div>;
    }
  };
  
  return (
    <div className={styles.graphContainer}>
      {title && <div className={styles.graphTitle}>{title}</div>}
      <ResponsiveContainer width="100%" height={300}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}

// Render content segments (text, tables, graphs, loading states)
function RenderContent({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const segments = parseContentSegments(content, isStreaming);
  
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
          case 'graph':
            return <DataGraph key={idx} graphContent={segment.content} />;
          case 'graph-loading':
            return <GraphLoading key={idx} />;
          default:
            return null;
        }
      })}
    </>
  );
}

interface ChatMessageProps {
  message: Message;
  onSkipSearch?: () => void;  // Callback to skip searching and go to generation
}

export default function ChatMessage({ message, onSkipSearch }: ChatMessageProps) {
  const isUser = message.role === 'user';
  
  // Check if skip search button should be shown (during evaluation phase)
  const showSkipButton = !isUser && 
    message.currentStatus?.canSkip && 
    message.isStreaming && 
    !message.content;

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
          canSkip={message.currentStatus?.canSkip}
          onSkipSearch={onSkipSearch}
        />
      )}
      
      {/* Show current status while processing (before content arrives) */}
      {!isUser && message.currentStatus && !message.content && (
        <div className={styles.statusIndicator}>
          <span className={styles.statusDot}></span>
          <span className={styles.statusText}>{message.currentStatus.message}</span>
          {/* Skip Search Button - appears during evaluation */}
          {showSkipButton && onSkipSearch && (
            <button 
              className={styles.skipSearchButton}
              onClick={onSkipSearch}
              type="button"
            >
              <span className={styles.skipSearchIcon}>⏭</span>
              Skip & Generate
            </button>
          )}
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

