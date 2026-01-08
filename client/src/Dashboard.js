import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from './AuthContext';
import { db } from './firebase';
import Sidebar from './Sidebar';
import { extractImagesAndUpload } from './utils/pdf-extractor';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp,
  deleteDoc,
  getDocs,
  doc,
  setDoc
} from 'firebase/firestore';
import './Dashboard.css';

const SourcesSection = ({ sources }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!sources || sources.length === 0) return null;
  
  return (
    <div className="sources-wrapper">
      <button 
        className="view-sources-btn"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? '▼' : '▶'} View Sources ({sources.length})
      </button>
      {isExpanded && (
        <div className="sources-content">
          {sources.map((source, idx) => (
            <div key={idx} className="source-item">
              <div className="source-header">
                <span className="source-filename">{source.source}</span>
                <span className="source-similarity">{(source.similarity * 100).toFixed(1)}% match</span>
              </div>
              <blockquote className="source-text">
                {source.chunk}
              </blockquote>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState([]);
  const [uploadStatus, setUploadStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentChatId, setCurrentChatId] = useState(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (!currentChatId) {
      setChat([]);
      return;
    }

    // Set up real-time listener for chat messages
    const messagesRef = collection(db, 'users', user.uid, 'chats', currentChatId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Transform Firestore messages to chat format
      const transformedChat = [];
      for (let i = 0; i < messages.length; i += 2) {
        const userMsg = messages[i];
        const aiMsg = messages[i + 1];
        
        if (userMsg && userMsg.sender === 'user') {
          transformedChat.push({
            question: userMsg.text,
            answer: aiMsg?.text || 'Thinking...',
            sources: aiMsg?.sources || [],
            loading: !aiMsg
          });
        }
      }
      
      setChat(transformedChat);
    });

    return () => unsubscribe();
  }, [user, navigate, currentChatId]);

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (files.length === 0) {
      setUploadStatus('Please select files to upload.');
      return;
    }

    setLoading(true);
    setUploadStatus('Uploading and processing...');
    
    // Create a new chat with metadata first
    const newChatId = `chat_${Date.now()}`;
    const fileName = files[0].name; // Use first file name as title
    
    try {
      await setDoc(doc(db, 'users', user.uid, 'chats', newChatId), {
        title: fileName,
        createdAt: serverTimestamp(),
        fileId: newChatId // Link to document vectors
      });
      
      // ✨ STEP 1: Extract images from PDF(s) and upload to Firebase Storage
      console.log('=== Starting PDF Image Extraction ===');
      const allExtractedImages = [];
      
      for (const file of files) {
        if (file.type === 'application/pdf') {
          setUploadStatus(`Extracting images from ${file.name}...`);
          try {
            const images = await extractImagesAndUpload(file, newChatId);
            allExtractedImages.push(...images);
            console.log(`✅ Extracted ${images.length} images from ${file.name}`);
          } catch (extractError) {
            console.error(`Error extracting images from ${file.name}:`, extractError);
            // Continue even if extraction fails
          }
        }
      }
      
      console.log('=== Image Extraction Complete ===');
      console.log('📸 Total extracted images:', allExtractedImages.length);
      console.log('Image URLs:', allExtractedImages.map(img => ({
        url: img.imageUrl,
        page: img.pageNumber,
        path: img.storagePath
      })));
      
      // ✨ STEP 2: Upload PDFs to backend for text processing
      setUploadStatus('Processing text content...');
      
      const formData = new FormData();
      files.forEach(file => formData.append('pdf', file));
      formData.append('chatId', newChatId); // Send chatId to backend

      const response = await axios.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      const successMessage = `Uploaded ${files.length} file(s). ${response.data.chunksProcessed} chunks processed and stored.`;
      const imageMessage = allExtractedImages.length > 0 
        ? ` 📸 Extracted ${allExtractedImages.length} images.`
        : '';
      
      setUploadStatus(successMessage + imageMessage);
      setFiles([]);
      setCurrentChatId(newChatId); // Switch to new chat
    } catch (error) {
      console.error("Upload error:", error);
      setUploadStatus(`Error: ${error.response?.data || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async (e) => {
    e.preventDefault();
    if (!question.trim() || !currentChatId) return;

    const currentQuestion = question;
    setQuestion('');
    setLoading(true);

    try {
      // Save user message to Firestore
      const messagesRef = collection(db, 'users', user.uid, 'chats', currentChatId, 'messages');
      await addDoc(messagesRef, {
        text: currentQuestion,
        sender: 'user',
        createdAt: serverTimestamp()
      });

      // Call backend API for AI response
      const response = await axios.post('/query', { 
        question: currentQuestion,
        chatId: currentChatId // Send chatId to backend
      }, {
        headers: { 'Content-Type': 'application/json' }
      });

      // Save AI response to Firestore with sources
      await addDoc(messagesRef, {
        text: response.data.answer,
        sender: 'ai',
        sources: response.data.relevantChunks || [],
        createdAt: serverTimestamp()
      });

    } catch (error) {
      console.error("Query error:", error);
      
      // Save error message to Firestore
      const messagesRef = collection(db, 'users', user.uid, 'chats', currentChatId, 'messages');
      await addDoc(messagesRef, {
        text: `Error: ${error.response?.data || error.message}`,
        sender: 'ai',
        createdAt: serverTimestamp()
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClearChat = async () => {
    if (!currentChatId || !window.confirm('Are you sure you want to clear the chat history?')) {
      return;
    }

    try {
      const messagesRef = collection(db, 'users', user.uid, 'chats', currentChatId, 'messages');
      const snapshot = await getDocs(messagesRef);
      
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      
      setChat([]);
    } catch (error) {
      console.error('Error clearing chat:', error);
      alert('Failed to clear chat. Please try again.');
    }
  };

  const handleSelectChat = (chatId) => {
    setCurrentChatId(chatId);
  };

  const handleNewChat = () => {
    setCurrentChatId(null);
    setChat([]);
    setFiles([]);
    setUploadStatus('');
  };

  return (
    <div className="dashboard-layout">
      <Sidebar 
        currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
      />
      
      {!currentChatId ? (
        // Upload Screen
        <div className="upload-screen">
          <div className="upload-content">
            <h1 className="upload-title">Start a New Chat</h1>
            <p className="upload-subtitle">Upload a PDF document to begin chatting with it</p>
            
            <form onSubmit={handleFileUpload} className="upload-form-main">
              <div className="file-input-wrapper">
                <input
                  type="file"
                  multiple
                  accept=".pdf"
                  onChange={(e) => setFiles(Array.from(e.target.files))}
                  disabled={loading}
                  id="file-input"
                  className="file-input"
                />
                <label htmlFor="file-input" className="file-input-label">
                  📁 Choose PDF Files
                </label>
              </div>
              
              {files.length > 0 && (
                <div className="selected-files-main">
                  <h4>Selected Files:</h4>
                  <ul>
                    {files.map((file, index) => (
                      <li key={index}>{file.name}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <button type="submit" disabled={files.length === 0 || loading} className="upload-btn-main">
                {loading ? 'Uploading...' : 'Upload & Start Chat'}
              </button>
              
              {uploadStatus && <p className="upload-status-main">{uploadStatus}</p>}
            </form>
          </div>
        </div>
      ) : (
        // Chat Screen
        <div className="chat-screen">
          <div className="chat-header">
            <h3>Ask your documents!</h3>
            <button 
              onClick={handleClearChat} 
              className="clear-chat-btn"
              title="Clear chat history"
            >
              🗑️ Clear Chat
            </button>
          </div>
          
          <div className="chat-messages">
            {chat.length === 0 ? (
              <div className="empty-chat">Start asking questions about your uploaded documents!</div>
            ) : (
              chat.map((entry, index) => (
                <div key={index} className="message-group">
                  <div className="message user-message">
                    <strong>You:</strong> {entry.question}
                  </div>
                  <div className={`message ai-message ${entry.loading ? 'loading' : ''}`}>
                    <strong>AI:</strong> 
                    {entry.loading ? (
                      <span className="thinking-indicator">
                        <span className="dot"></span>
                        <span className="dot"></span>
                        <span className="dot"></span>
                        Thinking...
                      </span>
                    ) : (
                      <>
                        {entry.answer}
                        <SourcesSection sources={entry.sources} />
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          
          <form onSubmit={handleQuery} className="chat-input">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question about your documents..."
              disabled={loading}
            />
            <button type="submit" disabled={!question.trim() || loading}>
              {loading ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default Dashboard;