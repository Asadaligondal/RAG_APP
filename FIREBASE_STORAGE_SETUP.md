# PDF Image Extraction - Firebase Storage Setup

## Step 1: Enable Firebase Storage (REQUIRED FIRST!)

Your bucket doesn't exist because Storage hasn't been enabled yet.

### Instructions:
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **rag-based-chatbot-d1810**
3. In the left sidebar, click **Build** > **Storage**
4. Click **Get Started**
5. Choose **Start in test mode** (we'll add security rules next)
6. Select a location (e.g., `us-central1` or closest to you)
7. Click **Done**

Your bucket will now be created: `rag-based-chatbot-d1810.appspot.com`

---

## Step 2: Configure Storage Security Rules

Add these rules to your Firebase Console under Storage > Rules:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Allow authenticated users to read/write their chat images
    match /chat-images/{chatId}/{imageFile} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
      allow delete: if request.auth != null;
    }
  }
}
```

### Instructions:
1. In Firebase Console, go to **Storage** > **Rules** tab
2. Replace existing rules with the rules above
3. Click **Publish**

---

## Step 3: Configure CORS (CRITICAL!)

Firebase Storage blocks localhost requests by default. You MUST configure CORS **AFTER enabling Storage**.

### ⚠️ IMPORTANT: Make sure you're in the correct Google Cloud project!

Your error showed you were in `spring-monolith-483201-q4` but need to be in `rag-based-chatbot-d1810`.

### Using Google Cloud Shell:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. **Switch to the correct project:**
   - Click the project dropdown at the top
   - Find and select: **rag-based-chatbot-d1810**
3. Click the **Cloud Shell** icon (top right, terminal icon)
4. Verify you're in the right project (the prompt should show your project ID)
5. Run these commands:

```bash
# Create CORS config
cat > cors.json << 'EOF'
[
  {
    "origin": ["http://localhost:3000", "http://localhost:3001", "https://rag-based-chatbot-d1810.firebaseapp.com"],
    "method": ["GET", "POST", "PUT", "DELETE", "HEAD"],
    "maxAgeSeconds": 3600,
    "responseHeader": ["Content-Type", "Authorization", "Content-Length", "User-Agent", "X-Requested-With"]
  }
]
EOF

# Apply CORS to your bucket
gsutil cors set cors.json gs://rag-based-chatbot-d1810.appspot.com

# Verify it worked
gsutil cors get gs://rag-based-chatbot-d1810.appspot.com
```

You should see the CORS configuration output (not a 404 error).

---
gsutil cors set cors.json gs://rag-based-chatbot-d1810.appspot.com
```

6. Verify CORS configuration:

```bash
gsutil cors get gs://rag-based-chatbot-d1810.appspot.com
```

### Option C: Using gsutil CLI (If installed locally)

If you have Google Cloud SDK installed:

```bash
# Navigate to the project folder
cd C:\Users\asad\Downloads\Idea1\RAG_APP

# Apply CORS configuration
gsutil cors set storage-cors.json gs://rag-based-chatbot-d1810.appspot.com
```

---

## Step 3: Verify Setup

1. Restart your React development server
2. Upload a PDF with charts/graphs
3. Open Browser Console (F12)
4. You should see successful Firebase Storage uploads (no CORS errors)

---

- Images are stored at: `chat-images/{chatId}/page-{pageNumber}.png`
- Only authenticated users can access the images
- Each chat's images are isolated by chatId
- Images are automatically extracted when PDFs are uploaded
- Image URLs are logged to console for verification

## Testing

1. Upload a PDF with charts/graphs in the Dashboard
2. Open Browser Console (F12)
3. Look for logs starting with `[PDF Extractor]`
4. You should see:
   - "Starting extraction for {filename}"
   - "PDF loaded. Total pages: X"
   - "Processing page X/Y"
   - "✅ Extracted N images from {filename}"
   - Image URLs array with Firebase Storage links

## File Structure

```
chat-images/
  ├── chat_1234567890/
  │   ├── page-1.png
  │   ├── page-2.png
  │   └── page-3.png
  └── chat_9876543210/
      ├── page-1.png
      └── page-2.png
```

## Next Steps (Future Implementation)

1. Send extracted image URLs to backend along with text chunks
2. Use OpenAI Vision API to analyze chart/graph images
3. Include image analysis in RAG context
4. Display images in chat when relevant to query
