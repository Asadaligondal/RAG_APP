const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const pdf = require('pdf-parse');
const { OpenAI } = require('openai');
const axios = require('axios');
const { createRouteHandler } = require("uploadthing/express");
const { uploadRouter } = require("./uploadthing");
require('dotenv').config(); // Make sure your .env file has OPENAI_API_KEY

const app = express();
const port = 5000;

// --- Firebase Connection ---
const { admin, db, auth } = require('./firebase');
const { FieldValue } = require('firebase-admin/firestore');
console.log("Firebase initialized successfully!");

// --- Plan limits (per month) ---
const PLAN_LIMITS = {
  free: { documents: 5, queries: 50 },
  pro: { documents: 100, queries: 500 }
};

async function getUserPlan(userId) {
  try {
    const profileRef = db.doc(`users/${userId}/profile/account`);
    const profile = await profileRef.get();
    const plan = profile.exists ? (profile.data().plan || 'free') : 'free';
    return plan in PLAN_LIMITS ? plan : 'free';
  } catch (_) {
    return 'free';
  }
}

async function getUsageWithPeriod(userId) {
  const usageRef = db.collection('usage').doc(userId);
  const doc = await usageRef.get();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const data = doc.exists ? doc.data() : {};
  if (data.periodMonth !== currentMonth) {
    return { documentsCount: 0, queriesCount: 0, periodMonth: currentMonth, lastUpdated: null };
  }
  return {
    documentsCount: data.documentsCount || 0,
    queriesCount: data.queriesCount || 0,
    periodMonth: data.periodMonth || currentMonth,
    lastUpdated: data.lastUpdated || null
  };
}

async function checkLimit(userId, field) {
  const [plan, usage] = await Promise.all([getUserPlan(userId), getUsageWithPeriod(userId)]);
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const limit = field === 'documentsCount' ? limits.documents : limits.queries;
  const current = field === 'documentsCount' ? usage.documentsCount : usage.queriesCount;
  return { allowed: current < limit, current, limit, plan };
}

// --- Usage tracking helper (resets monthly) ---
async function incrementUsage(userId, field, amount = 1) {
  try {
    const usageRef = db.collection('usage').doc(userId);
    const doc = await usageRef.get();
    const currentMonth = new Date().toISOString().slice(0, 7);
    const data = doc.exists ? doc.data() : {};

    if (data.periodMonth !== currentMonth) {
      await usageRef.set({
        documentsCount: 0,
        queriesCount: 0,
        periodMonth: currentMonth,
        lastUpdated: new Date().toISOString()
      });
    }
    await usageRef.update({ [field]: FieldValue.increment(amount), lastUpdated: new Date().toISOString() });
    console.log(`[USAGE] Incremented ${field} for user ${userId.slice(0, 8)}...`);
  } catch (err) {
    console.error('[USAGE] Increment failed:', err.message, err.code || '');
  }
}

// --- Auth Middleware: Verify Firebase ID Token ---
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required. Please sign in.' });
  }
  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = { uid: decodedToken.uid };
    next();
  } catch (err) {
    console.error('Auth verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  }
}
// --- Firebase Auth: Email/Password Sign-In ---
app.post('/signin', express.json(), async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).send('Email and password required.');
  }
  try {
    // Firebase Admin SDK does not support sign-in with password directly (for security).
    // In production, use Firebase Client SDK on frontend for sign-in and send ID token to backend for verification.
    // Here, we only support verifying ID tokens sent from frontend after sign-in.
    return res.status(501).send('Sign-in with email/password should be handled on the frontend using Firebase Client SDK. Send ID token to backend for verification.');
  } catch (error) {
    res.status(500).send(`Sign-in error: ${error.message}`);
  }
});

// --- Document Schema will be handled by Firebase ---

