// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDvr4pntuSmZIVX5NtoNkhM5dHq-SbzqOU",
  authDomain: "rag-based-chatbot-d1810.firebaseapp.com",
  projectId: "rag-based-chatbot-d1810",
  storageBucket: "rag-based-chatbot-d1810.appspot.com",
  messagingSenderId: "557020748572",
  appId: "1:557020748572:web:503c5f67d1e8bcc10778d9",
  measurementId: "G-B9LVJ0EYCY"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };