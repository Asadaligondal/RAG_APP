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
console.log("Firebase initialized successfully!");
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
app.use(express.json()); // For parsing JSON request bodies

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

// Custom text splitter
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

// POST endpoint for processing PDFs from UploadThing URLs
app.post('/upload-from-url', express.json(), async (req, res) => {
  const { pdfUrl, chatId, fileName } = req.body;

  if (!pdfUrl || !chatId) {
    return res.status(400).send('pdfUrl and chatId are required.');
  }

  try {
    console.log(`Processing PDF from URL: ${pdfUrl}`);
    
    // Download PDF from UploadThing URL
    const response = await axios.get(pdfUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000 // 30 second timeout
    });
    
    const pdfBuffer = Buffer.from(response.data);
    
    // Extract text from PDF
    const pdfData = await pdf(pdfBuffer);
    const extractedText = pdfData.text;

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).send('No text could be extracted from the PDF. It might be image-only or empty.');
    }

    // Split text into chunks
    const chunks = splitText(extractedText, 500, 100);

    if (chunks.length === 0) {
      return res.status(400).send('No text chunks created from PDF.');
    }

    // Generate embeddings for chunks
    const embeddings = await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input: chunk
          });
          return embeddingResponse.data[0].embedding;
        } catch (embeddingError) {
          console.error(`Error generating embedding: ${embeddingError.message}`);
          return null;
        }
      })
    );

    // Filter out failed embeddings
    const validEmbeddings = embeddings.filter(e => e !== null);

    if (validEmbeddings.length === 0) {
      return res.status(500).send('Failed to generate embeddings for any chunks.');
    }

    // Create documents with embeddings
    const newDocuments = chunks.map((chunk, index) => ({
      source: fileName || 'uploaded-document.pdf',
      chunk: chunk,
      embedding: validEmbeddings[index] || [],
      chatId: chatId,
      pdfUrl: pdfUrl,
      createdAt: new Date().toISOString()
    })).filter(doc => doc.embedding.length > 0);

    // Store in Firestore
    const batch = db.batch();
    newDocuments.forEach(doc => {
      const docRef = db.collection('documents').doc();
      batch.set(docRef, doc);
    });
    await batch.commit();

    console.log(`Processed ${newDocuments.length} chunks for chatId: ${chatId}`);

    res.json({
      message: 'PDF processed successfully',
      chunksProcessed: newDocuments.length,
      pdfUrl: pdfUrl,
      fileName: fileName
    });

  } catch (error) {
    console.error('Error processing PDF from URL:', error);
    res.status(500).json({ 
      error: 'Failed to process PDF',
      details: error.message 
    });
  }
});

// ... (rest of the code)

// POST endpoint for queries (no authentication needed)
app.post('/query', express.json(), async (req, res) => {
  const { question, chatId } = req.body;
  if (!question) {
    return res.status(400).send('No question provided.');
  }
  if (!chatId) {
    return res.status(400).send('chatId is required.');
  }
  try {
    const questionEmbeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: question
    });
    const questionEmbedding = questionEmbeddingResponse.data[0].embedding;
    // Retrieve only documents from the current chatId
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
    res.send({
      question,
      answer,
      relevantChunks: relevantChunks.map(doc => ({
        chunk: doc.chunk,
        source: doc.source,
        similarity: doc.similarity
      }))
    });
  } catch (error) {
    res.status(500).send(`Error processing query: ${error.message}`);
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});