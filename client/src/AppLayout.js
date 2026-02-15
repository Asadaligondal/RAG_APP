import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import AppSidebar from './AppSidebar';
import './AppLayout.css';

function AppLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    navigate('/login', { replace: true });
    return null;
  }

  return (
    <div className="app-layout">
      <AppSidebar />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

export default AppLayout;
