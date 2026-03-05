import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCommandPalette } from './CommandPaletteContext';
import api, { streamQuery } from './utils/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { db } from './firebase';
import { Paperclip, Search, MessageCircle, Lightbulb, Zap, FileText, Plus, Upload, Send, Bot, ChevronDown, ChevronRight, Download, Copy, RefreshCw } from 'lucide-react';
import Sidebar from './Sidebar';
import EnhancedPDFViewer from './components/EnhancedPDFViewer';
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
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} View Sources ({sources.length})
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
  const { toast } = useToast();
  const { registerNewChat } = useCommandPalette();
  const navigate = useNavigate();
  const location = useLocation();
  const [files, setFiles] = useState([]);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showPDFViewer, setShowPDFViewer] = useState(false);
  const [currentPDFUrl, setCurrentPDFUrl] = useState('');
  const [currentPDFTitle, setCurrentPDFTitle] = useState('');
  const [questionsWithSources, setQuestionsWithSources] = useState([]);
  const [streamingAnswer, setStreamingAnswer] = useState(null); // { question, answer, sources }
  const [suggestedQuestions, setSuggestedQuestions] = useState([]);
  const messagesEndRef = useRef(null);

  // UploadThing hook
  // eslint-disable-next-line no-unused-vars
  const { startUpload, isUploading } = useUploadThing("pdfUploader", {
    onClientUploadComplete: (files) => {
      console.log("Upload complete:", files);
    },
    onUploadError: (error) => {
      console.error("Upload error:", error);
      toast(`Upload error: ${error.message}`, 'error');
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

  // Open specific chat when navigating from Documents page
  useEffect(() => {
    const chatIdFromState = location.state?.chatId;
    if (chatIdFromState) {
      setCurrentChatId(chatIdFromState);
    }
  }, [location.state?.chatId]);

  // Fetch suggested questions when chat is selected
  useEffect(() => {
    if (!user || !currentChatId) {
      setSuggestedQuestions([]);
      return;
    }
    const fetchChat = async () => {
      const chatDoc = await getDoc(doc(db, 'users', user.uid, 'chats', currentChatId));
      if (chatDoc.exists()) {
        setSuggestedQuestions(chatDoc.data().suggestedQuestions || []);
      } else {
        setSuggestedQuestions([]);
      }
    };
    fetchChat();
  }, [user, currentChatId]);

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
      const questionsData = [];
      
      for (let i = 0; i < messages.length; i += 2) {
        const userMsg = messages[i];
        const aiMsg = messages[i + 1];
        
        if (userMsg && userMsg.sender === 'user') {
          transformedChat.push({
            question: userMsg.text,
            answer: aiMsg?.text || 'Thinking...',
            sources: aiMsg?.sources || [],
            loading: !aiMsg,
            userMsgId: userMsg.id,
            aiMsgId: aiMsg?.id
          });
          
          // Collect questions with sources for PDF viewer
          if (aiMsg && aiMsg.sources && aiMsg.sources.length > 0) {
            questionsData.push({
              question: userMsg.text,
              answer: aiMsg.text,
              sources: aiMsg.sources
            });
          }
        }
      }
      
      setChat(transformedChat);
      setQuestionsWithSources(questionsData);
    });

    return () => unsubscribe();
  }, [user, navigate, currentChatId]);

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (files.length === 0) {
      toast('Please select files to upload.', 'info');
      return;
    }

    setLoading(true);
    toast('Uploading to UploadThing...', 'info');
    
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

      toast('Processing PDF...', 'info');

      // Create chat document with pdfUrl
      await setDoc(doc(db, 'users', user.uid, 'chats', newChatId), {
        title: fileName,
        createdAt: serverTimestamp(),
        fileId: newChatId,
        pdfUrl: pdfUrl // Store UploadThing URL for preview
      });

      // Send PDF URL to backend for processing (api adds auth token automatically)
      const response = await api.post('/upload-from-url', {
        pdfUrl: pdfUrl,
        chatId: newChatId,
        fileName: fileName
      });
      
      toast(
        `Uploaded ${files.length} file(s). ${response.data.chunksProcessed} chunks processed and stored.`,
        'success'
      );
      setFiles([]);
      setCurrentChatId(newChatId);
      if (response.data.suggestedQuestions?.length) {
        setSuggestedQuestions(response.data.suggestedQuestions);
      }
    } catch (error) {
      console.error("Upload error:", error);
      const errMsg = error.response?.data?.error || error.response?.data || error.message;
      toast(`Error: ${errMsg}`, 'error');
      if (error.response?.status === 403 && error.response?.data?.limitReached) {
        try {
          await deleteDoc(doc(db, 'users', user.uid, 'chats', newChatId));
        } catch (_) {}
      }
    } finally {
      setLoading(false);
    }
  };

  const submitQuestion = async (questionText) => {
    if (!questionText?.trim() || !currentChatId) return;
    const currentQuestion = questionText.trim();
    setQuestion('');
    setLoading(true);
    setStreamingAnswer({ question: currentQuestion, answer: '', sources: [] });

    try {
      const messagesRef = collection(db, 'users', user.uid, 'chats', currentChatId, 'messages');
      await addDoc(messagesRef, {
        text: currentQuestion,
        sender: 'user',
        createdAt: serverTimestamp()
      });

      await streamQuery(currentQuestion, currentChatId, {
        onChunk: (content) => {
          setStreamingAnswer(prev => prev ? { ...prev, answer: prev.answer + content } : null);
        },
        onDone: (sources) => {
          setStreamingAnswer(prev => {
            if (prev) {
              addDoc(messagesRef, {
                text: prev.answer,
                sender: 'ai',
                sources: sources || [],
                createdAt: serverTimestamp()
              }).catch(console.error);
            }
            return null;
          });
        },
        onError: (err) => {
          setStreamingAnswer(null);
          addDoc(messagesRef, {
            text: `Error: ${err.message}`,
            sender: 'ai',
            createdAt: serverTimestamp()
          }).catch(console.error);
        }
      });
    } catch (error) {
      console.error("Query error:", error);
      setStreamingAnswer(null);
      const messagesRef = collection(db, 'users', user.uid, 'chats', currentChatId, 'messages');
      await addDoc(messagesRef, {
        text: `Error: ${error.message}`,
        sender: 'ai',
        createdAt: serverTimestamp()
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async (entry, index) => {
    if (!currentChatId || loading || entry.loading || !entry.userMsgId) return;
    const messagesRef = collection(db, 'users', user.uid, 'chats', currentChatId, 'messages');
    try {
      if (entry.aiMsgId) {
        await deleteDoc(doc(db, 'users', user.uid, 'chats', currentChatId, 'messages', entry.aiMsgId));
      }
      await deleteDoc(doc(db, 'users', user.uid, 'chats', currentChatId, 'messages', entry.userMsgId));
      await submitQuestion(entry.question);
    } catch (err) {
      console.error('Regenerate error:', err);
      toast('Failed to regenerate. Please try again.', 'error');
    }
  };

  const handleCopyMessage = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard', 'success');
    } catch {
      toast('Failed to copy', 'error');
    }
  };

  const handleQuery = (e) => {
    e.preventDefault();
    submitQuestion(question);
  };

  // eslint-disable-next-line no-unused-vars
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
      toast('Failed to clear chat. Please try again.', 'error');
    }
  };

  const handleSelectChat = (chatId) => {
    setCurrentChatId(chatId);
  };

  const handleNewChat = useCallback(() => {
    setCurrentChatId(null);
    setChat([]);
    setFiles([]);
    setSuggestedQuestions([]);
  }, []);

  useEffect(() => {
    registerNewChat(handleNewChat);
  }, [registerNewChat, handleNewChat]);

  const handleExportChat = () => {
    if (chat.length === 0) return;
    toast('Export started', 'success');
    const lines = chat.flatMap((entry) => [
      'You:',
      entry.question,
      '',
      'DocuBrain:',
      entry.answer,
      '',
      '---',
      '',
    ]);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docubrain-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePreviewPDF = async () => {
    if (!currentChatId) {
      toast('No chat selected', 'info');
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
          toast('No PDF file associated with this chat', 'info');
        }
      } else {
        toast('Chat not found', 'error');
      }
    } catch (error) {
      console.error('Error loading PDF:', error);
      toast('Failed to load PDF preview', 'error');
    }
  };

  return (
    <div className="dashboard-layout">
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
              <h1 className="landing-title">What can I help with?</h1>
              
              <div className="input-section">
                <div className="input-toolbar">
                  <button className="toolbar-btn" title="Attach files">
                    <Paperclip size={16} /> Attach
                  </button>
                  <button className="toolbar-btn" title="Search">
                    <Search size={16} /> Search
                  </button>
                  <button className="toolbar-btn" title="Reason">
                    <MessageCircle size={16} /> Reason
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
                      {loading ? <span className="btn-loading" /> : <Upload size={18} />}
                    </button>
                  )}
                </form>
              </div>
              
              <div className="suggestion-chips">
                <div className="chip">
                  <Lightbulb size={16} className="chip-icon" /> Brainstorm
                </div>
                <div className="chip">
                  <Zap size={16} className="chip-icon" /> Code
                </div>
                <div className="chip">
                  <FileText size={16} className="chip-icon" /> Summarize text
                </div>
                <div className="chip">
                  <MessageCircle size={16} className="chip-icon" /> Get advice
                </div>
                <div className="chip">
                  <Plus size={16} className="chip-icon" /> More
                </div>
              </div>
            </div>
            
          </div>
        </div>
      ) : (
        // Chat Screen
        <div className="chat-screen">
          <div className="chat-messages-container">
            {chat.length === 0 ? (
              <div className="empty-chat-state">
                <div className="empty-icon"><MessageCircle size={40} /></div>
                <h3>How can I help you today?</h3>
                <p>Ask a question about your document, or try one of these:</p>
                {suggestedQuestions.length > 0 && (
                  <div className="suggested-questions">
                    {suggestedQuestions.map((q, i) => (
                      <button
                        key={i}
                        className="suggestion-chip"
                        onClick={() => submitQuestion(q)}
                        disabled={loading}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
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
                          <Bot size={20} />
                        </div>
                        <div className="message-text">
                          <div className="message-author-row">
                            <span className="message-author">DocuBrain</span>
                            {!entry.loading && (
                              <div className="message-actions">
                                <button
                                  className="msg-action-btn"
                                  onClick={() => handleCopyMessage(entry.answer)}
                                  title="Copy"
                                >
                                  <Copy size={14} />
                                </button>
                                {index === chat.length - 1 && (
                                  <button
                                    className="msg-action-btn"
                                    onClick={() => handleRegenerate(entry, index)}
                                    disabled={loading}
                                    title="Regenerate"
                                  >
                                    <RefreshCw size={14} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          {entry.loading ? (
                            <div className="message-body">
                              {streamingAnswer?.question === entry.question && streamingAnswer.answer ? (
                                <>
                                  {streamingAnswer.answer}
                                  <span className="streaming-cursor">▊</span>
                                </>
                              ) : (
                                <span className="typing-indicator">
                                  <span className="typing-dot"></span>
                                  <span className="typing-dot"></span>
                                  <span className="typing-dot"></span>
                                </span>
                              )}
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
                <FileText size={16} /> Preview PDF
              </button>
              {chat.length > 0 && (
                <button onClick={handleExportChat} className="preview-pdf-btn export-chat-btn">
                  <Download size={16} /> Export Chat
                </button>
              )}
            </div>
          )}
          
          <div className="chat-input-container">
            <form onSubmit={handleQuery} className="chat-input-form">
              <div className="input-wrapper-chat">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Message DocuBrain..."
                  disabled={loading}
                  className="chat-text-input"
                />
                <button 
                  type="submit" 
                  disabled={!question.trim() || loading}
                  className="chat-send-button"
                >
                  {loading ? <span className="btn-loading" /> : <Send size={18} />}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Enhanced PDF Viewer Modal */}
      {showPDFViewer && (
        <EnhancedPDFViewer
          pdfUrl={currentPDFUrl}
          title={currentPDFTitle}
          questions={questionsWithSources}
          onClose={() => setShowPDFViewer(false)}
        />
      )}
    </div>
  );
}

export default Dashboard;