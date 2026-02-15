import React, { useState, useEffect } from 'react';
import api from './utils/api';
import { useAuth } from './AuthContext';
import { db } from './firebase';
import { Menu, ChevronLeft, ChevronRight, Plus, FileText, Trash2 } from 'lucide-react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot
} from 'firebase/firestore';
import './Sidebar.css';

function Sidebar({ currentChatId, onSelectChat, onNewChat, isCollapsed, onToggleCollapse }) {
  const { user } = useAuth();
  const [chats, setChats] = useState([]);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    if (!user) return;

    const chatsRef = collection(db, 'users', user.uid, 'chats');
    const q = query(chatsRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatsList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setChats(chatsList);
    });

    return () => unsubscribe();
  }, [user]);

  const handleDeleteChat = async (e, chatId) => {
    e.stopPropagation();
    if (!window.confirm('Delete this chat and its document?')) return;

    try {
      await api.delete(`/api/chats/${chatId}`);
      if (currentChatId === chatId) {
        onNewChat();
      }
    } catch (error) {
      console.error('Error deleting chat:', error);
      alert('Failed to delete. Please try again.');
    }
  };

  return (
    <>
      {/* Mobile hamburger button */}
      <button 
        className="mobile-menu-btn"
        onClick={() => setIsMobileOpen(!isMobileOpen)}
        aria-label="Toggle sidebar"
      >
        <Menu size={20} />
      </button>

      {/* Sidebar */}
      <aside className={`sidebar-nav ${isMobileOpen ? 'mobile-open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
        <button className="collapse-btn" onClick={onToggleCollapse} title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        
        <div className="sidebar-header">
          <span className="sidebar-section-label">{isCollapsed ? '' : 'Chats'}</span>
          <button className="new-chat-btn" onClick={onNewChat}>
            <Plus size={18} /> {!isCollapsed && 'New Chat'}
          </button>
        </div>

        <div className="chats-list">
          {chats.length === 0 ? (
            <div className="empty-chats">No chats yet</div>
          ) : (
            chats.map(chat => (
              <div
                key={chat.id}
                className={`chat-item ${currentChatId === chat.id ? 'active' : ''}`}
                onClick={() => {
                  onSelectChat(chat.id);
                  setIsMobileOpen(false);
                }}
              >
                <div className="chat-item-content">
                  <FileText size={16} className="chat-icon" />
                  <span className="chat-title">{chat.title || 'Untitled Chat'}</span>
                </div>
                <button
                  className="delete-chat-btn"
                  onClick={(e) => handleDeleteChat(e, chat.id)}
                  title="Delete chat"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <div 
          className="mobile-overlay"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
    </>
  );
}

export default Sidebar;