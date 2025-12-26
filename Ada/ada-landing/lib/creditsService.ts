import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";

const FREE_DAILY_CREDITS = 20;
const PREMIUM_DAILY_CREDITS = 200;

export interface UserCredits {
  credits: number;
  maxCredits: number;
  isPremium: boolean;
  premiumExpiresAt: Date | null;
  lastCreditReset: Date;
}

// Get current UTC date as string (YYYY-MM-DD)
function getUTCDateString(): string {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

// Convert Firestore timestamp to Date
function toDate(timestamp: Timestamp | Date | null | undefined): Date | null {
  if (!timestamp) return null;
  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  return timestamp;
}

/**
 * Check if premium status is still valid
 */
function isPremiumValid(premiumExpiresAt: Date | null): boolean {
  if (!premiumExpiresAt) return false;
  return new Date() < premiumExpiresAt;
}

/**
 * Get daily credit limit based on premium status
 */
function getDailyLimit(isPremium: boolean): number {
  return isPremium ? PREMIUM_DAILY_CREDITS : FREE_DAILY_CREDITS;
}

/**
 * Initialize user credits document if it doesn't exist
 */
async function initializeUserCredits(userId: string): Promise<void> {
  const userRef = doc(db, "users", userId);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    await setDoc(userRef, {
      credits: FREE_DAILY_CREDITS,
      lastCreditReset: getUTCDateString(),
      isPremium: false,
      premiumExpiresAt: null,
    });
  }
}

/**
 * Get user's current credits, auto-resetting if it's a new UTC day
 */
export async function getUserCredits(userId: string): Promise<UserCredits> {
  try {
    const userRef = doc(db, "users", userId);
    let snapshot = await getDoc(userRef);

    // Initialize if doesn't exist
    if (!snapshot.exists()) {
      await initializeUserCredits(userId);
      snapshot = await getDoc(userRef);
    }

    // If still doesn't exist after init, return defaults
    if (!snapshot.exists()) {
      return {
        credits: FREE_DAILY_CREDITS,
        maxCredits: FREE_DAILY_CREDITS,
        isPremium: false,
        premiumExpiresAt: null,
        lastCreditReset: new Date(),
      };
    }

    const data = snapshot.data()!;
    const lastResetDate = data.lastCreditReset;
    const currentDate = getUTCDateString();
    const premiumExpiresAt = toDate(data.premiumExpiresAt);
    const isPremium = isPremiumValid(premiumExpiresAt);

    // Check if we need to reset credits (new day)
    if (lastResetDate !== currentDate) {
      const dailyLimit = getDailyLimit(isPremium);
      await setDoc(userRef, {
        credits: dailyLimit,
        lastCreditReset: currentDate,
        isPremium: isPremium,
      }, { merge: true });

      return {
        credits: dailyLimit,
        maxCredits: dailyLimit,
        isPremium,
        premiumExpiresAt,
        lastCreditReset: new Date(),
      };
    }

    // Check if premium expired and needs to be updated
    if (data.isPremium && !isPremium) {
      await setDoc(userRef, {
        isPremium: false,
      }, { merge: true });
    }

    return {
      credits: data.credits,
      maxCredits: getDailyLimit(isPremium),
      isPremium,
      premiumExpiresAt,
      lastCreditReset: new Date(lastResetDate),
    };
  } catch (error) {
    // Return defaults if there's any error (e.g., permissions during initial load)
    console.warn('Error fetching credits, using defaults:', error);
    return {
      credits: FREE_DAILY_CREDITS,
      maxCredits: FREE_DAILY_CREDITS,
      isPremium: false,
      premiumExpiresAt: null,
      lastCreditReset: new Date(),
    };
  }
}

/**
 * Use credits - returns true if successful, false if insufficient
 */
export async function useCredits(
  userId: string,
  amount: number
): Promise<boolean> {
  try {
    const userRef = doc(db, "users", userId);
    const currentCredits = await getUserCredits(userId);

    if (currentCredits.credits < amount) {
      return false;
    }

    await setDoc(userRef, {
      credits: currentCredits.credits - amount,
    }, { merge: true });

    return true;
  } catch (error) {
    console.warn('Error using credits:', error);
    return false;
  }
}

/**
 * Check if user has enough credits
 */
export async function hasEnoughCredits(
  userId: string,
  amount: number
): Promise<boolean> {
  const currentCredits = await getUserCredits(userId);
  return currentCredits.credits >= amount;
}

/**
 * Get formatted time until premium expires
 */
export function formatPremiumExpiry(expiresAt: Date | null): string {
  if (!expiresAt) return "";

  const now = new Date();
  const diff = expiresAt.getTime() - now.getTime();

  if (diff <= 0) return "Expired";

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} remaining`;

  const hours = Math.floor(diff / (1000 * 60 * 60));
  return `${hours} hour${hours === 1 ? "" : "s"} remaining`;
}

