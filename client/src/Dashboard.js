import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from './AuthContext';
import { db } from './firebase';
import Sidebar from './Sidebar';
import ThemeToggle from './ThemeToggle';
import PDFViewer from './components/PDFViewer';
import { useUploadThing } from './utils/uploadthing';
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
  setDoc,
  getDoc
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showPDFViewer, setShowPDFViewer] = useState(false);
  const [currentPDFUrl, setCurrentPDFUrl] = useState('');
  const [currentPDFTitle, setCurrentPDFTitle] = useState('');
  const messagesEndRef = useRef(null);

  // UploadThing hook
  const { startUpload, isUploading } = useUploadThing("pdfUploader", {
    onClientUploadComplete: (files) => {
      console.log("Upload complete:", files);
    },
    onUploadError: (error) => {
      console.error("Upload error:", error);
      setUploadStatus(`Upload error: ${error.message}`);
      setLoading(false);
    },
  });

  // Auto-scroll to bottom when chat updates
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chat]);

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
    setUploadStatus('Uploading to UploadThing...');
    
    // Create a new chat with metadata first
    const newChatId = `chat_${Date.now()}`;
    const fileName = files[0].name; // Use first file name as title
    
    try {
      // Upload files to UploadThing
      const uploadedFiles = await startUpload(files);
      
      if (!uploadedFiles || uploadedFiles.length === 0) {
        throw new Error('Upload failed - no files returned');
      }

      const uploadedFile = uploadedFiles[0];
      const pdfUrl = uploadedFile.url;

      setUploadStatus('Processing PDF...');

      // Create chat document with pdfUrl
      await setDoc(doc(db, 'users', user.uid, 'chats', newChatId), {
        title: fileName,
        createdAt: serverTimestamp(),
        fileId: newChatId,
        pdfUrl: pdfUrl // Store UploadThing URL for preview
      });

      // Send PDF URL to backend for processing
      const response = await axios.post('/upload-from-url', {
        pdfUrl: pdfUrl,
        chatId: newChatId,
        fileName: fileName
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      setUploadStatus(
        `Uploaded ${files.length} file(s). ${response.data.chunksProcessed} chunks processed and stored.`
      );
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

  const handlePreviewPDF = async () => {
    if (!currentChatId) {
      alert('No chat selected');
      return;
    }

    try {
      // Fetch chat metadata to get pdfUrl
      const chatDoc = await getDoc(doc(db, 'users', user.uid, 'chats', currentChatId));
      if (chatDoc.exists()) {
        const chatData = chatDoc.data();
        if (chatData.pdfUrl) {
          setCurrentPDFUrl(chatData.pdfUrl);
          setCurrentPDFTitle(chatData.title || 'PDF Preview');
          setShowPDFViewer(true);
        } else {
          alert('No PDF file associated with this chat');
        }
      } else {
        alert('Chat not found');
      }
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Failed to load PDF preview');
    }
  };

  return (
    <div className="dashboard-layout">
      <ThemeToggle />
      <Sidebar 
        currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      
      {!currentChatId ? (
        // Landing Screen - ChatGPT Style
        <div className="landing-screen">
          <div className="landing-content">
            <div className="landing-center">
              <div className="logo">ChatPDF</div>
              <h1 className="landing-title">What can I help with?</h1>
              
              <div className="input-section">
                <div className="input-toolbar">
                  <button className="toolbar-btn" title="Attach files">
                    📎 Attach
                  </button>
                  <button className="toolbar-btn" title="Search">
                    🔍 Search
                  </button>
                  <button className="toolbar-btn" title="Reason">
                    💭 Reason
                  </button>
                </div>
                
                <form onSubmit={handleFileUpload} className="input-wrapper">
                  <input
                    type="file"
                    multiple
                    accept=".pdf"
                    onChange={(e) => setFiles(Array.from(e.target.files))}
                    disabled={loading}
                    id="file-input"
                    className="file-input-hidden"
                  />
                  <label htmlFor="file-input" className="input-box">
                    <span className="input-placeholder">
                      {files.length > 0 ? `${files.length} file(s) selected - Click Upload` : 'Attach PDF files...'}
                    </span>
                  </label>
                  
                  {files.length > 0 && (
                    <button type="submit" disabled={loading} className="send-btn">
                      {loading ? '⏳' : '⬆️'}
                    </button>
                  )}
                </form>
              </div>
              
              <div className="suggestion-chips">
                <div className="chip">
                  <span className="chip-icon">💡</span> Brainstorm
                </div>
                <div className="chip">
                  <span className="chip-icon">⚡</span> Code
                </div>
                <div className="chip">
                  <span className="chip-icon">📝</span> Summarize text
                </div>
                <div className="chip">
                  <span className="chip-icon">💬</span> Get advice
                </div>
                <div className="chip">
                  <span className="chip-icon">➕</span> More
                </div>
              </div>
            </div>
            
            {uploadStatus && <div className="status-message">{uploadStatus}</div>}
          </div>
        </div>
      ) : (
        // Chat Screen
        <div className="chat-screen">
          <div className="chat-messages-container">
            {chat.length === 0 ? (
              <div className="empty-chat-state">
                <div className="empty-icon">💬</div>
                <h3>How can I help you today?</h3>
                <p>Upload a document and start asking questions</p>
              </div>
            ) : (
              <>
                {chat.map((entry, index) => (
                  <React.Fragment key={index}>
                    {/* User Message */}
                    <div className="message-row user-row">
                      <div className="message-content">
                        <div className="avatar user-avatar">
                          <span>{user?.email?.charAt(0).toUpperCase()}</span>
                        </div>
                        <div className="message-text">
                          <div className="message-author">You</div>
                          <div className="message-body">{entry.question}</div>
                        </div>
                      </div>
                    </div>
                    
                    {/* AI Message */}
                    <div className="message-row ai-row">
                      <div className="message-content">
                        <div className="avatar ai-avatar">
                          <span>🤖</span>
                        </div>
                        <div className="message-text">
                          <div className="message-author">ChatPDF</div>
                          {entry.loading ? (
                            <div className="message-body">
                              <span className="typing-indicator">
                                <span className="typing-dot"></span>
                                <span className="typing-dot"></span>
                                <span className="typing-dot"></span>
                              </span>
                            </div>
                          ) : (
                            <div className="message-body">
                              {entry.answer}
                              <SourcesSection sources={entry.sources} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                ))}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
          
          {currentChatId && (
            <div className="preview-button-container">
              <button onClick={handlePreviewPDF} className="preview-pdf-btn">
                📄 Preview PDF
              </button>
            </div>
          )}
          
          <div className="chat-input-container">
            <form onSubmit={handleQuery} className="chat-input-form">
              <div className="input-wrapper-chat">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Message ChatPDF..."
                  disabled={loading}
                  className="chat-text-input"
                />
                <button 
                  type="submit" 
                  disabled={!question.trim() || loading}
                  className="chat-send-button"
                >
                  {loading ? '⏳' : '⬆️'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* PDF Viewer Modal */}
      {showPDFViewer && (
        <PDFViewer
          pdfUrl={currentPDFUrl}
          title={currentPDFTitle}
          onClose={() => setShowPDFViewer(false)}
        />
      )}
    </div>
  );
}

export default Dashboard;