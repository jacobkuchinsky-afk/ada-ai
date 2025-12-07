import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { Message } from "@/components/Chat/ChatMessage";

export interface Chat {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: Message[];
}

export interface ChatPreview {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

// Helper to truncate title
function truncateTitle(message: string, maxLength: number = 60): string {
  const cleaned = message.trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3) + "...";
}

// Helper to convert Firestore timestamp to Date
function toDate(timestamp: Timestamp | Date | undefined): Date {
  if (!timestamp) return new Date();
  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  return timestamp;
}

/**
 * Create a new chat with the first message as the title
 */
export async function createChat(
  userId: string,
  firstMessage: string
): Promise<string> {
  const chatsRef = collection(db, "users", userId, "chats");

  const newChat = {
    title: truncateTitle(firstMessage),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    messages: [],
  };

  const docRef = await addDoc(chatsRef, newChat);
  return docRef.id;
}

/**
 * Update chat messages
 */
export async function updateChat(
  userId: string,
  chatId: string,
  messages: Message[]
): Promise<void> {
  const chatRef = doc(db, "users", userId, "chats", chatId);

  // Serialize messages - remove non-serializable fields
  const serializedMessages = messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    searchHistory: msg.searchHistory || [],
    // Don't store streaming state
  }));

  await updateDoc(chatRef, {
    messages: serializedMessages,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Get all chats for the sidebar (ordered by most recent)
 */
export async function getChats(userId: string): Promise<ChatPreview[]> {
  const chatsRef = collection(db, "users", userId, "chats");
  const q = query(chatsRef, orderBy("updatedAt", "desc"));

  const snapshot = await getDocs(q);
  const chats: ChatPreview[] = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    chats.push({
      id: doc.id,
      title: data.title || "Untitled Chat",
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
    });
  });

  return chats;
}

/**
 * Get a single chat with all messages
 */
export async function getChat(
  userId: string,
  chatId: string
): Promise<Chat | null> {
  const chatRef = doc(db, "users", userId, "chats", chatId);
  const snapshot = await getDoc(chatRef);

  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();
  return {
    id: snapshot.id,
    title: data.title || "Untitled Chat",
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    messages: data.messages || [],
  };
}

/**
 * Delete a chat
 */
export async function deleteChat(
  userId: string,
  chatId: string
): Promise<void> {
  const chatRef = doc(db, "users", userId, "chats", chatId);
  await deleteDoc(chatRef);
}


