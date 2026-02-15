// Firebase Admin SDK initialization for backend
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config(); // Load environment variables

let credential;

// Prefer service account JSON file if it exists
const serviceAccountPath = path.join(__dirname, 'identity-compass-79f6a-firebase-adminsdk-fbsvc-feb81f6d6a.json');
if (require('fs').existsSync(serviceAccountPath)) {
  credential = admin.credential.cert(serviceAccountPath);
} else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  // Fall back to environment variables
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
    universe_domain: "googleapis.com"
  };
  credential = admin.credential.cert(serviceAccount);
} else {
  console.error('ERROR: Missing Firebase credentials!');
  console.error('Add a service account JSON file in the backend folder, or set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env');
  process.exit(1);
}

if (!admin.apps.length) {
  const fs = require('fs');
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET ||
    (fs.existsSync(serviceAccountPath) ? require(serviceAccountPath).project_id + '.firebasestorage.app' : undefined);
  admin.initializeApp({
    credential,
    ...(storageBucket && { storageBucket })
  });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };