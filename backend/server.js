const express = require('express');
const multer = require('multer');
const fs = require('fs');
const pdf = require('pdf-parse');
const { OpenAI } = require('openai');
require('dotenv').config();
const app = express();
const port = 3000;

// Initialize OpenAI with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// In-memory storage with persistence
const DOCUMENTS_FILE = 'documents.json';
let documents = [];

// Load existing documents from file on startup
if (fs.existsSync(DOCUMENTS_FILE)) {
  const fileData = fs.readFileSync(DOCUMENTS_FILE, 'utf8');
  documents = JSON.parse(fileData);
}

// Ensure uploads folder exists
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

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
    start += chunkSize - chunkOverlap;
  }
  return chunks;
}

// Cosine similarity function
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (normA * normB) || 0;
}

// Save documents to file
function saveDocuments() {
  fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(documents, null, 2), 'utf8');
}

app.get('/', (req, res) => {
  res.send('Welcome to the RAG Web App!');
});

app.post('/upload', upload.array('pdf'), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send('No files uploaded.');
  }

  try {
    const allNewDocuments = [];
    for (const file of req.files) {
      const filePath = `${uploadDir}${file.originalname}`;
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer);
      const extractedText = pdfData.text;
      const chunks = splitText(extractedText, 100, 20);
      const embeddings = await Promise.all(
        chunks.map(async (chunk) => {
          const response = await openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input: chunk
          });
          return response.data[0].embedding;
        })
      );
      const newDocuments = chunks.map((chunk, index) => ({
        chunk: chunk,
        embedding: embeddings[index],
        source: file.originalname
      }));
      allNewDocuments.push(...newDocuments);
    }
    documents = [...documents, ...allNewDocuments];
    saveDocuments(); // Save to file after updating

    res.send({
      message: `${req.files.length} file(s) uploaded successfully!`,
      chunkCount: allNewDocuments.length,
      totalStoredChunks: documents.length,
      data: allNewDocuments
    });
  } catch (error) {
    res.status(500).send(`Error processing PDFs: ${error.message}`);
  }
});

app.post('/query', express.json(), async (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).send('No question provided.');
  }

  try {
    const questionEmbeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: question
    });
    const questionEmbedding = questionEmbeddingResponse.data[0].embedding;

    const similarities = documents.map(doc => ({
      ...doc,
      similarity: cosineSimilarity(questionEmbedding, doc.embedding)
    }));
    const topChunks = similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    const context = topChunks.map(doc => doc.chunk).join('\n');
    const prompt = `Using the following context, answer the question:\n\nContext:\n${context}\n\nQuestion: ${question}`;

    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150
    });
    const answer = chatResponse.choices[0].message.content;

    res.send({
      question: question,
      answer: answer,
      relevantChunks: topChunks.map(doc => ({
        chunk: doc.chunk,
        source: doc.source,
        similarity: doc.similarity
      }))
    });
  } catch (error) {
    res.status(500).send(`Error processing query: ${error.message}`);
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});