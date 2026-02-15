import React, { useState, useEffect } from 'react';
import api from './utils/api';
import { useAuth } from './AuthContext';
import { db } from './firebase';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot
} from 'firebase/firestore';
import './Sidebar.css';

function Sidebar({ currentChatId, onSelectChat, onNewChat, isCollapsed, onToggleCollapse }) {
  const { user, logout } = useAuth();
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

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <>
      {/* Mobile hamburger button */}
      <button 
        className="mobile-menu-btn"
        onClick={() => setIsMobileOpen(!isMobileOpen)}
      >
        ☰
      </button>

      {/* Sidebar */}
      <aside className={`sidebar-nav ${isMobileOpen ? 'mobile-open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
        <button className="collapse-btn" onClick={onToggleCollapse} title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {isCollapsed ? '▶' : '◀'}
        </button>
        
        <div className="sidebar-header">
          <h2 className="sidebar-logo">{isCollapsed ? 'DB' : 'DocuBrain'}</h2>
          <button className="new-chat-btn" onClick={onNewChat}>
            <span className="plus-icon">+</span> {!isCollapsed && 'New Chat'}
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
                  <span className="chat-icon">📄</span>
                  <span className="chat-title">{chat.title || 'Untitled Chat'}</span>
                </div>
                <button
                  className="delete-chat-btn"
                  onClick={(e) => handleDeleteChat(e, chat.id)}
                  title="Delete chat"
                >
                  🗑️
                </button>
              </div>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
            <div className="user-details">
              <div className="user-email">{user?.email}</div>
              <button onClick={handleLogout} className="logout-link">
                Logout
              </button>
            </div>
          </div>
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