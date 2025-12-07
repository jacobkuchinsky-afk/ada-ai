import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC0SMgRN2DVNJELdh52oeLSyzyTU0Kn62k",
  authDomain: "ada-ai-90350.firebaseapp.com",
  projectId: "ada-ai-90350",
  storageBucket: "ada-ai-90350.firebasestorage.app",
  messagingSenderId: "491245786216",
  appId: "1:491245786216:web:3a60d5409199b7696697dd",
  measurementId: "G-R4YQW88FFE"
};

// Initialize Firebase (prevent multiple initializations)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const db = getFirestore(app);

