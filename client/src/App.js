import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { CommandPaletteProvider } from './CommandPaletteContext';
import { ToastProvider } from './ToastContext';
import { ShortcutsHelpProvider } from './ShortcutsHelpContext';
import CommandPalette from './components/CommandPalette';
import CommandPaletteTrigger from './CommandPaletteTrigger';
import LandingPage from './LandingPage';
import AppLayout from './AppLayout';
import Dashboard from './Dashboard';
import Documents from './Documents';
import Settings from './Settings';
import Login from './Login';
import Signup from './Signup';
import './App.css';
import './Toast.css';

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <ShortcutsHelpProvider>
      <CommandPaletteProvider>
        <Router>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <CommandPaletteTrigger />
          <CommandPalette />
        </Router>
      </CommandPaletteProvider>
      </ShortcutsHelpProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;