// --- Middleware ---
app.use(cors()); // Enable CORS for all routes
app.use(express.json({ limit: '50mb' })); // Increased limit for large payloads
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Set timeout for all requests (5 minutes for PDF processing)
app.use((req, res, next) => {
  req.setTimeout(300000); // 5 minutes
  res.setTimeout(300000); // 5 minutes
  next();
});

// UploadThing route handler - must be before express.json() processes body
app.use(
  "/api/uploadthing",
  createRouteHandler({
    router: uploadRouter,
    config: {
      token: process.env.UPLOADTHING_TOKEN,
      isDev: true, // Set to true for development
    },
  })
);

// Initialize OpenAI with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// In-memory storage with persistence for Multer
// Ensure uploads folder exists
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    // Sanitize filename to prevent issues, or just use a timestamp
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// --- Helper Functions ---
// Helper to extract text and estimate page numbers (memory-efficient version)
async function extractTextWithPages(pdfBuffer) {
  // Extract all text in one pass
  const data = await pdf(pdfBuffer);
  const fullText = data.text;
  const totalPages = data.numpages;
  
  // Estimate characters per page
  const avgCharsPerPage = Math.ceil(fullText.length / totalPages);
  
  // Split text and assign estimated page numbers
  const pages = [];
  let currentPos = 0;
  
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const pageText = fullText.slice(currentPos, currentPos + avgCharsPerPage);
    pages.push({
      pageNumber: pageNum,
      text: pageText.trim()
    });
    currentPos += avgCharsPerPage;
  }
  
  return pages;
}

// Process chunks iteratively without storing all in memory
async function processChunksWithEmbeddings(pages, chunkSize, chunkOverlap, maxChunks, openai, fileName, chatId, pdfUrl, userId) {
  // Validate overlap
  if (chunkOverlap >= chunkSize) {
    throw new Error(`Invalid overlap: ${chunkOverlap} must be < ${chunkSize}`);
  }
  
  const documents = [];
  let totalChunks = 0;
  const MAX_CHUNKS = maxChunks || 100;
  
  // Process each page
  for (const page of pages) {
    if (totalChunks >= MAX_CHUNKS) {
      console.log(`[WARNING] Reached max chunks limit (${MAX_CHUNKS}), stopping`);
      break;
    }
    
    const { pageNumber, text } = page;
    let start = 0;
    
    // Process chunks from this page
    while (start < text.length && totalChunks < MAX_CHUNKS) {
      const end = Math.min(start + chunkSize, text.length);
      const chunkText = text.slice(start, end).trim();
      
      if (chunkText.length > 0) {
        // Process chunk immediately - generate embedding
        try {
          const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input: chunkText
          });
          
          // Store document immediately - don't accumulate
          documents.push({
            source: fileName || 'uploaded-document.pdf',
            chunk: chunkText,
            pageNumber: pageNumber,
            embedding: embeddingResponse.data[0].embedding,
            chatId: chatId,
            userId: userId || null,
            pdfUrl: pdfUrl,
            createdAt: new Date().toISOString()
          });
          
          totalChunks++;
          
          // Log progress every 10 chunks
          if (totalChunks % 10 === 0) {
            console.log(`[PROGRESS] Processed ${totalChunks} chunks...`);
          }
        } catch (error) {
          console.error(`[ERROR] Failed to process chunk ${totalChunks + 1}:`, error.message);
        }
      }
      
      // Move to next chunk with overlap
      start = end - chunkOverlap;
      
      // Prevent infinite loop
      if (start <= 0 || end >= text.length) break;
    }
    
    // Clear page text from memory
    page.text = null;
  }
  
  return documents;
}

// Custom text splitter with page tracking
function splitText(text, chunkSize = 100, chunkOverlap = 20) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;
    if (end > text.length) {
      end = text.length;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    // Move start pointer for the next chunk with overlap
    start += chunkSize - chunkOverlap;
  }
  return chunks;
}

