import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { LayoutDashboard, FileText, Settings, Menu, ChevronDown } from 'lucide-react';
import './AppLayout.css';

function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!user) {
    navigate('/login', { replace: true });
    return null;
  }

  const handleLogout = async () => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
    await logout();
    navigate('/login');
  };

  const navLinks = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/documents', label: 'Documents', icon: FileText },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="app-layout">
      {/* Top Navbar */}
      <header className="app-navbar">
        <div className="navbar-inner">
          <button
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <Menu size={20} />
          </button>

          <NavLink to="/dashboard" className="navbar-logo">
            DocuBrain
          </NavLink>

          <nav className={`navbar-links ${mobileMenuOpen ? 'mobile-open' : ''}`}>
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `nav-link ${isActive ? 'active' : ''}`
                }
                onClick={() => setMobileMenuOpen(false)}
              >
                <span className="nav-link-icon">{React.createElement(link.icon, { size: 18 })}</span>
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="navbar-right">
            <div className="user-menu-wrapper">
              <button
                className="user-menu-trigger"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-expanded={userMenuOpen}
                aria-haspopup="true"
              >
                <span className="user-avatar-sm">
                  {user?.email?.charAt(0).toUpperCase()}
                </span>
                <span className="user-email-sm">{user?.email}</span>
                <ChevronDown size={14} className="dropdown-arrow" />
              </button>
              {userMenuOpen && (
                <>
                  <div
                    className="user-menu-backdrop"
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="user-menu-dropdown">
                    <div className="user-menu-header">
                      <span className="user-avatar-md">
                        {user?.email?.charAt(0).toUpperCase()}
                      </span>
                      <div className="user-menu-info">
                        <span className="user-email-md">{user?.email}</span>
                        <span className="user-label">Signed in</span>
                      </div>
                    </div>
                    <div className="user-menu-divider" />
                    <button
                      className="user-menu-item"
                      onClick={handleLogout}
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

export default AppLayout;
