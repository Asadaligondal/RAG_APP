import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { db } from './firebase';
import { Search, FolderOpen, FileText, Trash2, Tag, Plus, X } from 'lucide-react';
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
  const { toast } = useToast();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');
  const [tagInput, setTagInput] = useState({});

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

  // Get all unique tags across documents
  const allTags = [...new Set(documents.flatMap(d => d.tags || []))].sort();

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch = (doc.title || 'Untitled').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = !selectedTag || (doc.tags || []).includes(selectedTag);
    return matchesSearch && matchesTag;
  });

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

  const handleAddTag = async (e, chatId) => {
    e.stopPropagation();
    const tag = (tagInput[chatId] || '').trim().toLowerCase();
    if (!tag) return;
    const doc = documents.find(d => d.id === chatId);
    const currentTags = doc?.tags || [];
    if (currentTags.includes(tag)) { setTagInput(prev => ({ ...prev, [chatId]: '' })); return; }
    try {
      await api.patch(`/api/chats/${chatId}/tags`, { tags: [...currentTags, tag] });
      setTagInput(prev => ({ ...prev, [chatId]: '' }));
    } catch {
      toast('Failed to add tag', 'error');
    }
  };

  const handleRemoveTag = async (e, chatId, tagToRemove) => {
    e.stopPropagation();
    const doc = documents.find(d => d.id === chatId);
    const currentTags = (doc?.tags || []).filter(t => t !== tagToRemove);
    try {
      await api.patch(`/api/chats/${chatId}/tags`, { tags: currentTags });
    } catch {
      toast('Failed to remove tag', 'error');
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
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        {allTags.length > 0 && (
          <div className="tag-filter-bar">
            <Tag size={14} />
            <button className={`tag-filter-chip ${!selectedTag ? 'active' : ''}`} onClick={() => setSelectedTag('')}>All</button>
            {allTags.map(tag => (
              <button key={tag} className={`tag-filter-chip ${selectedTag === tag ? 'active' : ''}`} onClick={() => setSelectedTag(tag)}>{tag}</button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="documents-error">
          {error}
        </div>
      )}

      <div className="documents-content">
        {filteredDocuments.length === 0 ? (
          <div className="documents-empty">
            <div className="empty-icon"><FolderOpen size={48} /></div>
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
                  <FileText size={20} className="document-icon" />
                  <h3 className="document-title" title={doc.title || 'Untitled'}>
                    {doc.title || 'Untitled Document'}
                  </h3>
                </div>
                <div className="document-card-meta">
                  <span className="document-date">{formatDate(doc.createdAt)}</span>
                  {(doc.tags || []).length > 0 && (
                    <div className="document-tags">
                      {doc.tags.map(tag => (
                        <span key={tag} className="doc-tag">
                          {tag}
                          <button className="tag-remove-btn" onClick={(e) => handleRemoveTag(e, doc.id, tag)} title="Remove tag"><X size={10} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="add-tag-row" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      className="add-tag-input"
                      placeholder="+ tag"
                      value={tagInput[doc.id] || ''}
                      onChange={(e) => setTagInput(prev => ({ ...prev, [doc.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(e, doc.id); }}
                      maxLength={20}
                    />
                    {tagInput[doc.id] && (
                      <button className="add-tag-btn" onClick={(e) => handleAddTag(e, doc.id)}><Plus size={12} /></button>
                    )}
                  </div>
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
                    {deletingId === doc.id ? '…' : <><Trash2 size={14} /> Delete</>}
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