// Cosine similarity function
function cosineSimilarity(vecA, vecB) {
  // Handle cases where vectors might be empty or null
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }

  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));

  if (normA === 0 || normB === 0) {
    return 0; // Avoid division by zero
  }

  return dotProduct / (normA * normB);
}

// --- Routes ---

app.get('/', (req, res) => {
  res.send('Welcome to the Simplified RAG Web App!');
});

// POST endpoint for file uploads (no authentication needed)
// ... (rest of the code)

app.post('/upload', upload.array('pdf'), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send('No files uploaded.');
  }

  const { chatId } = req.body; // Get chatId from request
  if (!chatId) {
    return res.status(400).send('chatId is required.');
  }

  const allNewDocuments = []; // Initialize here
  let filesProcessed = 0; // Track successfully processed files

  for (const file of req.files) {
    const filePath = `${uploadDir}${file.filename}`;
    let extractedText = ''; // Initialize extractedText for scope
    
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer);
      extractedText = pdfData.text; // Assign extracted text

      // Clean up the uploaded file immediately after reading
      // IMPORTANT: If pdf-parse is asynchronous or needs the file handle,
      // this needs to be moved to a finally block after all operations on the file.
      // For now, let's keep it here, but be aware.
      fs.unlinkSync(filePath); 

      const chunks = splitText(extractedText, 500, 100);

      if (chunks.length === 0) {
          console.warn(`No text chunks extracted from PDF: ${file.originalname}. It might be empty or image-only.`);
          continue; // Skip to next file
      }

      // Generate embeddings for the chunks
      const embeddings = await Promise.all(
        chunks.map(async (chunk) => {
          try {
            const response = await openai.embeddings.create({
              model: 'text-embedding-ada-002', // Consider text-embedding-3-small or text-embedding-3-large
              input: chunk
            });
            return response.data[0].embedding;
          } catch (embeddingError) {
            console.error(`OpenAI Embedding Error for chunk from ${file.originalname}: ${embeddingError.message}`);
            // If an embedding fails, return an empty array so it gets filtered out
            return [];
          }
        })
      );

      const newDocumentsForFile = chunks.map((chunk, index) => ({
        chunk,
        embedding: embeddings[index],
        source: file.originalname,
        chatId: chatId // Tag each chunk with chatId
      })).filter(doc => doc.embedding && doc.embedding.length > 0);

      allNewDocuments.push(...newDocumentsForFile);
      filesProcessed++;
      
    } catch (fileProcessingError) {
      console.error(`Error processing file ${file.originalname}: ${fileProcessingError.message}`);
      // Attempt to clean up the file even if processing failed
      if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
      }
    }
  } // End of for loop

  // Store allNewDocuments in Firestore (Firebase)
  try {
    const batch = db.batch();
    allNewDocuments.forEach(doc => {
      const docRef = db.collection('documents').doc();
      batch.set(docRef, doc);
    });
    await batch.commit();
    res.send({
      message: `${filesProcessed} file(s) processed and stored in Firebase!`,
      chunksProcessed: allNewDocuments.length,
    });
  } catch (firebaseError) {
    res.status(500).send(`Error saving chunks to Firebase: ${firebaseError.message}`);
  }
});

