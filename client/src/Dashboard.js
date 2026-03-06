import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCommandPalette } from './CommandPaletteContext';
import api, { streamQuery } from './utils/api';
import { useAuth } from './AuthContext';
import { useChat } from './ChatContext';
import { useToast } from './ToastContext';
import { db } from './firebase';
import { Paperclip, Search, Lightbulb, Zap, FileText, Send, Bot, Download, Copy, RefreshCw, ThumbsUp, ThumbsDown, MessageSquare } from 'lucide-react';
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

const SourceBadges = ({ sources }) => {
  const [activeIdx, setActiveIdx] = useState(null);
  if (!sources?.length) return null;
  return (
    <div className="source-badges">
      {sources.map((src, idx) => (
        <span key={idx} className="source-badge-wrap">
          <button
            className={`source-badge ${activeIdx === idx ? 'active' : ''}`}
            onClick={() => setActiveIdx(activeIdx === idx ? null : idx)}
            title={src.source}
          >
            {idx + 1}
          </button>
          {activeIdx === idx && (
            <div className="source-popover">
              <div className="source-popover-header">
                <span className="source-popover-name">{src.source}</span>
                <span className="source-popover-score">{(src.similarity * 100).toFixed(0)}% match</span>
              </div>
              <p className="source-popover-text">{src.chunk}</p>
            </div>
          )}
        </span>
      ))}
    </div>
  );
};

