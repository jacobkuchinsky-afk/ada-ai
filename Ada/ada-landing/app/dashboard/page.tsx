'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useCreditsContext } from '@/context/CreditsContext';
import Sidebar from '@/components/Sidebar/Sidebar';
import ChatInterface from '@/components/Chat/ChatInterface';
import OutOfCreditsModal from '@/components/OutOfCreditsModal/OutOfCreditsModal';
import { Message } from '@/components/Chat/ChatMessage';
import { SearchEntry, StatusInfo } from '@/components/Chat/SearchStatus';
import {
  createChat,
  updateChat,
  getChats,
  getChat,
  deleteChat,
  ChatPreview,
} from '@/lib/chatService';
import styles from './dashboard.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export default function DashboardPage() {
  const { user, loading, authFetch, checkWaitlistStatus } = useAuth();
  const { credits, refreshCredits } = useCreditsContext();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);  // Track current session ID for skip search

  // Chat persistence state
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [pendingSave, setPendingSave] = useState(false);

  // Track streaming state for chat switching - stores complete streaming data
  const streamingChatRef = useRef<{
    chatId: string | null;
    visibleChatId: string | null;  // Which chat the user is currently viewing
    messages: Message[];
    assistantMessageId: string | null;
    accumulatedContent: string;
    searchHistory: SearchEntry[];
  }>({ 
    chatId: null, 
    visibleChatId: null,
    messages: [], 
    assistantMessageId: null,
    accumulatedContent: '',
    searchHistory: []
  });

  // Out of credits modal state
  const [showOutOfCreditsModal, setShowOutOfCreditsModal] = useState(false);

  // Save error state for user feedback
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fast mode state - persists throughout the chat session
  const [fastMode, setFastMode] = useState(false);
  const toggleFastMode = useCallback(() => {
    setFastMode(prev => !prev);
  }, []);

  // Check authentication and waitlist status
  useEffect(() => {
    const checkAccess = async () => {
      if (loading) return;
      
      if (!user) {
        router.push('/signup');
        return;
      }
      
      if (!user.emailVerified) {
        router.push('/verify-email');
        return;
      }
      
      // Check if user is on waitlist (uses authenticated endpoint)
      try {
        const status = await checkWaitlistStatus();
        if (status.onWaitlist) {
          router.push('/waitlist');
        }
      } catch (error) {
        // On error, allow access (fail open)
        console.error('Error checking waitlist status:', error);
      }
    };
    
    checkAccess();
  }, [user, loading, router, checkWaitlistStatus]);

  // Load chats on mount (sidebar only - don't auto-load last chat)
  useEffect(() => {
    async function loadChats() {
      if (!user) return;

      try {
        setIsLoadingChats(true);
        const userChats = await getChats(user.uid);
        setChats(userChats);
        // Don't auto-load most recent chat - show empty state with prompt input instead
      } catch (error) {
        console.error('Error loading chats:', error);
      } finally {
        setIsLoadingChats(false);
      }
    }

    if (user?.emailVerified) {
      loadChats();
    }
  }, [user]);

  // Save messages when they change and response is complete
  useEffect(() => {
    async function saveMessages() {
      if (!user || !currentChatId || messages.length === 0) return;

      // Only save when not actively streaming
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.isStreaming) return;

      try {
        await updateChat(user.uid, currentChatId, messages);
        setPendingSave(false);
      } catch (error) {
        console.error('Error saving chat:', error);
      }
    }

    if (pendingSave) {
      saveMessages();
    }
  }, [messages, currentChatId, user, pendingSave]);

  // Get conversation memory for context
  const getMemory = useCallback(() => {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }, [messages]);

  // Get previous search data and user question for summarization
  const getPreviousSearchContext = useCallback(() => {
    // Find the last assistant message with rawSearchData
    let previousSearchData: string | null = null;
    let previousUserQuestion: string | null = null;

    // Iterate backwards through messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.rawSearchData && !previousSearchData) {
        previousSearchData = msg.rawSearchData;
        // Find the user question that came before this assistant message
        for (let j = i - 1; j >= 0; j--) {
          if (messages[j].role === 'user') {
            previousUserQuestion = messages[j].content;
            break;
          }
        }
        break;
      }
    }

    return { previousSearchData, previousUserQuestion };
  }, [messages]);

  const handleNewChat = useCallback(() => {
    // Abort any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setCurrentChatId(null);
    setStatusMessage('');
    setIsLoading(false);
    sessionIdRef.current = null;  // Clear session ID
  }, []);

  const handleSelectChat = useCallback(
    async (chatId: string) => {
      console.log('[SWITCH DEBUG] handleSelectChat called:', { 
        targetChatId: chatId, 
        currentChatId, 
        isLoading,
        streamingChatId: streamingChatRef.current.chatId,
        streamingVisibleChatId: streamingChatRef.current.visibleChatId,
        streamingMessagesCount: streamingChatRef.current.messages.length
      });
      
      if (!user || chatId === currentChatId) {
        console.log('[SWITCH DEBUG] Early return - no user or same chat');
        return;
      }

      // FIRST: Check if we're switching TO the streaming chat - restore from ref immediately
      // The ref is always the source of truth for the streaming chat's messages
      if (streamingChatRef.current.chatId === chatId) {
        console.log('[SWITCH DEBUG] Switching TO streaming chat - restoring from ref');
        console.log('[SWITCH DEBUG] Ref messages to restore:', streamingChatRef.current.messages.length);
        setCurrentChatId(chatId);
        setMessages(streamingChatRef.current.messages);
        streamingChatRef.current.visibleChatId = chatId;  // Now viewing the streaming chat
        return;
      }

      // If there's active streaming, just update which chat we're viewing
      // DO NOT overwrite ref.messages - the streaming loop keeps it updated
      if (streamingChatRef.current.chatId !== null) {
        console.log('[SWITCH DEBUG] Streaming active, updating visibleChatId to:', chatId);
        streamingChatRef.current.visibleChatId = chatId;
      }

      // Load the non-streaming chat from Firebase
      console.log('[SWITCH DEBUG] Loading chat from Firebase:', chatId);
      try {
        const fullChat = await getChat(user.uid, chatId);
        if (fullChat) {
          setCurrentChatId(fullChat.id);
          setMessages(fullChat.messages);
          setStatusMessage('');
          // ONLY set isLoading false if NO streaming is active anywhere
          if (streamingChatRef.current.chatId === null) {
            setIsLoading(false);
          }
        }
      } catch (error) {
        console.error('Error loading chat:', error);
      }
    },
    [user, currentChatId, isLoading]
  );

  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      if (!user) return;

      try {
        await deleteChat(user.uid, chatId);

        // Update local state
        setChats((prev) => prev.filter((c) => c.id !== chatId));

        // If we deleted the current chat, reset
        if (currentChatId === chatId) {
          setCurrentChatId(null);
          setMessages([]);
        }
      } catch (error) {
        console.error('Error deleting chat:', error);
      }
    },
    [user, currentChatId]
  );

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!user) return;

      // Credits are now checked server-side, but we still check client-side for UX
      if (credits < 2) {
        setShowOutOfCreditsModal(true);
        return;
      }

      // Abort any previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller for this request
      abortControllerRef.current = new AbortController();

      // If no current chat, create one
      let chatId = currentChatId;
      if (!chatId) {
        try {
          chatId = await createChat(user.uid, content);
          setCurrentChatId(chatId);

          // Add to local chats list
          const newChatPreview: ChatPreview = {
            id: chatId,
            title: content.length > 60 ? content.substring(0, 57) + '...' : content,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          setChats((prev) => [newChatPreview, ...prev]);
        } catch (createErr) {
          console.error('Error creating chat:', createErr);
          setSaveError('Unable to save chat. Please try again.');
          return;
        }
      }

      // Add user message
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content,
      };
      
      // Add placeholder for assistant message
      const assistantMessageId = (Date.now() + 1).toString();
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        searchHistory: [],
        currentStatus: null,
      };
      
      // Initialize streaming ref with all data needed for saving
      const initialMessages = [...messages, userMessage, assistantMessage];
      streamingChatRef.current = { 
        chatId: chatId, 
        visibleChatId: chatId,  // Start viewing this chat
        messages: initialMessages,
        assistantMessageId: assistantMessageId,
        accumulatedContent: '',
        searchHistory: []
      };
      
      setMessages(initialMessages);
      setIsLoading(true);
      setStatusMessage(fastMode ? 'Processing (fast mode)...' : 'Connecting...');

      try {
        // Get previous search context for summarization
        const { previousSearchData, previousUserQuestion } = getPreviousSearchContext();

        // Get auth token for authenticated request
        const token = await user.getIdToken();
        
        const response = await fetch(`${API_URL}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'bypass-tunnel-reminder': 'true', // Bypass localtunnel CAPTCHA
            'ngrok-skip-browser-warning': 'true', // Bypass ngrok interstitial page
          },
          body: JSON.stringify({
            message: content,
            memory: getMemory(),
            previousSearchData,
            previousUserQuestion,
            fastMode,  // Send fast mode flag to backend
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          // Handle insufficient credits (402 Payment Required)
          if (response.status === 402) {
            setShowOutOfCreditsModal(true);
            setIsLoading(false);
            setStatusMessage('');
            return;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let accumulatedContent = '';
        let currentSearchHistory: SearchEntry[] = [];

        let receivedDone = false;
        let chunkCount = 0;

        console.log('[STREAM DEBUG] Starting streaming loop for chat:', chatId);
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('[STREAM DEBUG] Stream reader done - exiting loop. Total chunks:', chunkCount);
            break;
          }
          chunkCount++;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

              for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === 'session') {
                  // Store session ID for skip search functionality
                  sessionIdRef.current = data.sessionId;
                } else if (data.type === 'status') {
                  // Update status with step, icon, and canSkip flag
                  const statusInfo: StatusInfo = {
                    message: data.message,
                    step: data.step,
                    icon: data.icon,
                    canSkip: data.canSkip || false,  // Include skip availability
                  };
                  setStatusMessage(data.message);
                  
                  // Update ref messages
                  streamingChatRef.current.messages = streamingChatRef.current.messages.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, currentStatus: statusInfo }
                      : m
                  );
                  
                  // Only update React state if still viewing this chat
                  if (streamingChatRef.current.visibleChatId === chatId) {
                    setMessages(streamingChatRef.current.messages);
                  }
                } else if (data.type === 'text_preview') {
                  // Handle text preview event - sent as soon as first source is scraped
                  console.log('[TEXT_PREVIEW] Received:', data.text?.substring(0, 50));
                  
                  // Update ref messages with text preview
                  streamingChatRef.current.messages = streamingChatRef.current.messages.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, textPreview: data.text }
                      : m
                  );
                  
                  // Only update React state if still viewing this chat
                  if (streamingChatRef.current.visibleChatId === chatId) {
                    setMessages(streamingChatRef.current.messages);
                  }
                } else if (data.type === 'search') {
                  // Handle search event
                  console.log('[SEARCH DEBUG] Received search event:', {
                    query: data.query?.substring(0, 30),
                    status: data.status,
                    hasTextPreview: !!data.textPreview,
                    textPreviewLength: data.textPreview?.length || 0,
                  });
                  const searchEntry: SearchEntry = {
                    query: data.query,
                    sources: data.sources || [],
                    iteration: data.iteration,
                    queryIndex: data.queryIndex,  // Include queryIndex for parallel queries
                    status: data.status,
                    textPreview: data.textPreview,  // Text preview for visual parsing feedback
                  };

                  // Update or add search entry - use both iteration AND queryIndex for uniqueness
                  const existingIndex = currentSearchHistory.findIndex(
                    (s) => s.iteration === data.iteration && s.queryIndex === data.queryIndex
                  );

                  if (existingIndex >= 0) {
                    // Update existing search with sources (preserve textPreview if new one doesn't have it)
                    currentSearchHistory[existingIndex] = {
                      ...searchEntry,
                      textPreview: searchEntry.textPreview || currentSearchHistory[existingIndex].textPreview,
                    };
                  } else {
                    // Add new search
                    currentSearchHistory = [...currentSearchHistory, searchEntry];
                  }
                  
                  // Update ref
                  streamingChatRef.current.searchHistory = [...currentSearchHistory];
                  streamingChatRef.current.messages = streamingChatRef.current.messages.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, searchHistory: [...currentSearchHistory] }
                      : m
                  );

                  // Only update React state if still viewing this chat
                  if (streamingChatRef.current.visibleChatId === chatId) {
                    setMessages(streamingChatRef.current.messages);
                  }
                } else if (data.type === 'content') {
                  // Streaming content
                  accumulatedContent += data.data;
                  
                  // Update ref
                  streamingChatRef.current.accumulatedContent = accumulatedContent;
                  streamingChatRef.current.messages = streamingChatRef.current.messages.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, content: accumulatedContent, currentStatus: null }
                      : m
                  );
                  
                  // Only update React state if still viewing this chat
                  const shouldUpdate = streamingChatRef.current.visibleChatId === chatId;
                  console.log('[STREAM DEBUG] Content chunk received:', { 
                    visibleChatId: streamingChatRef.current.visibleChatId, 
                    streamingChatId: chatId,
                    shouldUpdateUI: shouldUpdate,
                    contentLength: accumulatedContent.length 
                  });
                  if (shouldUpdate) {
                    setMessages(streamingChatRef.current.messages);
                  }
                } else if (data.type === 'done') {
                  receivedDone = true;
                  setStatusMessage('');
                  
                  // Build final search history
                  const finalSearchHistory = (data.searchHistory || currentSearchHistory).map(
                    (entry: SearchEntry) => ({ ...entry, status: 'complete' as const })
                  );
                  const rawSearchData = data.rawSearchData || '';
                  
                  // Build final messages from the REF (not state!) to ensure correct data
                  const finalMessages = streamingChatRef.current.messages.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          isStreaming: false,
                          currentStatus: null,
                          searchHistory: finalSearchHistory,
                          rawSearchData,  // Store for summarization on next message
                        }
                      : m
                  );
                  
                  // Update React state if still viewing this chat
                  if (streamingChatRef.current.visibleChatId === chatId) {
                    setMessages(finalMessages);
                  }

                  // Update chat's updatedAt in local list
                  setChats((prev) =>
                    prev.map((c) =>
                      c.id === chatId ? { ...c, updatedAt: new Date() } : c
                    )
                  );

                  // Save directly with correct chatId and messages from ref
                  if (chatId && user) {
                    console.log('[SAVE DEBUG] Attempting to save chat:', { chatId, userId: user.uid, messageCount: finalMessages.length });
                    try {
                      await updateChat(user.uid, chatId, finalMessages);
                      console.log('[SAVE DEBUG] Chat saved successfully');
                      setSaveError(null); // Clear any previous error on success
                    } catch (saveErr) {
                      console.error('[SAVE DEBUG] Save failed with error:', saveErr);
                      setSaveError('Unable to save chat. Please try again.');
                    }
                  } else {
                    console.warn('[SAVE DEBUG] Cannot save - missing chatId or user:', { chatId, hasUser: !!user });
                  }
                  
                  // Clear streaming ref - streaming is complete
                  streamingChatRef.current = { 
                    chatId: null, 
                    visibleChatId: null,
                    messages: [], 
                    assistantMessageId: null,
                    accumulatedContent: '',
                    searchHistory: []
                  };
                  
                  // Clear session ID
                  sessionIdRef.current = null;

                  // Refresh credits from server (deduction happens server-side)
                  try {
                    await refreshCredits();
                  } catch (creditError) {
                    console.warn('Credit refresh failed:', creditError);
                  }
                } else if (data.type === 'error') {
                  throw new Error(data.message);
                }
              } catch (parseError) {
                // Skip invalid JSON lines
                if (line.slice(6).trim()) {
                  console.warn('Failed to parse SSE data:', line);
                }
              }
            }
          }
        }

        // Handle stream ending without 'done' event (connection drop, server error, etc.)
        if (!receivedDone) {
          console.warn('Stream ended without done event - forcing finalization');
          setStatusMessage('');
          
          // Normalize search history entries to have status: 'complete'
          const finalSearchHistory = currentSearchHistory.map(
            (entry) => ({ ...entry, status: 'complete' as const })
          );
          
          // Build final messages from the REF (not state!)
          const finalMessages = streamingChatRef.current.messages.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  isStreaming: false,
                  currentStatus: null,
                  searchHistory: finalSearchHistory,
                  // If we have no content but have search, add a note
                  content: accumulatedContent || (currentSearchHistory.length > 0 
                    ? 'Response was interrupted during generation.'
                    : m.content),
                }
              : m
          );
          
          // Update React state if still viewing this chat
          if (streamingChatRef.current.visibleChatId === chatId) {
            setMessages(finalMessages);
          }
          
          // Update chat's updatedAt
          setChats((prev) =>
            prev.map((c) =>
              c.id === chatId ? { ...c, updatedAt: new Date() } : c
            )
          );
          
          // Save directly with correct data from ref
          if (chatId && user) {
            try {
              await updateChat(user.uid, chatId, finalMessages);
            setSaveError(null); // Clear any previous error on success
          } catch (saveErr) {
            console.error('Error saving chat:', saveErr);
            setSaveError('Unable to save chat. Please try again.');
          }
        }
        
        // Clear streaming ref
        streamingChatRef.current = {
            chatId: null, 
            visibleChatId: null,
            messages: [], 
            assistantMessageId: null,
            accumulatedContent: '',
            searchHistory: []
          };
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          // Request was cancelled, don't show error
          return;
        }

        console.error('Chat error:', error);
        setStatusMessage('');

        // Build final messages from the REF (not state!)
        const finalMessages = streamingChatRef.current.messages.map((m) =>
          m.id === assistantMessageId
            ? {
                ...m,
                content: `Something went wrong internally. Please try again in a bit.`,
                isStreaming: false,
                currentStatus: null,
              }
            : m
        );
        
        // Update React state if still viewing this chat
        if (streamingChatRef.current.visibleChatId === chatId) {
          setMessages(finalMessages);
        }
        
        // Save directly with correct data from ref
        if (chatId && user) {
          try {
            await updateChat(user.uid, chatId, finalMessages);
          setSaveError(null); // Clear any previous error on success
        } catch (saveErr) {
          console.error('Error saving chat:', saveErr);
          setSaveError('Unable to save chat. Please try again.');
        }
      }
      
      // Clear streaming ref on error
        streamingChatRef.current = { 
          chatId: null, 
          visibleChatId: null,
          messages: [], 
          assistantMessageId: null,
          accumulatedContent: '',
          searchHistory: []
        };
      } finally {
        setIsLoading(false);
      }
    },
    [messages, getMemory, getPreviousSearchContext, currentChatId, user, credits, refreshCredits, fastMode]
  );

  // Handle skip search - tells the backend to stop searching and generate response
  const handleSkipSearch = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      console.warn('No session ID available for skip search');
      return;
    }

    try {
      const response = await authFetch(`${API_URL}/api/skip-search`, {
        method: 'POST',
        headers: {
          'bypass-tunnel-reminder': 'true', // Bypass localtunnel CAPTCHA
          'ngrok-skip-browser-warning': 'true', // Bypass ngrok interstitial page
        },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        console.error('Failed to skip search:', response.status);
      }
    } catch (error) {
      console.error('Error skipping search:', error);
    }
  }, [authFetch]);

  if (loading) {
    return (
      <main className={styles.main}>
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
        </div>
      </main>
    );
  }

  if (!user || !user.emailVerified) {
    return null;
  }

  return (
    <main className={styles.main}>
      <Sidebar
        onNewChat={handleNewChat}
        chats={chats}
        currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        isLoadingChats={isLoadingChats}
        streamingChatId={isLoading ? (streamingChatRef.current.chatId || currentChatId) : null}
      />
      <ChatInterface
        messages={messages}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        statusMessage={statusMessage}
        onSkipSearch={handleSkipSearch}
        fastMode={fastMode}
        onToggleFastMode={toggleFastMode}
      />
      <OutOfCreditsModal
        isOpen={showOutOfCreditsModal}
        onClose={() => setShowOutOfCreditsModal(false)}
      />
      {/* Save error toast */}
      {saveError && (
        <div className={styles.saveErrorToast}>
          <span>{saveError}</span>
          <button 
            onClick={() => setSaveError(null)} 
            className={styles.saveErrorClose}
            aria-label="Dismiss error"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M5 7 L7 5 L12 10 L17 5 L19 7 L14 12 L19 17 L17 19 L12 14 L7 19 L5 17 L10 12 Z"/>
            </svg>
          </button>
        </div>
      )}
    </main>
  );
}
