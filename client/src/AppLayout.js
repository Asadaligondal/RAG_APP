import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { ChatProvider } from './ChatContext';
import UnifiedSidebar from './UnifiedSidebar';
import './AppLayout.css';

function AppLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    navigate('/login', { replace: true });
    return null;
  }

  return (
    <ChatProvider>
      <div className="app-layout">
        <UnifiedSidebar />
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </ChatProvider>
  );
}

export default AppLayout;
