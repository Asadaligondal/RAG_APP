import React, { useState } from 'react';
import axios from 'axios';
import './App.css'; // Assuming you still have your CSS

function App() {
  const [files, setFiles] = useState([]);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState([]);
  const [uploadStatus, setUploadStatus] = useState('');
  const [loading, setLoading] = useState(false); // To indicate processing

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
      setFiles([]); // Clear selected files after upload
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

    const currentQuestion = question; // Store question before clearing input
    setQuestion(''); // Clear input immediately
    setLoading(true);
    setChat(prevChat => [...prevChat, { question: currentQuestion, answer: 'Thinking...' }]); // Show "Thinking..."

    try {
      const response = await axios.post('/query', { question: currentQuestion }, {
        headers: { 'Content-Type': 'application/json' }
      });

      setChat(prevChat => {
        const updatedChat = [...prevChat];
        // Replace the "Thinking..." answer with the actual response
        updatedChat[updatedChat.length - 1].answer = response.data.answer;
        return updatedChat;
      });

    } catch (error) {
      console.error("Query error:", error);
      setChat(prevChat => {
        const updatedChat = [...prevChat];
        updatedChat[updatedChat.length - 1].answer = `Error: ${error.response?.data || error.message}`;
        return updatedChat;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <h2>RAG Chat</h2>
        <form onSubmit={handleFileUpload} className="upload-form">
          <input
            type="file"
            multiple
            accept=".pdf"
            onChange={(e) => setFiles(Array.from(e.target.files))}
            disabled={loading} // Disable input while loading
          />
          <button type="submit" disabled={files.length === 0 || loading}>
            Upload PDFs
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
                <div className="message ai-message">
                  <strong>AI:</strong> {entry.answer}
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
            disabled={loading} // Disable input while loading
          />
          <button type="submit" disabled={!question.trim() || loading}>Send</button>
        </form>
      </main>
    </div>
  );
}

export default App;