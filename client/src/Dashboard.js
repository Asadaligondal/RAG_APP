import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from './AuthContext';
import { db } from './firebase';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp,
  deleteDoc,
  getDocs
} from 'firebase/firestore';
import './Dashboard.css';

function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState([]);
  const [uploadStatus, setUploadStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const chatId = 'default-chat'; // Using a default chat ID for simplicity

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    // Set up real-time listener for chat messages
    const messagesRef = collection(db, 'users', user.uid, 'chats', chatId, 'messages');
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
            loading: !aiMsg
          });
        }
      }
      
      setChat(transformedChat);
    });

    return () => unsubscribe();
  }, [user, navigate, chatId]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (files.length === 0) {
      setUploadStatus('Please select files to upload.');
      return;
    }

    setLoading(true);
    setUploadStatus('Uploading and processing...');
    const formData = new FormData();
    files.forEach(file => formData.append('pdf', file));

    try {
      const response = await axios.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setUploadStatus(
        `Uploaded ${files.length} file(s). ${response.data.chunksProcessed} chunks processed and stored.`
      );
      setFiles([]);
    } catch (error) {
      console.error("Upload error:", error);
      setUploadStatus(`Error: ${error.response?.data || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;

    const currentQuestion = question;
    setQuestion('');
    setLoading(true);

    try {
      // Save user message to Firestore
      const messagesRef = collection(db, 'users', user.uid, 'chats', chatId, 'messages');
      await addDoc(messagesRef, {
        text: currentQuestion,
        sender: 'user',
        createdAt: serverTimestamp()
      });

      // Call backend API for AI response
      const response = await axios.post('/query', { question: currentQuestion }, {
        headers: { 'Content-Type': 'application/json' }
      });

      // Save AI response to Firestore
      await addDoc(messagesRef, {
        text: response.data.answer,
        sender: 'ai',
        createdAt: serverTimestamp()
      });

    } catch (error) {
      console.error("Query error:", error);
      
      // Save error message to Firestore
      const messagesRef = collection(db, 'users', user.uid, 'chats', chatId, 'messages');
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
    if (!window.confirm('Are you sure you want to clear the chat history?')) {
      return;
    }

    try {
      const messagesRef = collection(db, 'users', user.uid, 'chats', chatId, 'messages');
      const snapshot = await getDocs(messagesRef);
      
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      
      setChat([]);
    } catch (error) {
      console.error('Error clearing chat:', error);
      alert('Failed to clear chat. Please try again.');
    }
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <h2>RAG Chat</h2>
        <div className="user-info">
          <p className="welcome-text">Welcome,</p>
          <p className="user-email">{user?.email}</p>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
        <form onSubmit={handleFileUpload} className="upload-form">
          <input
            type="file"
            multiple
            accept=".pdf"
            onChange={(e) => setFiles(Array.from(e.target.files))}
            disabled={loading}
          />
          <button type="submit" disabled={files.length === 0 || loading}>
            {loading ? 'Uploading...' : 'Upload PDFs'}
          </button>
        </form>
        <p className="upload-status">{uploadStatus}</p>
        {files.length > 0 && (
          <div className="selected-files">
            <h4>Selected for Upload:</h4>
            <ul>
              {files.map((file, index) => (
                <li key={index}>{file.name}</li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <main className="chat-container">
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
            <div className="empty-chat">Start by uploading PDFs and asking a question!</div>
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
                    entry.answer
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
      </main>
    </div>
  );
}

export default Dashboard;