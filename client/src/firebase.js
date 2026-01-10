// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB7CTNc1HJvmbkzg4CuMqWEXaETsbWewEA",
  authDomain: "identity-compass-79f6a.firebaseapp.com",
  projectId: "identity-compass-79f6a",
  storageBucket: "identity-compass-79f6a.firebasestorage.app",
  messagingSenderId: "388774577142",
  appId: "1:388774577142:web:2100be60b69feb6daefdd7",
  measurementId: "G-T1Z5KJ7W7P"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };