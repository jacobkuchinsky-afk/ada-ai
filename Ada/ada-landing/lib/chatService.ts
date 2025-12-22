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
  if (!userId) {
    throw new Error('CREATE_ERROR: No user ID provided');
  }

  const chatsRef = collection(db, "users", userId, "chats");

  const newChat = {
    title: truncateTitle(firstMessage),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    messages: [],
  };

  try {
    const docRef = await addDoc(chatsRef, newChat);
    return docRef.id;
  } catch (firebaseError) {
    const err = firebaseError as { code?: string; message?: string };
    if (err.code === 'permission-denied') {
      throw new Error('CREATE_ERROR: Permission denied - Firestore security rules may not be configured. Please check Firebase Console.');
    } else if (err.code === 'unavailable') {
      throw new Error('CREATE_ERROR: Firebase service unavailable - check your internet connection');
    } else {
      throw new Error(`CREATE_ERROR: Firebase error (${err.code || 'unknown'}): ${err.message || 'Unknown error'}`);
    }
  }
}

/**
 * Update chat messages
 */
export async function updateChat(
  userId: string,
  chatId: string,
  messages: Message[]
): Promise<void> {
  // Validate inputs
  if (!userId) {
    throw new Error('SAVE_ERROR: No user ID provided');
  }
  if (!chatId) {
    throw new Error('SAVE_ERROR: No chat ID provided');
  }
  if (!messages || messages.length === 0) {
    throw new Error('SAVE_ERROR: No messages to save');
  }

  const chatRef = doc(db, "users", userId, "chats", chatId);

  // Serialize messages - remove non-serializable fields
  // Note: rawSearchData is stored for summarization on next message
  // We cap it at 50KB per message to avoid Firebase document size limits
  let serializedMessages;
  try {
    serializedMessages = messages.map((msg) => {
      // Build base message object - Firestore doesn't accept undefined values
      const serialized: Record<string, unknown> = {
        id: msg.id,
        role: msg.role,
        content: msg.content || '',  // Ensure content is never undefined
        searchHistory: msg.searchHistory || [],
      };
      
      // Only include rawSearchData if it has a value (Firestore rejects undefined)
      if (msg.rawSearchData) {
        serialized.rawSearchData = msg.rawSearchData.substring(0, 50000);
      }
      
      return serialized;
    });
  } catch (serializeError) {
    throw new Error(`SAVE_ERROR: Failed to serialize messages - ${(serializeError as Error).message}`);
  }

  console.log('[FIREBASE DEBUG] Attempting updateDoc on path:', chatRef.path);
  console.log('[FIREBASE DEBUG] Serialized message count:', serializedMessages.length);
  try {
    await updateDoc(chatRef, {
      messages: serializedMessages,
      updatedAt: serverTimestamp(),
    });
    console.log('[FIREBASE DEBUG] updateDoc succeeded');
  } catch (firebaseError) {
    const err = firebaseError as { code?: string; message?: string };
    console.error('[FIREBASE DEBUG] updateDoc failed:', { code: err.code, message: err.message, fullError: firebaseError });
    if (err.code === 'permission-denied') {
      throw new Error('SAVE_ERROR: Permission denied - Firestore security rules may not be configured. Please check Firebase Console.');
    } else if (err.code === 'not-found') {
      throw new Error(`SAVE_ERROR: Chat document not found (chatId: ${chatId})`);
    } else if (err.code === 'unavailable') {
      throw new Error('SAVE_ERROR: Firebase service unavailable - check your internet connection');
    } else {
      throw new Error(`SAVE_ERROR: Firebase error (${err.code || 'unknown'}): ${err.message || 'Unknown error'}`);
    }
  }
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


