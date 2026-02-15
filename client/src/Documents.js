import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { db } from './firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import api from './utils/api';
import './Documents.css';


function Documents() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;

    const chatsRef = collection(db, 'users', user.uid, 'chats');
    const q = query(chatsRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || new Date(),
      }));
      setDocuments(docs);
    });

    return () => unsubscribe();
  }, [user]);

  const filteredDocuments = documents.filter((doc) =>
    (doc.title || 'Untitled').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (date) => {
    if (!date) return '—';
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString();
  };

  const handleOpen = (chatId) => {
    navigate('/dashboard', { state: { chatId } });
  };

  const handleDelete = async (e, chatId) => {
    e.stopPropagation();
    if (!window.confirm('Delete this document and all its chat history? This cannot be undone.')) {
      return;
    }

    setDeletingId(chatId);
    setError('');

    try {
      await api.delete(`/api/chats/${chatId}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete');
      setDeletingId(null);
    }
  };

  return (
    <div className="documents-page">
      <div className="documents-header">
        <h1>Documents</h1>
        <p className="documents-subtitle">
          Manage all your uploaded documents in one place
        </p>
        <div className="documents-search">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      {error && (
        <div className="documents-error">
          {error}
        </div>
      )}

      <div className="documents-content">
        {filteredDocuments.length === 0 ? (
          <div className="documents-empty">
            <div className="empty-icon">📁</div>
            <h2>
              {searchQuery ? 'No documents match your search' : 'No documents yet'}
            </h2>
            <p>
              {searchQuery
                ? 'Try a different search term'
                : 'Upload a PDF from the Dashboard to get started'}
            </p>
            {!searchQuery && (
              <button
                className="empty-cta"
                onClick={() => navigate('/dashboard')}
              >
                Go to Dashboard
              </button>
            )}
          </div>
        ) : (
          <div className="documents-grid">
            {filteredDocuments.map((doc) => (
              <div
                key={doc.id}
                className="document-card"
                onClick={() => handleOpen(doc.id)}
              >
                <div className="document-card-header">
                  <span className="document-icon">📄</span>
                  <h3 className="document-title" title={doc.title || 'Untitled'}>
                    {doc.title || 'Untitled Document'}
                  </h3>
                </div>
                <div className="document-card-meta">
                  <span className="document-date">{formatDate(doc.createdAt)}</span>
                </div>
                <div className="document-card-actions">
                  <button
                    className="doc-btn doc-btn-open"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpen(doc.id);
                    }}
                  >
                    Open
                  </button>
                  <button
                    className="doc-btn doc-btn-delete"
                    onClick={(e) => handleDelete(e, doc.id)}
                    disabled={deletingId === doc.id}
                    title="Delete document"
                  >
                    {deletingId === doc.id ? '…' : '🗑️ Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Documents;
