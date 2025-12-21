'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
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
  const { user, loading } = useAuth();
  const { credits, useCredits, refreshCredits } = useCreditsContext();
  const router = useRouter();
  
  // Messages stored per chat - allows background streaming to continue
  const [chatMessagesMap, setChatMessagesMap] = useState<Record<string, Message[]>>({});
  
  // Track which chats have active streams (for visual indicator)
  const [generatingChats, setGeneratingChats] = useState<Set<string>>(new Set());
  
  // Store abort controllers per chat
  const activeStreamsRef = useRef<Map<string, AbortController>>(new Map());
  
  // Track component mount state to prevent state updates after unmount
  const mountedRef = useRef<boolean>(true);

  // Chat persistence state
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [pendingSaveChats, setPendingSaveChats] = useState<Set<string>>(new Set());

  // Out of credits modal state
  const [showOutOfCreditsModal, setShowOutOfCreditsModal] = useState(false);
  
  // Derived state - get messages for current chat
  const messages = useMemo(() => {
    if (!currentChatId) return [];
    return chatMessagesMap[currentChatId] || [];
  }, [currentChatId, chatMessagesMap]);
  
  // Derived state - check if current chat is generating
  const isLoading = useMemo(() => {
    if (!currentChatId) return false;
    return generatingChats.has(currentChatId);
  }, [currentChatId, generatingChats]);

  // Cleanup on unmount - abort ALL pending requests
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Abort all active streams on unmount
      activeStreamsRef.current.forEach((controller) => {
        controller.abort();
      });
      activeStreamsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/signup');
      } else if (!user.emailVerified) {
        router.push('/verify-email');
      }
    }
  }, [user, loading, router]);

  // Load chats on mount
  useEffect(() => {
    async function loadChats() {
      if (!user) return;

      try {
        setIsLoadingChats(true);
        const userChats = await getChats(user.uid);
        setChats(userChats);

        // Load most recent chat if exists
        if (userChats.length > 0) {
          const mostRecent = userChats[0];
          const fullChat = await getChat(user.uid, mostRecent.id);
          if (fullChat) {
            setCurrentChatId(fullChat.id);
            setChatMessagesMap(prev => ({
              ...prev,
              [fullChat.id]: fullChat.messages
            }));
          }
        }
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
      if (!user || pendingSaveChats.size === 0) return;

      const chatsToSave = Array.from(pendingSaveChats);
      
      for (const chatId of chatsToSave) {
        const chatMessages = chatMessagesMap[chatId];
        if (!chatMessages || chatMessages.length === 0) continue;
        
        // Only save when not actively streaming
        const lastMessage = chatMessages[chatMessages.length - 1];
        if (lastMessage?.isStreaming) continue;

        try {
          await updateChat(user.uid, chatId, chatMessages);
          setPendingSaveChats(prev => {
            const next = new Set(prev);
            next.delete(chatId);
            return next;
          });
        } catch (error) {
          console.error('Error saving chat:', error);
        }
      }
    }

    if (pendingSaveChats.size > 0) {
      saveMessages();
    }
  }, [chatMessagesMap, user, pendingSaveChats]);

  // Get conversation memory for context (for a specific chat)
  const getMemoryForChat = useCallback((chatId: string) => {
    const chatMessages = chatMessagesMap[chatId] || [];
    return chatMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }, [chatMessagesMap]);

  const handleNewChat = useCallback(() => {
    // Don't abort any ongoing requests - let them continue in background
    // Just switch to a new empty chat view
    setCurrentChatId(null);
  }, []);

  const handleSelectChat = useCallback(
    async (chatId: string) => {
      if (!user || chatId === currentChatId) return;

      // Don't abort the stream - just switch view
      // The stream continues in background and updates chatMessagesMap

      // If we already have this chat's messages (including in-progress ones), just switch
      if (chatMessagesMap[chatId]) {
        setCurrentChatId(chatId);
        return;
      }

      // Otherwise load from Firestore
      try {
        const fullChat = await getChat(user.uid, chatId);
        if (fullChat) {
          setCurrentChatId(fullChat.id);
          setChatMessagesMap(prev => ({
            ...prev,
            [fullChat.id]: fullChat.messages
          }));
        }
      } catch (error) {
        console.error('Error loading chat:', error);
      }
    },
    [user, currentChatId, chatMessagesMap]
  );

  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      if (!user) return;

      try {
        // Abort any active stream for this chat
        const controller = activeStreamsRef.current.get(chatId);
        if (controller) {
          controller.abort();
          activeStreamsRef.current.delete(chatId);
          setGeneratingChats(prev => {
            const next = new Set(prev);
            next.delete(chatId);
            return next;
          });
        }

        await deleteChat(user.uid, chatId);

        // Update local state
        setChats((prev) => prev.filter((c) => c.id !== chatId));
        
        // Remove from messages map
        setChatMessagesMap(prev => {
          const next = { ...prev };
          delete next[chatId];
          return next;
        });

        // If we deleted the current chat, reset
        if (currentChatId === chatId) {
          setCurrentChatId(null);
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

      // Check if user has enough credits (2: 1 for prompt, 1 for reply)
      if (credits < 2) {
        setShowOutOfCreditsModal(true);
        return;
      }

      // Deduct 1 credit for prompt
      const promptCreditUsed = await useCredits(1);
      if (!promptCreditUsed) {
        setShowOutOfCreditsModal(true);
        return;
      }

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
        } catch (error) {
          console.error('Error creating chat:', error);
          return;
        }
      }

      // Abort any existing stream for THIS chat only
      const existingController = activeStreamsRef.current.get(chatId);
      if (existingController) {
        existingController.abort();
        activeStreamsRef.current.delete(chatId);
      }

      // Create new abort controller for this chat's request
      const currentController = new AbortController();
      activeStreamsRef.current.set(chatId, currentController);
      
      // Mark this chat as generating
      setGeneratingChats(prev => new Set(prev).add(chatId!));

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
        currentStatus: { message: 'Connecting...', step: 0, icon: 'thinking' },
      };
      
      // Update messages for this specific chat
      setChatMessagesMap(prev => ({
        ...prev,
        [chatId!]: [...(prev[chatId!] || []), userMessage, assistantMessage]
      }));

      // Helper to update a specific message in a specific chat
      const updateChatMessage = (targetChatId: string, messageId: string, updates: Partial<Message>) => {
        setChatMessagesMap(prev => ({
          ...prev,
          [targetChatId]: (prev[targetChatId] || []).map(m =>
            m.id === messageId ? { ...m, ...updates } : m
          )
        }));
      };

      try {
        const response = await fetch(`${API_URL}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: content,
            memory: getMemoryForChat(chatId!),
          }),
          signal: currentController.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let accumulatedContent = '';
        let currentSearchHistory: SearchEntry[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          // Check if component is still mounted before processing
          if (!mountedRef.current) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                // Skip state updates if unmounted
                if (!mountedRef.current) continue;

                if (data.type === 'status') {
                  // Update status with step and icon
                  const statusInfo: StatusInfo = {
                    message: data.message,
                    step: data.step,
                    icon: data.icon,
                  };
                  updateChatMessage(chatId!, assistantMessageId, { currentStatus: statusInfo });
                } else if (data.type === 'search') {
                  // Handle search event
                  const searchEntry: SearchEntry = {
                    query: data.query,
                    sources: data.sources || [],
                    iteration: data.iteration,
                    queryIndex: data.queryIndex,
                    status: data.status,
                  };

                  // Update or add search entry - match by both iteration AND queryIndex for parallel queries
                  const existingIndex = currentSearchHistory.findIndex(
                    (s) => s.iteration === data.iteration && s.queryIndex === data.queryIndex
                  );

                  if (existingIndex >= 0) {
                    currentSearchHistory[existingIndex] = searchEntry;
                  } else {
                    currentSearchHistory = [...currentSearchHistory, searchEntry];
                  }

                  updateChatMessage(chatId!, assistantMessageId, { searchHistory: [...currentSearchHistory] });
                } else if (data.type === 'content') {
                  // Streaming content
                  accumulatedContent += data.data;
                  updateChatMessage(chatId!, assistantMessageId, { 
                    content: accumulatedContent, 
                    currentStatus: null 
                  });
                } else if (data.type === 'done') {
                  // Complete - deduct 1 credit for response
                  await useCredits(1);
                  await refreshCredits();

                  // Store final search history
                  const finalSearchHistory = data.searchHistory || currentSearchHistory;
                  updateChatMessage(chatId!, assistantMessageId, {
                    isStreaming: false,
                    currentStatus: null,
                    searchHistory: finalSearchHistory,
                  });
                  
                  // Trigger save for this chat
                  setPendingSaveChats(prev => new Set(prev).add(chatId!));

                  // Update chat's updatedAt in local list
                  setChats((prev) =>
                    prev.map((c) =>
                      c.id === chatId ? { ...c, updatedAt: new Date() } : c
                    )
                  );
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
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          // Request was cancelled, don't show error
          return;
        }

        console.error('Chat error:', error);
        
        // Only update state if still mounted
        if (!mountedRef.current) return;

        // Update the assistant message with error
        const errorMessage = (error as Error).message;
        const isConnectionError = errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('Failed');
        
        const friendlyMessage = isConnectionError
          ? `**Server is waking up!** ☕\n\nOur server goes to sleep when not in use to save resources. Please wait about 30-60 seconds and try again.\n\nSorry for the inconvenience!`
          : `Sorry, I encountered an error: ${errorMessage}`;
        
        updateChatMessage(chatId!, assistantMessageId, {
          content: friendlyMessage,
          isStreaming: false,
          currentStatus: null,
        });
        
        setPendingSaveChats(prev => new Set(prev).add(chatId!));
      } finally {
        // Only update state if still mounted
        if (mountedRef.current) {
          // Remove from generating set
          setGeneratingChats(prev => {
            const next = new Set(prev);
            next.delete(chatId!);
            return next;
          });
        }
        // Clean up the controller reference
        activeStreamsRef.current.delete(chatId!);
      }
    },
    [getMemoryForChat, currentChatId, user, credits, useCredits, refreshCredits]
  );

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

  // Get status message for current chat (from the streaming message's currentStatus)
  const statusMessage = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.isStreaming && lastMessage.currentStatus) {
      return lastMessage.currentStatus.message;
    }
    return '';
  }, [messages]);

  return (
    <main className={styles.main}>
      <Sidebar
        onNewChat={handleNewChat}
        chats={chats}
        currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        isLoadingChats={isLoadingChats}
        generatingChats={generatingChats}
      />
      <ChatInterface
        messages={messages}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        statusMessage={statusMessage}
      />
      <OutOfCreditsModal
        isOpen={showOutOfCreditsModal}
        onClose={() => setShowOutOfCreditsModal(false)}
      />
    </main>
  );
}
