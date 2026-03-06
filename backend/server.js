const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const pdf = require('pdf-parse');
const { OpenAI } = require('openai');
const axios = require('axios');
const crypto = require('crypto');
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

// --- Smart Sentence-Aware Chunking ---
function smartSplitText(text, chunkSize = 500, chunkOverlap = 100) {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const words = currentChunk.split(' ');
      const overlapWords = words.slice(-Math.ceil(chunkOverlap / 5));
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
    } else {
      currentChunk += sentence;
    }
  }
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

// --- Re-ranking: uses LLM to score chunk relevance ---
async function rerankChunks(question, chunks, openaiClient, topK = 5) {
  if (chunks.length <= topK) return chunks;
  try {
    const chunkDescs = chunks.slice(0, 15).map((c, i) => `Chunk ${i + 1}: "${c.chunk.slice(0, 200)}"`).join('\n');
    const prompt = `Given the question: "${question}"\n\nRate the relevance of each chunk on a scale of 0-10. Return ONLY a JSON array of integer scores in the same order, nothing else.\n\n${chunkDescs}`;
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0
    });
    const content = response.choices[0]?.message?.content?.trim();
    const cleaned = content.replace(/```json?\s*|\s*```/g, '').trim();
    const scores = JSON.parse(cleaned);
    if (Array.isArray(scores)) {
      return chunks
        .slice(0, scores.length)
        .map((chunk, i) => ({ ...chunk, rerankScore: scores[i] || 0 }))
        .sort((a, b) => b.rerankScore - a.rerankScore)
        .slice(0, topK);
    }
  } catch (e) {
    console.warn('[RERANK] Failed, using similarity order:', e.message);
  }
  return chunks.slice(0, topK);
}

// --- Query Cache (in-memory LRU) ---
const queryCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 500;

function getCacheKey(question, chatId, model) {
  return `${chatId}:${model}:${question.trim().toLowerCase()}`;
}
function getCachedResult(key) {
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  queryCache.delete(key);
  return null;
}
function setCachedResult(key, data) {
  if (queryCache.size > MAX_CACHE_SIZE) {
    const oldest = queryCache.keys().next().value;
    queryCache.delete(oldest);
  }
  queryCache.set(key, { data, ts: Date.now() });
}

// --- Rate Limiting (per-user, in-memory) ---
const rateLimitMap = new Map();
function rateLimitMiddleware(maxRequests = 30, windowMs = 60000) {
  return (req, res, next) => {
    const key = req.user?.uid || req.ip;
    const now = Date.now();
    if (!rateLimitMap.has(key)) rateLimitMap.set(key, []);
    const timestamps = rateLimitMap.get(key).filter(t => t > now - windowMs);
    rateLimitMap.set(key, timestamps);
    if (timestamps.length >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please slow down and retry in a minute.' });
    }
    timestamps.push(now);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', maxRequests - timestamps.length);
    next();
  };
}

// --- Supported Models ---
const SUPPORTED_MODELS = {
  'gpt-4o': { label: 'GPT-4o', provider: 'openai' },
  'gpt-4o-mini': { label: 'GPT-4o Mini', provider: 'openai' },
  'gpt-3.5-turbo': { label: 'GPT-3.5 Turbo', provider: 'openai' },
};
const SUPPORTED_EMBEDDING_MODELS = {
  'text-embedding-ada-002': { label: 'Ada 002', dimensions: 1536 },
  'text-embedding-3-small': { label: 'Embedding 3 Small', dimensions: 1536 },
  'text-embedding-3-large': { label: 'Embedding 3 Large', dimensions: 3072 },
};
const DEFAULT_LLM = 'gpt-4o';
const DEFAULT_EMBEDDING = 'text-embedding-ada-002';

// --- Webhook Dispatcher ---
async function dispatchWebhooks(userId, event, payload) {
  try {
    const snapshot = await db.collection('webhooks').where('userId', '==', userId).where('events', 'array-contains', event).get();
    if (snapshot.empty) return;
    const promises = snapshot.docs.map(async (doc) => {
      const wh = doc.data();
      try {
        await axios.post(wh.url, { event, timestamp: new Date().toISOString(), data: payload }, { timeout: 5000, headers: { 'X-Webhook-Secret': wh.secret || '' } });
      } catch (e) {
        console.warn(`[WEBHOOK] Failed to deliver to ${wh.url}:`, e.message);
      }
    });
    await Promise.allSettled(promises);
  } catch (e) {
    console.warn('[WEBHOOK] Dispatch error:', e.message);
  }
}