function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { registerNewChat } = useCommandPalette();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentChatId, setCurrentChatId, chats, handleNewChat: contextNewChat } = useChat();
  const [files, setFiles] = useState([]);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showPDFViewer, setShowPDFViewer] = useState(false);
  const [currentPDFUrl, setCurrentPDFUrl] = useState('');
  const [currentPDFTitle, setCurrentPDFTitle] = useState('');
  const [questionsWithSources, setQuestionsWithSources] = useState([]);
  const [streamingAnswer, setStreamingAnswer] = useState(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState([]);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('docubrain-model') || 'gpt-4o');
  const [feedbackGiven, setFeedbackGiven] = useState({});
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // eslint-disable-next-line no-unused-vars
  const { startUpload, isUploading } = useUploadThing("pdfUploader", {
    onClientUploadComplete: (files) => console.log("Upload complete:", files),
    onUploadError: (error) => {
      console.error("Upload error:", error);
      toast(`Upload error: ${error.message}`, 'error');
      setLoading(false);
    },
  });

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [chat]);

  useEffect(() => {
    const chatIdFromState = location.state?.chatId;
    if (chatIdFromState) setCurrentChatId(chatIdFromState);
  }, [location.state?.chatId, setCurrentChatId]);

  useEffect(() => {
    if (!user || !currentChatId) { setSuggestedQuestions([]); return; }
    const fetchChat = async () => {
      const chatDoc = await getDoc(doc(db, 'users', user.uid, 'chats', currentChatId));
      if (chatDoc.exists()) setSuggestedQuestions(chatDoc.data().suggestedQuestions || []);
      else setSuggestedQuestions([]);
    };
    fetchChat();
  }, [user, currentChatId]);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    if (!currentChatId) { setChat([]); return; }
    // eslint-disable-next-line no-unused-vars
    const messagesRef = collection(db, 'users', user.uid, 'chats', currentChatId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
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
          if (aiMsg?.sources?.length > 0) {
            questionsData.push({ question: userMsg.text, answer: aiMsg.text, sources: aiMsg.sources });
          }
        }
      }
      setChat(transformedChat);
      setQuestionsWithSources(questionsData);
    });
    return () => unsubscribe();
  }, [user, navigate, currentChatId]);

  const handleFileUpload = async (e) => {
    if (e) e.preventDefault();
    if (files.length === 0) { toast('Please select files to upload.', 'info'); return; }
    setLoading(true);
    toast('Uploading...', 'info');
    const newChatId = `chat_${Date.now()}`;
    const fileName = files[0].name;
    try {
      const uploadedFiles = await startUpload(files);
      if (!uploadedFiles?.length) throw new Error('Upload failed');
      const pdfUrl = uploadedFiles[0].url;
      toast('Processing PDF...', 'info');
      await setDoc(doc(db, 'users', user.uid, 'chats', newChatId), {
        title: fileName, createdAt: serverTimestamp(), fileId: newChatId, pdfUrl
      });
      const response = await api.post('/upload-from-url', { pdfUrl, chatId: newChatId, fileName });
      toast(`${response.data.chunksProcessed} chunks processed.`, 'success');
      setFiles([]);
      setCurrentChatId(newChatId);
      if (response.data.suggestedQuestions?.length) setSuggestedQuestions(response.data.suggestedQuestions);
    } catch (error) {
      console.error("Upload error:", error);
      const errMsg = error.response?.data?.error || error.response?.data || error.message;
      toast(`Error: ${errMsg}`, 'error');
      if (error.response?.status === 403 && error.response?.data?.limitReached) {
        try { await deleteDoc(doc(db, 'users', user.uid, 'chats', newChatId)); } catch (_) {}
      }
    } finally { setLoading(false); }
  };

  const submitQuestion = async (questionText) => {
    if (!questionText?.trim() || !currentChatId) return;
    const currentQuestion = questionText.trim();
    setQuestion('');
    setLoading(true);
    setStreamingAnswer({ question: currentQuestion, answer: '', sources: [] });
    try {
      const msgRef = collection(db, 'users', user.uid, 'chats', currentChatId, 'messages');
      await addDoc(msgRef, { text: currentQuestion, sender: 'user', createdAt: serverTimestamp() });
      await streamQuery(currentQuestion, currentChatId, {
        model: selectedModel,
        onChunk: (content) => setStreamingAnswer(prev => prev ? { ...prev, answer: prev.answer + content } : null),
        onDone: (sources) => {
          setStreamingAnswer(prev => {
            if (prev) {
              addDoc(collection(db, 'users', user.uid, 'chats', currentChatId, 'messages'), {
                text: prev.answer, sender: 'ai', sources: sources || [], createdAt: serverTimestamp()
              }).catch(console.error);
            }
            return null;
          });
        },
        onError: (err) => {
          setStreamingAnswer(null);
          addDoc(collection(db, 'users', user.uid, 'chats', currentChatId, 'messages'), {
            text: `Error: ${err.message}`, sender: 'ai', createdAt: serverTimestamp()
          }).catch(console.error);
        }
      });
    } catch (error) {
      console.error("Query error:", error);
      setStreamingAnswer(null);
      await addDoc(collection(db, 'users', user.uid, 'chats', currentChatId, 'messages'), {
        text: `Error: ${error.message}`, sender: 'ai', createdAt: serverTimestamp()
      });
    } finally { setLoading(false); }
  };

  const handleRegenerate = async (entry) => {
    if (!currentChatId || loading || entry.loading || !entry.userMsgId) return;
    try {
      if (entry.aiMsgId) await deleteDoc(doc(db, 'users', user.uid, 'chats', currentChatId, 'messages', entry.aiMsgId));
      await deleteDoc(doc(db, 'users', user.uid, 'chats', currentChatId, 'messages', entry.userMsgId));
      await submitQuestion(entry.question);
    } catch (err) {
      console.error('Regenerate error:', err);
      toast('Failed to regenerate.', 'error');
    }
  };

  const handleCopyMessage = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Copied!', 'success'); }
    catch { toast('Failed to copy', 'error'); }
  };

  const handleFeedback = async (messageId, rating) => {
    if (!currentChatId || !messageId) return;
    try {
      await api.post('/api/feedback', { chatId: currentChatId, messageId, rating });
      setFeedbackGiven(prev => ({ ...prev, [messageId]: rating }));
      toast(rating === 'up' ? 'Thanks!' : "We'll improve", 'success');
    } catch { toast('Failed to submit feedback', 'error'); }
  };

  const handleModelChange = (e) => {
    const m = e.target.value;
    setSelectedModel(m);
    localStorage.setItem('docubrain-model', m);
  };

  const handleQuery = (e) => { e.preventDefault(); submitQuestion(question); };

  // eslint-disable-next-line no-unused-vars
  const handleClearChat = async () => {
    if (!currentChatId || !window.confirm('Clear chat history?')) return;
    try {
      const msgRef = collection(db, 'users', user.uid, 'chats', currentChatId, 'messages');
      const snapshot = await getDocs(msgRef);
      await Promise.all(snapshot.docs.map(d => deleteDoc(d.ref)));
      setChat([]);
    } catch (error) { toast('Failed to clear chat.', 'error'); }
  };

  const handleNewChat = useCallback(() => {
    contextNewChat();
    setChat([]);
    setFiles([]);
    setSuggestedQuestions([]);
  }, [contextNewChat]);

  useEffect(() => { registerNewChat(handleNewChat); }, [registerNewChat, handleNewChat]);

  const handleExportChat = () => {
    if (chat.length === 0) return;
    toast('Export started', 'success');
    const lines = chat.flatMap((entry) => ['You:', entry.question, '', 'DocuBrain:', entry.answer, '', '---', '']);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docubrain-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePreviewPDF = async () => {
    if (!currentChatId) { toast('No chat selected', 'info'); return; }
    try {
      const chatDoc = await getDoc(doc(db, 'users', user.uid, 'chats', currentChatId));
      if (chatDoc.exists()) {
        const chatData = chatDoc.data();
        if (chatData.pdfUrl) {
          setCurrentPDFUrl(chatData.pdfUrl);
          setCurrentPDFTitle(chatData.title || 'PDF Preview');
          setShowPDFViewer(true);
        } else toast('No PDF file', 'info');
      } else toast('Chat not found', 'error');
    } catch (error) { toast('Failed to load PDF', 'error'); }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'there';
  const currentChatTitle = chats.find(c => c.id === currentChatId)?.title || 'Chat';

  const suggestionCards = [
    { icon: <FileText size={20} />, title: 'Summarize', desc: 'Get key points from your PDF' },
    { icon: <Search size={20} />, title: 'Find info', desc: 'Search across your documents' },
    { icon: <Lightbulb size={20} />, title: 'Explain', desc: 'Break down complex topics' },
    { icon: <Zap size={20} />, title: 'Analyze', desc: 'Compare and cross-reference' },
  ];

  return (
    <div className="dashboard-container">
      {!currentChatId ? (
        /* ── Landing Screen ── */
        <div className="landing-screen">
          <div className="landing-hero">
            <div className="landing-icon">
              <Bot size={32} />
            </div>
            <h1 className="landing-greeting">
              {getGreeting()}, <span className="gradient-text">{displayName}</span>
            </h1>
            <p className="landing-subtitle">Upload a document and start asking questions</p>
          </div>

          <div className="suggestion-grid">
            {suggestionCards.map((card, idx) => (
              <button key={idx} className="suggestion-card" onClick={() => fileInputRef.current?.click()}>
                <div className="suggestion-card-icon">{card.icon}</div>
                <div className="suggestion-card-text">
                  <span className="suggestion-card-title">{card.title}</span>
                  <span className="suggestion-card-desc">{card.desc}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="landing-input-area">
            <div className="pill-input">
              <button type="button" className="pill-attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach PDF">
                <Paperclip size={18} />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                multiple
                accept=".pdf"
                onChange={(e) => setFiles(Array.from(e.target.files))}
                className="file-input-hidden"
              />
              {files.length > 0 ? (
                <div className="pill-file-chip">
                  <FileText size={14} />
                  <span>{files[0].name}{files.length > 1 ? ` +${files.length - 1}` : ''}</span>
                </div>
              ) : (
                <span className="pill-placeholder">Attach a PDF to get started...</span>
              )}
              <div className="pill-right">
                <select value={selectedModel} onChange={handleModelChange} className="pill-model-select">
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">4o mini</option>
                  <option value="gpt-3.5-turbo">GPT-3.5</option>
                </select>
                <button
                  type="button"
                  className="pill-send-btn"
                  onClick={handleFileUpload}
                  disabled={files.length === 0 || loading}
                  title="Upload"
                >
                  {loading ? <span className="btn-loading" /> : <Send size={18} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Chat Screen ── */
        <div className="chat-screen">
          <div className="chat-header">
            <span className="chat-header-title">{currentChatTitle}</span>
            <div className="chat-header-actions">
              <button onClick={handlePreviewPDF} className="chat-header-btn" title="View PDF">
                <FileText size={16} />
              </button>
              {chat.length > 0 && (
                <button onClick={handleExportChat} className="chat-header-btn" title="Export">
                  <Download size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="chat-messages">
            {chat.length === 0 ? (
              <div className="empty-chat">
                <div className="empty-chat-icon"><MessageSquare size={36} /></div>
                <h3>Ask anything about this document</h3>
                {suggestedQuestions.length > 0 && (
                  <div className="suggested-pills">
                    {suggestedQuestions.map((q, i) => (
                      <button key={i} className="suggested-pill" onClick={() => submitQuestion(q)} disabled={loading}>
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
                    <div className="msg msg-user">
                      <div className="msg-bubble user-bubble">{entry.question}</div>
                    </div>
                    <div className="msg msg-ai">
                      <div className="msg-ai-avatar"><Bot size={18} /></div>
                      <div className="msg-ai-content">
                        {entry.loading ? (
                          <div className="msg-body">
                            {streamingAnswer?.question === entry.question && streamingAnswer.answer ? (
                              <>{streamingAnswer.answer}<span className="streaming-cursor">▊</span></>
                            ) : (
                              <span className="typing-indicator">
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                              </span>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="msg-body">{entry.answer}</div>
                            <SourceBadges sources={entry.sources} />
                          </>
                        )}
                        {!entry.loading && (
                          <div className="msg-actions">
                            <button onClick={() => handleCopyMessage(entry.answer)} title="Copy"><Copy size={14} /></button>
                            <button
                              className={feedbackGiven[entry.aiMsgId] === 'up' ? 'active-up' : ''}
                              onClick={() => handleFeedback(entry.aiMsgId, 'up')}
                              disabled={!!feedbackGiven[entry.aiMsgId]}
                              title="Good"
                            ><ThumbsUp size={14} /></button>
                            <button
                              className={feedbackGiven[entry.aiMsgId] === 'down' ? 'active-down' : ''}
                              onClick={() => handleFeedback(entry.aiMsgId, 'down')}
                              disabled={!!feedbackGiven[entry.aiMsgId]}
                              title="Bad"
                            ><ThumbsDown size={14} /></button>
                            {index === chat.length - 1 && (
                              <button onClick={() => handleRegenerate(entry, index)} disabled={loading} title="Regenerate">
                                <RefreshCw size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                ))}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          <div className="chat-input-area">
            <form onSubmit={handleQuery} className="pill-input">
              <button type="button" className="pill-attach-btn" onClick={handlePreviewPDF} title="View PDF">
                <FileText size={18} />
              </button>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question..."
                disabled={loading}
                className="pill-text-input"
              />
              <div className="pill-right">
                <select value={selectedModel} onChange={handleModelChange} className="pill-model-select">
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">4o mini</option>
                  <option value="gpt-3.5-turbo">GPT-3.5</option>
                </select>
                <button type="submit" className="pill-send-btn" disabled={!question.trim() || loading}>
                  {loading ? <span className="btn-loading" /> : <Send size={18} />}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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