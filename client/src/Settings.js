import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import api from './utils/api';
import { RefreshCw, Crown, Mail, User } from 'lucide-react';
import './Settings.css';

function Settings() {
  const { user } = useAuth();
  const [usage, setUsage] = useState({
    documentsCount: 0,
    queriesCount: 0,
    documentsLimit: 5,
    queriesLimit: 50,
    plan: 'free',
    periodMonth: null
  });
  const [usageLoading, setUsageLoading] = useState(true);

  const fetchUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const res = await api.get('/api/usage');
      setUsage(res.data);
    } catch (err) {
      console.error('Failed to fetch usage:', err);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

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
          <div className="settings-section-header">
            <h2>Usage</h2>
            <button type="button" className="refresh-usage-btn" onClick={fetchUsage} disabled={usageLoading}>
              <RefreshCw size={14} className={usageLoading ? 'spin' : ''} />
              {usageLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <div className="settings-card usage-card">
            {usageLoading ? (
              <p className="settings-placeholder">Loading usage...</p>
            ) : (
              <>
                <div className="usage-plan-badge">
                  <span className="usage-plan-label">
                    {usage.plan === 'pro' ? <><Crown size={16} /> Pro</> : 'Free'} Plan
                    {usage.periodMonth && (
                      <span className="usage-period"> · {usage.periodMonth}</span>
                    )}
                  </span>
                </div>
                <div className="usage-stats">
                  <div className="usage-stat">
                    <span className="usage-value">{usage.documentsCount}<span className="usage-limit">/{usage.documentsLimit}</span></span>
                    <span className="usage-label">Documents this month</span>
                    <div className="usage-bar">
                      <div className="usage-bar-fill" style={{ width: `${Math.min(100, (usage.documentsCount / usage.documentsLimit) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="usage-stat">
                    <span className="usage-value">{usage.queriesCount}<span className="usage-limit">/{usage.queriesLimit}</span></span>
                    <span className="usage-label">Questions this month</span>
                    <div className="usage-bar">
                      <div className="usage-bar-fill" style={{ width: `${Math.min(100, (usage.queriesCount / usage.queriesLimit) * 100)}%` }} />
                    </div>
                  </div>
                </div>
                {usage.plan === 'free' && (
                  <button
                    type="button"
                    className="upgrade-pro-btn"
                    onClick={async () => {
                      try {
                        await api.post('/api/plan', { plan: 'pro' });
                        fetchUsage();
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                  >
                    Upgrade to Pro (Demo)
                  </button>
                )}
              </>
            )}
          </div>
        </section>
        <section className="settings-section">
          <h2>Profile</h2>
          <div className="settings-card">
            <div className="settings-row">
              <label><Mail size={14} /> Email</label>
              <span className="settings-value">{user?.email}</span>
            </div>
            <div className="settings-row">
              <label><User size={14} /> Account ID</label>
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