// --- API Key Authentication Middleware ---
async function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing X-API-Key header.' });
  try {
    const snapshot = await db.collection('api_keys').where('key', '==', apiKey).limit(1).get();
    if (snapshot.empty) return res.status(401).json({ error: 'Invalid API key.' });
    const keyDoc = snapshot.docs[0].data();
    if (keyDoc.revoked) return res.status(401).json({ error: 'API key has been revoked.' });
    req.user = { uid: keyDoc.userId };
    req.apiKeyId = snapshot.docs[0].id;
    // Log usage
    await db.collection('api_keys').doc(snapshot.docs[0].id).update({ lastUsed: new Date().toISOString(), usageCount: FieldValue.increment(1) });
    next();
  } catch (e) {
    return res.status(500).json({ error: 'API key verification failed.' });
  }
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

    // Dispatch webhook for document upload
    dispatchWebhooks(userId, 'document.uploaded', { chatId, fileName, chunksProcessed: documents.length, pdfUrl });

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

// POST endpoint for streaming queries (requires auth + rate limit)
app.post('/query-stream', requireAuth, rateLimitMiddleware(30, 60000), express.json(), async (req, res) => {
  const { question, chatId, model, enableReranking } = req.body;
  const userId = req.user.uid;
  const selectedModel = (model && SUPPORTED_MODELS[model]) ? model : DEFAULT_LLM;
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
      model: DEFAULT_EMBEDDING,
      input: question
    });
    const questionEmbedding = questionEmbeddingResponse.data[0].embedding;
    const snapshot = await db.collection('documents').where('chatId', '==', chatId).get();
    const allDocuments = snapshot.docs.map(doc => doc.data());
    const similarities = allDocuments.map(doc => ({
      ...doc,
      similarity: cosineSimilarity(questionEmbedding, doc.embedding)
    }));

    // Hybrid search: keyword + semantic
    const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scoredChunks = similarities.map(doc => {
      const keywordHits = keywords.filter(kw => doc.chunk.toLowerCase().includes(kw)).length;
      const keywordBoost = keywordHits * 0.05;
      return { ...doc, hybridScore: doc.similarity + keywordBoost };
    });

    let relevantChunks = scoredChunks
      .filter(doc => doc.hybridScore > 0.65)
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, 10);

    // Re-rank if enabled
    if (enableReranking !== false && relevantChunks.length > 3) {
      relevantChunks = await rerankChunks(question, relevantChunks, openai, 5);
    } else {
      relevantChunks = relevantChunks.slice(0, 5);
    }

    let context = "No relevant information found in documents.";
    if (relevantChunks.length > 0) {
      context = relevantChunks.map(doc => doc.chunk).join('\n\n');
    }
    const prompt = `Based on the following context, answer the question comprehensively. If the information is not available in the context, state that clearly.\n\nContext:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;

    const sources = relevantChunks.map(doc => ({
      chunk: doc.chunk,
      source: doc.source,
      similarity: doc.similarity,
      pageNumber: doc.pageNumber || null,
      rerankScore: doc.rerankScore || null
    }));

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const stream = await openai.chat.completions.create({
      model: selectedModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.2,
      stream: true
    });

    let fullAnswer = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullAnswer += content;
        res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
        res.flush?.();
      }
    }

    await incrementUsage(userId, 'queriesCount');

    // Log query for analytics
    try {
      await db.collection('query_logs').add({
        userId, chatId, question, model: selectedModel,
        sourcesCount: sources.length, answerLength: fullAnswer.length,
        reranked: enableReranking !== false,
        createdAt: new Date().toISOString()
      });
    } catch (_) {}

    // Dispatch webhook
    dispatchWebhooks(userId, 'query.completed', { chatId, question, model: selectedModel, sourcesCount: sources.length });

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
app.post('/query', requireAuth, rateLimitMiddleware(30, 60000), express.json(), async (req, res) => {
  const { question, chatId, model, enableReranking } = req.body;
  const userId = req.user.uid;
  const selectedModel = (model && SUPPORTED_MODELS[model]) ? model : DEFAULT_LLM;
  if (!question) {
    return res.status(400).send('No question provided.');
  }
  if (!chatId) {
    return res.status(400).send('chatId is required.');
  }
  try {
    // Check cache first
    const cacheKey = getCacheKey(question, chatId, selectedModel);
    const cached = getCachedResult(cacheKey);
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }

    const limitCheck = await checkLimit(userId, 'queriesCount');
    if (!limitCheck.allowed) {
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
      model: DEFAULT_EMBEDDING,
      input: question
    });
    const questionEmbedding = questionEmbeddingResponse.data[0].embedding;
    const snapshot = await db.collection('documents').where('chatId', '==', chatId).get();
    const allDocuments = snapshot.docs.map(doc => doc.data());
    const similarities = allDocuments.map(doc => ({
      ...doc,
      similarity: cosineSimilarity(questionEmbedding, doc.embedding)
    }));

    // Hybrid search
    const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scoredChunks = similarities.map(doc => {
      const keywordHits = keywords.filter(kw => doc.chunk.toLowerCase().includes(kw)).length;
      return { ...doc, hybridScore: doc.similarity + keywordHits * 0.05 };
    });

    let relevantChunks = scoredChunks
      .filter(doc => doc.hybridScore > 0.65)
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, 10);

    if (enableReranking !== false && relevantChunks.length > 3) {
      relevantChunks = await rerankChunks(question, relevantChunks, openai, 5);
    } else {
      relevantChunks = relevantChunks.slice(0, 5);
    }

    let context = "No relevant information found in documents.";
    if (relevantChunks.length > 0) {
      context = relevantChunks.map(doc => doc.chunk).join('\n\n');
    }
    const prompt = `Based on the following context, answer the question comprehensively. If the information is not available in the context, state that clearly.\n\nContext:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;
    const chatResponse = await openai.chat.completions.create({
      model: selectedModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.2
    });
    const answer = chatResponse.choices[0].message.content;
    await incrementUsage(userId, 'queriesCount');

    const result = {
      question,
      answer,
      model: selectedModel,
      relevantChunks: relevantChunks.map(doc => ({
        chunk: doc.chunk,
        source: doc.source,
        similarity: doc.similarity,
        pageNumber: doc.pageNumber || null
      }))
    };

    // Cache the result
    setCachedResult(cacheKey, result);

    // Log query
    try {
      await db.collection('query_logs').add({
        userId, chatId, question, model: selectedModel,
        sourcesCount: relevantChunks.length, answerLength: answer.length,
        reranked: enableReranking !== false,
        createdAt: new Date().toISOString()
      });
    } catch (_) {}

    dispatchWebhooks(userId, 'query.completed', { chatId, question, model: selectedModel });
    res.json(result);
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

