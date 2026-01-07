// Firebase Admin SDK initialization for backend
const admin = require('firebase-admin');
const serviceAccount = require('./rag-based-chatbot-d1810-firebase-adminsdk-fbsvc-7c54b5a16e.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'rag-based-chatbot-d1810.appspot.com'
});

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };