'use client';

import { useState } from 'react';
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
  textPreview?: string;  // Text preview for ticker animation during search
}

// Table parsing types
interface ContentSegment {
  type: 'text' | 'table' | 'table-loading' | 'graph' | 'graph-loading' | 'image' | 'image-loading';
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
    // Clean up the content - remove leading/trailing whitespace and newlines
    let cleanContent = graphContent.trim();
    
    // Try to find JSON object boundaries if there's extra content
    const jsonStart = cleanContent.indexOf('{');
    const jsonEnd = cleanContent.lastIndexOf('}');
    
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      console.error('Graph parse error: No valid JSON object found in:', cleanContent.substring(0, 100));
      return null;
    }
    
    // Extract just the JSON portion
    cleanContent = cleanContent.substring(jsonStart, jsonEnd + 1);
    
    const parsed = JSON.parse(cleanContent);
    
    // Validate required fields
    if (!parsed.data || !Array.isArray(parsed.data)) {
      console.error('Graph parse error: Missing or invalid "data" array');
      return null;
    }
    if (!parsed.series || !Array.isArray(parsed.series)) {
      console.error('Graph parse error: Missing or invalid "series" array');
      return null;
    }
    if (!parsed.type) {
      console.error('Graph parse error: Missing "type" field');
      return null;
    }
    
    return parsed as GraphData;
  } catch (e) {
    console.error('Graph JSON parse error:', e, 'Content:', graphContent.substring(0, 200));
    return null;
  }
}

// Parse content for §TABLE§, §GRAPH§, and §IMG:url§ markers and return segments
function parseContentSegments(content: string, isStreaming: boolean): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const tableStartMarker = '§TABLE§';
  const tableEndMarker = '§/TABLE§';
  const graphStartMarker = '§GRAPH§';
  const graphEndMarker = '§/GRAPH§';
  const imageStartMarker = '§IMG:';
  const imageEndMarker = '§';
  
  let remaining = content;
  
  while (remaining.length > 0) {
    // Find the next marker (table, graph, or image)
    const tableStartIdx = remaining.indexOf(tableStartMarker);
    const graphStartIdx = remaining.indexOf(graphStartMarker);
    const imageStartIdx = remaining.indexOf(imageStartMarker);
    
    // Determine which marker comes first (or if none exist)
    let nextMarkerType: 'table' | 'graph' | 'image' | null = null;
    let nextMarkerIdx = -1;
    
    // Find the minimum positive index
    const indices = [
      { type: 'table' as const, idx: tableStartIdx },
      { type: 'graph' as const, idx: graphStartIdx },
      { type: 'image' as const, idx: imageStartIdx }
    ].filter(item => item.idx !== -1);
    
    if (indices.length === 0) {
      // No more markers, add remaining text
      if (remaining.trim()) {
        segments.push({ type: 'text', content: remaining });
      }
      break;
    }
    
    // Get the marker that appears first
    const firstMarker = indices.reduce((min, curr) => 
      curr.idx < min.idx ? curr : min
    );
    nextMarkerType = firstMarker.type;
    nextMarkerIdx = firstMarker.idx;
    
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
    } else if (nextMarkerType === 'image') {
      const afterStart = remaining.substring(nextMarkerIdx + imageStartMarker.length);
      // Find the closing § that ends the image URL
      const endIdx = afterStart.indexOf(imageEndMarker);
      
      if (endIdx === -1) {
        // Image marker is not complete yet
        if (isStreaming) {
          segments.push({ type: 'image-loading', content: afterStart });
        } else {
          segments.push({ type: 'text', content: remaining.substring(nextMarkerIdx) });
        }
        break;
      }
      
      // Complete image found - content is the URL
      const imageUrl = afterStart.substring(0, endIdx).trim();
      segments.push({ type: 'image', content: imageUrl });
      remaining = afterStart.substring(endIdx + imageEndMarker.length);
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
    return <div className={styles.tableError}>Unable to display table</div>;
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

// Image loading component with skeleton animation
function ImageLoading() {
  return (
    <div className={styles.imageLoading}>
      <div className={styles.imageLoadingIcon}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
      </div>
      <span className={styles.imageLoadingText}>Loading image</span>
      <span className={styles.imageLoadingDots}>
        <span>.</span><span>.</span><span>.</span>
      </span>
    </div>
  );
}

// Inline image component with loading and error states
function InlineImage({ src }: { src: string }) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleLoad = () => {
    setIsLoading(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  const handleClick = () => {
    if (!hasError) {
      setIsExpanded(!isExpanded);
    }
  };

  if (hasError) {
    return (
      <div className={styles.imageError}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
        </svg>
        <span>Image unavailable</span>
      </div>
    );
  }

  return (
    <>
      <div 
        className={`${styles.inlineImageContainer} ${isLoading ? styles.imageIsLoading : ''}`}
        onClick={handleClick}
      >
        {isLoading && (
          <div className={styles.imageSkeleton}>
            <div className={styles.imageSkeletonShimmer}></div>
          </div>
        )}
        <img
          src={src}
          alt="Referenced image from source"
          className={styles.inlineImage}
          onLoad={handleLoad}
          onError={handleError}
          style={{ opacity: isLoading ? 0 : 1 }}
        />
        {!isLoading && (
          <div className={styles.imageOverlay}>
            <span className={styles.imageExpandHint}>Click to {isExpanded ? 'collapse' : 'expand'}</span>
          </div>
        )}
      </div>
      
      {/* Expanded lightbox view */}
      {isExpanded && (
        <div className={styles.imageLightbox} onClick={() => setIsExpanded(false)}>
          <div className={styles.imageLightboxContent}>
            <img src={src} alt="Expanded view" className={styles.imageLightboxImage} />
            <button className={styles.imageLightboxClose} onClick={() => setIsExpanded(false)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Color palette for graph series
const GRAPH_COLORS = ['#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

// Graph component for rendering charts
function DataGraph({ graphContent }: { graphContent: string }) {
  const graphData = parseGraphData(graphContent);
  
  if (!graphData) {
    // Log the content for debugging
    console.error('Failed to parse graph. Raw content:', graphContent);
    return (
      <div className={styles.graphError}>
        Unable to display graph
      </div>
    );
  }
  
  if (graphData.data.length === 0) {
    return <div className={styles.graphError}>Unable to display graph</div>;
  }
  
  const { type, title, xAxis, yAxis, data, series } = graphData;
  
  const renderChart = () => {
    switch (type) {
      case 'line':
        return (
          <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: xAxis?.label ? 50 : 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis 
              dataKey="x" 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)', fontSize: 12}} 
              label={xAxis?.label ? {value: xAxis.label, position: 'insideBottom', fill: 'rgba(255,255,255,0.6)', dy: 35, fontSize: 12} : undefined} 
            />
            <YAxis 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)', fontSize: 12}} 
              label={yAxis?.label ? {value: yAxis.label, angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.6)', dx: -10, fontSize: 12} : undefined} 
            />
            <Tooltip 
              contentStyle={{
                background: 'rgba(0,0,0,0.9)', 
                border: '1px solid rgba(255,255,255,0.2)', 
                borderRadius: '8px',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '13px'
              }} 
            />
            <Legend 
              verticalAlign="top" 
              height={36}
              wrapperStyle={{color: 'rgba(255,255,255,0.8)', fontSize: '13px'}}
            />
            {series.map((s, idx) => (
              <Line 
                key={s.key} 
                type="monotone" 
                dataKey={s.key} 
                name={s.name} 
                stroke={GRAPH_COLORS[idx % GRAPH_COLORS.length]} 
                strokeWidth={2} 
                dot={{fill: GRAPH_COLORS[idx % GRAPH_COLORS.length], r: 4}} 
                activeDot={{r: 6}}
              />
            ))}
          </LineChart>
        );
      case 'bar':
        return (
          <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: xAxis?.label ? 50 : 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis 
              dataKey="x" 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)', fontSize: 12}} 
              label={xAxis?.label ? {value: xAxis.label, position: 'insideBottom', fill: 'rgba(255,255,255,0.6)', dy: 35, fontSize: 12} : undefined}
            />
            <YAxis 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)', fontSize: 12}} 
              label={yAxis?.label ? {value: yAxis.label, angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.6)', dx: -10, fontSize: 12} : undefined}
            />
            <Tooltip 
              contentStyle={{
                background: 'rgba(0,0,0,0.9)', 
                border: '1px solid rgba(255,255,255,0.2)', 
                borderRadius: '8px',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '13px'
              }} 
            />
            <Legend 
              verticalAlign="top" 
              height={36}
              wrapperStyle={{color: 'rgba(255,255,255,0.8)', fontSize: '13px'}}
            />
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
          <ScatterChart margin={{ top: 5, right: 30, left: 20, bottom: xAxis?.label ? 50 : 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis 
              type="number" 
              dataKey="x" 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)', fontSize: 12}} 
              name={xAxis?.label} 
              label={xAxis?.label ? {value: xAxis.label, position: 'insideBottom', fill: 'rgba(255,255,255,0.6)', dy: 35, fontSize: 12} : undefined}
            />
            <YAxis 
              type="number" 
              dataKey="y" 
              stroke="rgba(255,255,255,0.6)" 
              tick={{fill: 'rgba(255,255,255,0.8)', fontSize: 12}} 
              name={yAxis?.label} 
              label={yAxis?.label ? {value: yAxis.label, angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.6)', dx: -10, fontSize: 12} : undefined}
            />
            <Tooltip 
              contentStyle={{
                background: 'rgba(0,0,0,0.9)', 
                border: '1px solid rgba(255,255,255,0.2)', 
                borderRadius: '8px',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '13px'
              }} 
              cursor={{strokeDasharray: '3 3'}} 
            />
            <Legend 
              verticalAlign="top" 
              height={36}
              wrapperStyle={{color: 'rgba(255,255,255,0.8)', fontSize: '13px'}}
            />
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
        return <div className={styles.graphError}>Unable to display graph</div>;
    }
  };
  
  return (
    <div className={styles.graphContainer}>
      {title && <div className={styles.graphTitle}>{title}</div>}
      <ResponsiveContainer width="100%" height={350}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}

// Render content segments (text, tables, graphs, images, loading states)
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
          case 'image':
            return <InlineImage key={idx} src={segment.content} />;
          case 'image-loading':
            return <ImageLoading key={idx} />;
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

  return (
    <div className={`${styles.message} ${isUser ? styles.userMessage : styles.assistantMessage}`}>
      <div className={styles.messageHeader}>
        <span className={styles.messageRole}>
          {isUser ? 'You' : 'Delved'}
        </span>
      </div>
      
      {/* Show search status for assistant messages - skip button is handled inside SearchStatus */}
      {!isUser && message.searchHistory && message.searchHistory.length > 0 && (
        <SearchStatus 
          searchHistory={message.searchHistory} 
          status={message.currentStatus}
          isStreaming={message.isStreaming || false}
          canSkip={message.currentStatus?.canSkip}
          onSkipSearch={onSkipSearch}
          textPreview={message.textPreview}
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

