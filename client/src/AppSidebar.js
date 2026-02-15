import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useCommandPalette } from './CommandPaletteContext';
import { LayoutDashboard, FileText, Settings, Menu, Command } from 'lucide-react';
import './AppSidebar.css';

function AppSidebar() {
  const { user, logout } = useAuth();
  const { open: openCommandPalette } = useCommandPalette();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navLinks = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/documents', label: 'Documents', icon: FileText },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <>
      <button
        className="app-sidebar-mobile-toggle"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        <Menu size={20} />
      </button>

      <aside className={`app-sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="app-sidebar-header">
          <NavLink to="/" className="app-sidebar-logo" onClick={() => setMobileOpen(false)}>
            DocuBrain
          </NavLink>
        </div>

        <nav className="app-sidebar-nav">
          <button
            type="button"
            className="app-sidebar-command-btn"
            onClick={() => { openCommandPalette(); setMobileOpen(false); }}
          >
            <Command size={18} />
            <span>Quick actions</span>
            <kbd className="app-sidebar-kbd">⌘K</kbd>
          </button>
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `app-sidebar-link ${isActive ? 'active' : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              <span className="app-sidebar-link-icon">
                {React.createElement(link.icon, { size: 20 })}
              </span>
              <span className="app-sidebar-link-label">{link.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="app-sidebar-footer">
          <div className="app-sidebar-user">
            <div className="app-sidebar-user-avatar">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
            <div className="app-sidebar-user-info">
              <span className="app-sidebar-user-email">{user?.email}</span>
              <button onClick={handleLogout} className="app-sidebar-logout">
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div className="app-sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}
    </>
  );
}

export default AppSidebar;
