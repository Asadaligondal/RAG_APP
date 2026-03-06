import React, { useState, useMemo } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useChat } from './ChatContext';
import { useCommandPalette } from './CommandPaletteContext';
import { Plus, FileText, Settings, Trash2, MessageSquare, Menu, ChevronLeft, LogOut, Search } from 'lucide-react';
import './UnifiedSidebar.css';

function UnifiedSidebar() {
  const { user, logout } = useAuth();
  const { chats, currentChatId, setCurrentChatId, handleNewChat, handleDeleteChat } = useChat();
  const { open: openCommandPalette } = useCommandPalette();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleSelectChat = (chatId) => {
    setCurrentChatId(chatId);
    if (location.pathname !== '/dashboard') navigate('/dashboard');
    setMobileOpen(false);
  };

  const handleNewChatClick = () => {
    handleNewChat();
    if (location.pathname !== '/dashboard') navigate('/dashboard');
    setMobileOpen(false);
  };

  // Group chats by date
  const groupedChats = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);

    const groups = { today: [], yesterday: [], lastWeek: [], older: [] };

    chats.forEach(chat => {
      const created = chat.createdAt?.toDate?.() || new Date(chat.createdAt);
      if (created >= today) groups.today.push(chat);
      else if (created >= yesterday) groups.yesterday.push(chat);
      else if (created >= lastWeek) groups.lastWeek.push(chat);
      else groups.older.push(chat);
    });

    return groups;
  }, [chats]);

  const renderChatGroup = (label, chatList) => {
    if (chatList.length === 0) return null;
    return (
      <div className="chat-group" key={label}>
        {!collapsed && <div className="chat-group-label">{label}</div>}
        {chatList.map(chat => (
          <div
            key={chat.id}
            className={`sidebar-chat-item ${currentChatId === chat.id ? 'active' : ''}`}
            onClick={() => handleSelectChat(chat.id)}
            title={chat.title || 'Untitled Chat'}
          >
            <MessageSquare size={16} className="sidebar-chat-icon" />
            {!collapsed && (
              <>
                <span className="sidebar-chat-title">{chat.title || 'Untitled Chat'}</span>
                <button
                  className="sidebar-chat-delete"
                  onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id); }}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <button className="sidebar-mobile-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle sidebar">
        <Menu size={20} />
      </button>

      <aside className={`unified-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-top">
          <div className="sidebar-brand">
            {!collapsed && <span className="sidebar-logo">DocuBrain</span>}
            <button
              className="sidebar-collapse-btn"
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              {collapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
            </button>
          </div>

          <button className="sidebar-new-chat" onClick={handleNewChatClick} title="New Chat">
            <Plus size={18} />
            {!collapsed && <span>New chat</span>}
          </button>

          {!collapsed && (
            <button className="sidebar-search-btn" onClick={openCommandPalette} title="Search">
              <Search size={16} />
              <span>Search</span>
              <kbd>⌘K</kbd>
            </button>
          )}
        </div>

        <div className="sidebar-chats">
          {chats.length === 0 ? (
            !collapsed && <div className="sidebar-empty">No conversations yet</div>
          ) : (
            <>
              {renderChatGroup('Today', groupedChats.today)}
              {renderChatGroup('Yesterday', groupedChats.yesterday)}
              {renderChatGroup('Previous 7 Days', groupedChats.lastWeek)}
              {renderChatGroup('Older', groupedChats.older)}
            </>
          )}
        </div>

        <div className="sidebar-bottom">
          <NavLink
            to="/documents"
            className={({ isActive }) => `sidebar-nav-link ${isActive ? 'active' : ''}`}
            onClick={() => setMobileOpen(false)}
          >
            <FileText size={18} />
            {!collapsed && <span>Documents</span>}
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `sidebar-nav-link ${isActive ? 'active' : ''}`}
            onClick={() => setMobileOpen(false)}
          >
            <Settings size={18} />
            {!collapsed && <span>Settings</span>}
          </NavLink>

          <div className="sidebar-user">
            <div className="sidebar-user-avatar">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="sidebar-user-info">
                <span className="sidebar-user-email">{user?.displayName || user?.email?.split('@')[0]}</span>
              </div>
            )}
            <button className="sidebar-logout-btn" onClick={handleLogout} title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
    </>
  );
}

export default UnifiedSidebar;
