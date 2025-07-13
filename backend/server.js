const express = require('express');
const multer = require('multer');
const fs = require('fs');
const pdf = require('pdf-parse');
const { OpenAI } = require('openai');
const mongoose = require('mongoose');
require('dotenv').config(); // Make sure your .env file has OPENAI_API_KEY

const app = express();
const port = 3000;

// --- MongoDB Connection ---
mongoose.connect('mongodb://localhost:27017/rag-app', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("Connected to MongoDB")).catch(err =>
  console.error('MongoDB error', err));

// --- Document Schema (Simplified - no userId needed) ---
const documentSchema = new mongoose.Schema({
  chunk: String,
  embedding: [Number],
  source: String
});

const Document = mongoose.model('Document', documentSchema); // Changed model name to 'Document' for consistency

// --- Middleware ---
app.use(express.json()); // For parsing JSON request bodies

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
        embedding: embeddings[index], // Use the generated embedding
        source: file.originalname
      })).filter(doc => doc.embedding && doc.embedding.length > 0); // Ensure embedding is not empty

      allNewDocuments.push(...newDocumentsForFile);
      filesProcessed++; // Increment if at least one chunk was processed and embedded
      
    } catch (fileProcessingError) {
      console.error(`Error processing file ${file.originalname}: ${fileProcessingError.message}`);
      // Attempt to clean up the file even if processing failed
      if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
      }
    }
  } // End of for loop

  try {
    if (allNewDocuments.length > 0) {
        await Document.insertMany(allNewDocuments);
    }
    res.send({
      message: `${filesProcessed} file(s) processed and stored successfully!`,
      chunksProcessed: allNewDocuments.length,
      totalStoredChunks: await Document.countDocuments(),
    });
  } catch (dbError) {
    console.error("MongoDB Insertion Error:", dbError);
    res.status(500).send(`Error saving chunks to database: ${dbError.message}`);
  }
});

// ... (rest of the code)

// POST endpoint for queries (no authentication needed)
app.post('/query', express.json(), async (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).send('No question provided.');
  }

  try {
    const questionEmbeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-ada-002', // Consistent model with embedding generation
      input: question
    });
    const questionEmbedding = questionEmbeddingResponse.data[0].embedding;

    // Retrieve all documents (no userId filter)
    const allDocuments = await Document.find({});

    const similarities = allDocuments.map(doc => ({
      ...doc._doc,
      similarity: cosineSimilarity(questionEmbedding, doc.embedding)
    }));

    // Filter out irrelevant chunks (e.g., similarity less than a threshold)
    const relevantChunks = similarities
      .filter(doc => doc.similarity > 0.7) // Add a threshold, e.g., 0.7, adjust as needed
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5); // Increased to top 5 chunks for more context

    let context = "No relevant information found in documents.";
    if (relevantChunks.length > 0) {
        context = relevantChunks.map(doc => doc.chunk).join('\n\n'); // Use double newline for better separation
    }

    const prompt = `Based on the following context, answer the question comprehensively. If the information is not available in the context, state that clearly.\n\nContext:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;

    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-4o', // Using a more capable model like gpt-4o or gpt-3.5-turbo-0125
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500, // Increased max tokens for more detailed answers
      temperature: 0.2 // Lower temperature for more factual, less creative answers
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
    console.error("Query Error:", error);
    res.status(500).send(`Error processing query: ${error.message}`);
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});