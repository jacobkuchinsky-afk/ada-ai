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
  const { user, loading } = useAuth();
  const { credits, useCredits, refreshCredits } = useCreditsContext();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);

  // Chat persistence state
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [pendingSave, setPendingSave] = useState(false);

  // Out of credits modal state
  const [showOutOfCreditsModal, setShowOutOfCreditsModal] = useState(false);

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
            setMessages(fullChat.messages);
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

  const handleNewChat = useCallback(() => {
    // Abort any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setCurrentChatId(null);
    setStatusMessage('');
    setIsLoading(false);
  }, []);

  const handleSelectChat = useCallback(
    async (chatId: string) => {
      if (!user || chatId === currentChatId) return;

      // Abort any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      try {
        const fullChat = await getChat(user.uid, chatId);
        if (fullChat) {
          setCurrentChatId(fullChat.id);
          setMessages(fullChat.messages);
          setStatusMessage('');
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Error loading chat:', error);
      }
    },
    [user, currentChatId]
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
        } catch (error) {
          console.error('Error creating chat:', error);
          return;
        }
      }

      // Add user message
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content,
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setStatusMessage('Connecting...');

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
      setMessages((prev) => [...prev, assistantMessage]);

      try {
        const response = await fetch(`${API_URL}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: content,
            memory: getMemory(),
          }),
          signal: abortControllerRef.current.signal,
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

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === 'status') {
                  // Update status with step and icon
                  const statusInfo: StatusInfo = {
                    message: data.message,
                    step: data.step,
                    icon: data.icon,
                  };
                  setStatusMessage(data.message);
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessageId
                        ? { ...m, currentStatus: statusInfo }
                        : m
                    )
                  );
                } else if (data.type === 'search') {
                  // Handle search event
                  const searchEntry: SearchEntry = {
                    query: data.query,
                    sources: data.sources || [],
                    iteration: data.iteration,
                    status: data.status,
                  };

                  // Update or add search entry
                  const existingIndex = currentSearchHistory.findIndex(
                    (s) => s.iteration === data.iteration
                  );

                  if (existingIndex >= 0) {
                    // Update existing search with sources
                    currentSearchHistory[existingIndex] = searchEntry;
                  } else {
                    // Add new search
                    currentSearchHistory = [...currentSearchHistory, searchEntry];
                  }

                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessageId
                        ? { ...m, searchHistory: [...currentSearchHistory] }
                        : m
                    )
                  );
                } else if (data.type === 'content') {
                  // Streaming content
                  accumulatedContent += data.data;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessageId
                        ? { ...m, content: accumulatedContent, currentStatus: null }
                        : m
                    )
                  );
                } else if (data.type === 'done') {
                  // Complete - deduct 1 credit for response
                  await useCredits(1);
                  await refreshCredits();

                  // Store final search history
                  setStatusMessage('');
                  const finalSearchHistory = data.searchHistory || currentSearchHistory;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessageId
                        ? {
                            ...m,
                            isStreaming: false,
                            currentStatus: null,
                            searchHistory: finalSearchHistory,
                          }
                        : m
                    )
                  );
                  // Trigger save
                  setPendingSave(true);

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
        setStatusMessage('');

        // Update the assistant message with error
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: `Sorry, I encountered an error: ${(error as Error).message}. Please make sure the AI server is running on port 5000.`,
                  isStreaming: false,
                  currentStatus: null,
                }
              : m
          )
        );
        setPendingSave(true);
      } finally {
        setIsLoading(false);
      }
    },
    [getMemory, currentChatId, user, credits, useCredits, refreshCredits]
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

  return (
    <main className={styles.main}>
      <Sidebar
        onNewChat={handleNewChat}
        chats={chats}
        currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        isLoadingChats={isLoadingChats}
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