// POST endpoint for processing PDFs from UploadThing URLs (requires auth)
app.post('/upload-from-url', requireAuth, express.json(), async (req, res) => {
  const startTime = Date.now();
  const { pdfUrl, chatId, fileName } = req.body;
  const userId = req.user.uid;

  console.log(`[${new Date().toISOString()}] === START PDF PROCESSING ===`);
  console.log(`UserId: ${userId}, ChatId: ${chatId}, FileName: ${fileName}`);

  if (!pdfUrl || !chatId) {
    console.log('[ERROR] Missing required parameters');
    return res.status(400).json({ error: 'pdfUrl and chatId are required.' });
  }

  try {
    // Check plan limit before processing
    const limitCheck = await checkLimit(userId, 'documentsCount');
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `Document limit reached (${limitCheck.current}/${limitCheck.limit} this month). Upgrade to Pro for more.`,
        limitReached: true
      });
    }

    // Verify user owns the chat before processing
    const chatRef = db.doc(`users/${userId}/chats/${chatId}`);
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists) {
      return res.status(403).json({ error: 'Chat not found or access denied.' });
    }

    // Step 1: Download PDF
    console.log(`[STEP 1] Downloading PDF from: ${pdfUrl}`);
    const response = await axios.get(pdfUrl, { 
      responseType: 'arraybuffer',
      timeout: 60000 // Increased to 60 seconds
    });
    console.log(`[STEP 1] ✓ Downloaded ${response.data.byteLength} bytes in ${Date.now() - startTime}ms`);
    
    const pdfBuffer = Buffer.from(response.data);
    
    // Step 2: Extract text with page numbers
    console.log('[STEP 2] Extracting text with page numbers...');
    const extractStart = Date.now();
    const pages = await extractTextWithPages(pdfBuffer);
    console.log(`[STEP 2] ✓ Extracted ${pages.length} pages in ${Date.now() - extractStart}ms`);
    
    if (pages.length === 0) {
      console.log('[ERROR] No pages extracted');
      return res.status(400).json({ error: 'No pages could be extracted from the PDF.' });
    }

    // Step 3 & 4: Process chunks iteratively (no memory accumulation)
    console.log('[STEP 3-4] Processing chunks iteratively with embeddings...');
    const processStart = Date.now();
    const maxChunks = 100;
    
    const documents = await processChunksWithEmbeddings(
      pages, 
      500,  // chunkSize
      100,  // chunkOverlap
      maxChunks, 
      openai, 
      fileName, 
      chatId, 
      pdfUrl,
      userId
    );
    
    console.log(`[STEP 3-4] ✓ Processed ${documents.length} chunks in ${Date.now() - processStart}ms`);

    if (documents.length === 0) {
      console.log('[ERROR] No documents created');
      return res.status(400).json({ error: 'Failed to create any documents from PDF.' });
    }

    // Step 5: Store in Firestore in batches
    console.log(`[STEP 5] Storing ${documents.length} documents in Firestore...`);
    const firestoreStart = Date.now();
    const firestoreBatchSize = 50;
    let totalStored = 0;
    
    for (let i = 0; i < documents.length; i += firestoreBatchSize) {
      const batchDocs = documents.slice(i, i + firestoreBatchSize);
      const batch = db.batch();
      
      batchDocs.forEach(doc => {
        const docRef = db.collection('documents').doc();
        batch.set(docRef, doc);
      });
      
      await batch.commit();
      totalStored += batchDocs.length;
      const batchNum = Math.floor(i/firestoreBatchSize) + 1;
      console.log(`[STEP 5.${batchNum}] ✓ Stored batch ${batchNum}: ${totalStored}/${documents.length} documents`);
      
      // Small delay between batches
      if (i + firestoreBatchSize < documents.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    console.log(`[STEP 5] ✓ All documents stored in ${Date.now() - firestoreStart}ms`);

    // Step 6: Generate suggested questions based on document content
    let suggestedQuestions = [];
    try {
      const sampleContext = documents.slice(0, 5).map(d => d.chunk).join('\n\n').slice(0, 2000);
      const suggestResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Based on this document excerpt, generate exactly 4 short, specific questions a user might ask to learn more. Return ONLY a JSON array of 4 strings, no other text.\n\nExcerpt:\n${sampleContext}`
        }],
        max_tokens: 200,
        temperature: 0.5
      });
      const content = suggestResponse.choices[0]?.message?.content?.trim();
      if (content) {
        try {
          const cleaned = content.replace(/```json?\s*|\s*```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          suggestedQuestions = Array.isArray(parsed) ? parsed.slice(0, 4).filter(q => typeof q === 'string') : [];
        } catch (_) {
          suggestedQuestions = [];
        }
      }
      if (suggestedQuestions.length > 0) {
        await chatRef.update({ suggestedQuestions });
        console.log(`[STEP 6] ✓ Generated ${suggestedQuestions.length} suggested questions`);
      }
    } catch (suggestErr) {
      console.warn('[STEP 6] Suggested questions generation failed:', suggestErr.message);
    }

    await incrementUsage(userId, 'documentsCount');

    const totalTime = Date.now() - startTime;
    console.log(`[SUCCESS] === PDF PROCESSING COMPLETE in ${totalTime}ms ===`);
    console.log(`Total chunks processed: ${documents.length}`);

    res.json({
      message: 'PDF processed successfully',
      chunksProcessed: documents.length,
      pdfUrl: pdfUrl,
      fileName: fileName,
      suggestedQuestions: suggestedQuestions,
      processingTimeMs: totalTime
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[ERROR] === PDF PROCESSING FAILED after ${totalTime}ms ===`);
    console.error('Error details:', error);
    console.error('Error stack:', error.stack);
    
    // Ensure we always send a response
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to process PDF',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
});