// ========================
// DOCUMENT MANAGEMENT APIs
// ========================

// PATCH - Add/remove tags on a chat/document
app.patch('/api/chats/:chatId/tags', requireAuth, express.json(), async (req, res) => {
  const { chatId } = req.params;
  const { tags } = req.body; // array of strings
  const userId = req.user.uid;
  if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array of strings.' });
  try {
    const chatRef = db.doc(`users/${userId}/chats/${chatId}`);
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists) return res.status(404).json({ error: 'Chat not found.' });
    const sanitized = tags.filter(t => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 20);
    await chatRef.update({ tags: sanitized, updatedAt: new Date().toISOString() });
    res.json({ tags: sanitized });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET - Search documents (full-text search across user's chats)
app.get('/api/documents/search', requireAuth, async (req, res) => {
  const userId = req.user.uid;
  const q = (req.query.q || '').trim().toLowerCase();
  const tag = (req.query.tag || '').trim().toLowerCase();
  if (!q && !tag) return res.status(400).json({ error: 'Provide q (search query) or tag parameter.' });
  try {
    const chatsRef = db.collection(`users/${userId}/chats`);
    const snapshot = await chatsRef.orderBy('createdAt', 'desc').get();
    let results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (q) {
      results = results.filter(chat => (chat.title || '').toLowerCase().includes(q));
    }
    if (tag) {
      results = results.filter(chat => (chat.tags || []).includes(tag));
    }
    res.json({ results: results.slice(0, 50) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET - Document detail with chunk count
app.get('/api/chats/:chatId/details', requireAuth, async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.uid;
  try {
    const chatRef = db.doc(`users/${userId}/chats/${chatId}`);
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists) return res.status(404).json({ error: 'Chat not found.' });
    const chunksSnap = await db.collection('documents').where('chatId', '==', chatId).get();
    const data = chatDoc.data();
    res.json({
      id: chatId,
      title: data.title,
      tags: data.tags || [],
      pdfUrl: data.pdfUrl || null,
      createdAt: data.createdAt,
      chunksCount: chunksSnap.size,
      suggestedQuestions: data.suggestedQuestions || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// FEEDBACK & ANALYTICS APIs
// ========================

// POST - Submit feedback on an AI message
app.post('/api/feedback', requireAuth, express.json(), async (req, res) => {
  const userId = req.user.uid;
  const { chatId, messageId, rating, comment } = req.body; // rating: 'up' | 'down'
  if (!chatId || !messageId || !['up', 'down'].includes(rating)) {
    return res.status(400).json({ error: 'chatId, messageId, and rating (up/down) are required.' });
  }
  try {
    await db.collection('feedback').add({
      userId, chatId, messageId, rating,
      comment: (comment || '').slice(0, 500),
      createdAt: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET - Get feedback for a chat
app.get('/api/feedback/:chatId', requireAuth, async (req, res) => {
  const userId = req.user.uid;
  const { chatId } = req.params;
  try {
    const snapshot = await db.collection('feedback').where('userId', '==', userId).where('chatId', '==', chatId).get();
    const feedbacks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ feedbacks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET - Analytics: query logs summary
app.get('/api/analytics', requireAuth, async (req, res) => {
  const userId = req.user.uid;
  try {
    const logsSnap = await db.collection('query_logs').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(100).get();
    const logs = logsSnap.docs.map(doc => doc.data());
    const feedbackSnap = await db.collection('feedback').where('userId', '==', userId).get();
    const feedbacks = feedbackSnap.docs.map(doc => doc.data());
    const upCount = feedbacks.filter(f => f.rating === 'up').length;
    const downCount = feedbacks.filter(f => f.rating === 'down').length;
    res.json({
      totalQueries: logs.length,
      avgSourcesPerQuery: logs.length > 0 ? (logs.reduce((s, l) => s + (l.sourcesCount || 0), 0) / logs.length).toFixed(1) : 0,
      modelsUsed: [...new Set(logs.map(l => l.model))],
      feedbackSummary: { up: upCount, down: downCount, total: upCount + downCount },
      recentQueries: logs.slice(0, 20).map(l => ({ question: l.question, model: l.model, sourcesCount: l.sourcesCount, createdAt: l.createdAt }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// API KEY MANAGEMENT
// ========================

// POST - Generate a new API key
app.post('/api/keys', requireAuth, express.json(), async (req, res) => {
  const userId = req.user.uid;
  const { name } = req.body;
  try {
    // Limit to 5 active keys per user
    const existing = await db.collection('api_keys').where('userId', '==', userId).where('revoked', '==', false).get();
    if (existing.size >= 5) return res.status(400).json({ error: 'Maximum 5 active API keys.' });
    const key = 'db_' + crypto.randomBytes(32).toString('hex');
    const docRef = await db.collection('api_keys').add({
      userId, key, name: (name || 'Untitled Key').slice(0, 50),
      revoked: false, usageCount: 0,
      createdAt: new Date().toISOString(), lastUsed: null
    });
    res.json({ id: docRef.id, key, name: (name || 'Untitled Key').slice(0, 50) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET - List API keys (masked)
app.get('/api/keys', requireAuth, async (req, res) => {
  const userId = req.user.uid;
  try {
    const snapshot = await db.collection('api_keys').where('userId', '==', userId).get();
    const keys = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id, name: d.name,
        keyPreview: d.key.slice(0, 7) + '...' + d.key.slice(-4),
        revoked: d.revoked, usageCount: d.usageCount,
        createdAt: d.createdAt, lastUsed: d.lastUsed
      };
    });
    res.json({ keys });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE - Revoke an API key
app.delete('/api/keys/:keyId', requireAuth, async (req, res) => {
  const userId = req.user.uid;
  const { keyId } = req.params;
  try {
    const docRef = db.collection('api_keys').doc(keyId);
    const doc = await docRef.get();
    if (!doc.exists || doc.data().userId !== userId) return res.status(404).json({ error: 'Key not found.' });
    await docRef.update({ revoked: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// EXTERNAL API (API-Key auth)
// ========================

// POST - External query (for third-party integrations)
app.post('/api/v1/query', requireApiKey, rateLimitMiddleware(20, 60000), express.json(), async (req, res) => {
  const { question, chatId, model } = req.body;
  const userId = req.user.uid;
  const selectedModel = (model && SUPPORTED_MODELS[model]) ? model : DEFAULT_LLM;
  if (!question || !chatId) return res.status(400).json({ error: 'question and chatId are required.' });
  try {
    const chatRef = db.doc(`users/${userId}/chats/${chatId}`);
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists) return res.status(404).json({ error: 'Chat not found.' });

    const questionEmbeddingResponse = await openai.embeddings.create({ model: DEFAULT_EMBEDDING, input: question });
    const questionEmbedding = questionEmbeddingResponse.data[0].embedding;
    const snapshot = await db.collection('documents').where('chatId', '==', chatId).get();
    const allDocuments = snapshot.docs.map(doc => doc.data());
    const similarities = allDocuments.map(doc => ({ ...doc, similarity: cosineSimilarity(questionEmbedding, doc.embedding) }));
    let relevantChunks = similarities.filter(doc => doc.similarity > 0.65).sort((a, b) => b.similarity - a.similarity).slice(0, 5);
    let context = relevantChunks.length > 0 ? relevantChunks.map(doc => doc.chunk).join('\n\n') : "No relevant information found.";
    const prompt = `Based on the following context, answer comprehensively.\n\nContext:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;
    const chatResponse = await openai.chat.completions.create({ model: selectedModel, messages: [{ role: 'user', content: prompt }], max_tokens: 500, temperature: 0.2 });
    const answer = chatResponse.choices[0].message.content;
    await incrementUsage(userId, 'queriesCount');
    res.json({ answer, model: selectedModel, sources: relevantChunks.map(d => ({ chunk: d.chunk, source: d.source, similarity: d.similarity })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// WEBHOOK MANAGEMENT
// ========================

// POST - Register a webhook
app.post('/api/webhooks', requireAuth, express.json(), async (req, res) => {
  const userId = req.user.uid;
  const { url, events } = req.body; // events: ['document.uploaded', 'query.completed']
  const VALID_EVENTS = ['document.uploaded', 'query.completed'];
  if (!url || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'url and events[] are required.' });
  }
  const validEvents = events.filter(e => VALID_EVENTS.includes(e));
  if (validEvents.length === 0) return res.status(400).json({ error: `Invalid events. Allowed: ${VALID_EVENTS.join(', ')}` });
  try {
    // Allow parsing to catch malformed URLs
    new URL(url);
    const existing = await db.collection('webhooks').where('userId', '==', userId).get();
    if (existing.size >= 10) return res.status(400).json({ error: 'Maximum 10 webhooks.' });
    const secret = crypto.randomBytes(16).toString('hex');
    const docRef = await db.collection('webhooks').add({
      userId, url, events: validEvents, secret,
      createdAt: new Date().toISOString()
    });
    res.json({ id: docRef.id, url, events: validEvents, secret });
  } catch (error) {
    if (error.code === 'ERR_INVALID_URL') return res.status(400).json({ error: 'Invalid webhook URL.' });
    res.status(500).json({ error: error.message });
  }
});

// GET - List webhooks
app.get('/api/webhooks', requireAuth, async (req, res) => {
  const userId = req.user.uid;
  try {
    const snapshot = await db.collection('webhooks').where('userId', '==', userId).get();
    const webhooks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ webhooks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE - Remove a webhook
app.delete('/api/webhooks/:id', requireAuth, async (req, res) => {
  const userId = req.user.uid;
  const { id } = req.params;
  try {
    const docRef = db.collection('webhooks').doc(id);
    const doc = await docRef.get();
    if (!doc.exists || doc.data().userId !== userId) return res.status(404).json({ error: 'Webhook not found.' });
    await docRef.delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// SUPPORTED MODELS LIST
// ========================
app.get('/api/models', requireAuth, (req, res) => {
  res.json({
    llmModels: Object.entries(SUPPORTED_MODELS).map(([id, m]) => ({ id, ...m })),
    embeddingModels: Object.entries(SUPPORTED_EMBEDDING_MODELS).map(([id, m]) => ({ id, ...m })),
    defaultLLM: DEFAULT_LLM,
    defaultEmbedding: DEFAULT_EMBEDDING
  });
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