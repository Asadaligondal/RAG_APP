import React from 'react';
import { useAuth } from './AuthContext';
import './Settings.css';

function Settings() {
  const { user } = useAuth();

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        <p className="settings-subtitle">
          Manage your account and preferences
        </p>
      </div>
      <div className="settings-content">
        <section className="settings-section">
          <h2>Profile</h2>
          <div className="settings-card">
            <div className="settings-row">
              <label>Email</label>
              <span className="settings-value">{user?.email}</span>
            </div>
            <div className="settings-row">
              <label>Account ID</label>
              <span className="settings-value settings-value-mono">
                {user?.uid?.slice(0, 12)}...
              </span>
            </div>
          </div>
        </section>
        <section className="settings-section">
          <h2>Preferences</h2>
          <div className="settings-card">
            <p className="settings-placeholder">
              Theme, notifications, and other preferences will be available here.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Settings;