// ... (rest of the code)

// POST endpoint for streaming queries (requires auth)
app.post('/query-stream', requireAuth, express.json(), async (req, res) => {
  const { question, chatId } = req.body;
  const userId = req.user.uid;
  if (!question) {
    return res.status(400).json({ error: 'No question provided.' });
  }
  if (!chatId) {
    return res.status(400).json({ error: 'chatId is required.' });
  }

  try {
    // Check plan limit before querying
    const limitCheck = await checkLimit(userId, 'queriesCount');
    if (!limitCheck.allowed) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(403).json({
        error: `Query limit reached (${limitCheck.current}/${limitCheck.limit} this month). Upgrade to Pro for more.`,
        limitReached: true
      });
    }

    const chatRef = db.doc(`users/${userId}/chats/${chatId}`);
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists) {
      return res.status(403).json({ error: 'Chat not found or access denied.' });
    }

    const questionEmbeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: question
    });
    const questionEmbedding = questionEmbeddingResponse.data[0].embedding;
    const snapshot = await db.collection('documents').where('chatId', '==', chatId).get();
    const allDocuments = snapshot.docs.map(doc => doc.data());
    const similarities = allDocuments.map(doc => ({
      ...doc,
      similarity: cosineSimilarity(questionEmbedding, doc.embedding)
    }));
    const relevantChunks = similarities
      .filter(doc => doc.similarity > 0.7)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
    let context = "No relevant information found in documents.";
    if (relevantChunks.length > 0) {
      context = relevantChunks.map(doc => doc.chunk).join('\n\n');
    }
    const prompt = `Based on the following context, answer the question comprehensively. If the information is not available in the context, state that clearly.\n\nContext:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;

    const sources = relevantChunks.map(doc => ({
      chunk: doc.chunk,
      source: doc.source,
      similarity: doc.similarity,
      pageNumber: doc.pageNumber || null
    }));

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.2,
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
        res.flush?.();
      }
    }

    await incrementUsage(userId, 'queriesCount');

    res.write(`data: ${JSON.stringify({ type: 'done', sources })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Stream query error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// POST endpoint for queries (requires auth) - non-streaming fallback
app.post('/query', requireAuth, express.json(), async (req, res) => {
  const { question, chatId } = req.body;
  const userId = req.user.uid;
  if (!question) {
    return res.status(400).send('No question provided.');
  }
  if (!chatId) {
    return res.status(400).send('chatId is required.');
  }
  try {
    const limitCheck = await checkLimit(userId, 'queriesCount');
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `Query limit reached (${limitCheck.current}/${limitCheck.limit} this month). Upgrade to Pro for more.`,
        limitReached: true
      });
    }
    // Verify user owns the chat before querying
    const chatRef = db.doc(`users/${userId}/chats/${chatId}`);
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists) {
      return res.status(403).json({ error: 'Chat not found or access denied.' });
    }

    const questionEmbeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: question
    });
    const questionEmbedding = questionEmbeddingResponse.data[0].embedding;
    // Retrieve documents - filter by chatId (userId stored for new docs, backward compat for old)
    const snapshot = await db.collection('documents').where('chatId', '==', chatId).get();
    const allDocuments = snapshot.docs.map(doc => doc.data());
    const similarities = allDocuments.map(doc => ({
      ...doc,
      similarity: cosineSimilarity(questionEmbedding, doc.embedding)
    }));
    const relevantChunks = similarities
      .filter(doc => doc.similarity > 0.7)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
    let context = "No relevant information found in documents.";
    if (relevantChunks.length > 0) {
      context = relevantChunks.map(doc => doc.chunk).join('\n\n');
    }
    const prompt = `Based on the following context, answer the question comprehensively. If the information is not available in the context, state that clearly.\n\nContext:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;
    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.2
    });
    const answer = chatResponse.choices[0].message.content;
    await incrementUsage(userId, 'queriesCount');
    res.send({
      question,
      answer,
      relevantChunks: relevantChunks.map(doc => ({
        chunk: doc.chunk,
        source: doc.source,
        similarity: doc.similarity,
        pageNumber: doc.pageNumber || null
      }))
    });
  } catch (error) {
    res.status(500).send(`Error processing query: ${error.message}`);
  }
});

// POST endpoint - Upgrade plan (demo: sets to Pro for testing)
app.post('/api/plan', requireAuth, express.json(), async (req, res) => {
  const userId = req.user.uid;
  const { plan } = req.body;
  if (!['free', 'pro'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Use "free" or "pro".' });
  }
  try {
    const profileRef = db.doc(`users/${userId}/profile/account`);
    await profileRef.set({ plan, updatedAt: new Date().toISOString() }, { merge: true });
    res.json({ plan, message: `Plan updated to ${plan}.` });
  } catch (error) {
    console.error('Plan update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET endpoint - Fetch user usage stats and plan (requires auth)
app.get('/api/usage', requireAuth, async (req, res) => {
  const userId = req.user.uid;
  try {
    const [plan, usage] = await Promise.all([getUserPlan(userId), getUsageWithPeriod(userId)]);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    res.json({
      plan,
      documentsCount: usage.documentsCount,
      queriesCount: usage.queriesCount,
      documentsLimit: limits.documents,
      queriesLimit: limits.queries,
      periodMonth: usage.periodMonth,
      lastUpdated: usage.lastUpdated || null
    });
  } catch (error) {
    console.error('Usage fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE endpoint - Delete chat and all its RAG documents (requires auth)
app.delete('/api/chats/:chatId', requireAuth, express.json(), async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.uid;

  if (!chatId) {
    return res.status(400).json({ error: 'chatId is required.' });
  }

  try {
    // Verify user owns the chat
    const chatRef = db.doc(`users/${userId}/chats/${chatId}`);
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists) {
      return res.status(404).json({ error: 'Chat not found or access denied.' });
    }

    // Delete all RAG documents (chunks) with this chatId (Firestore batch limit: 500)
    const docsSnapshot = await db.collection('documents').where('chatId', '==', chatId).get();
    const BATCH_SIZE = 500;
    for (let i = 0; i < docsSnapshot.docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      docsSnapshot.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    // Delete the chat document
    await chatRef.delete();

    res.json({ message: 'Chat and documents deleted successfully.' });
  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Start Server ---
const server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Server timeout set to 5 minutes for PDF processing`);
});

// Set server timeout (5 minutes)
server.timeout = 300000;
server.keepAliveTimeout = 300000;
server.headersTimeout = 310000;

// Export for Vercel serverless
module.exports = app;