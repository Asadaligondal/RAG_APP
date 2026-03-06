import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import api from './utils/api';
import { RefreshCw, Crown, Mail, User, Sun, Moon, Key, Plus, Trash2, Copy, Activity } from 'lucide-react';
import './Settings.css';

function Settings() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [usage, setUsage] = useState({
    documentsCount: 0,
    queriesCount: 0,
    documentsLimit: 5,
    queriesLimit: 50,
    plan: 'free',
    periodMonth: null
  });
  const [usageLoading, setUsageLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyResult, setNewKeyResult] = useState(null);
  const [analytics, setAnalytics] = useState(null);

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

  const fetchApiKeys = useCallback(async () => {
    try {
      const res = await api.get('/api/keys');
      setApiKeys(res.data.keys || []);
    } catch (_) {}
  }, []);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await api.get('/api/analytics');
      setAnalytics(res.data);
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchUsage();
    fetchApiKeys();
    fetchAnalytics();
  }, [fetchUsage, fetchApiKeys, fetchAnalytics]);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    try {
      const res = await api.post('/api/keys', { name: newKeyName.trim() });
      setNewKeyResult(res.data);
      setNewKeyName('');
      fetchApiKeys();
    } catch (err) {
      console.error('Failed to create key:', err);
    }
  };

  const handleRevokeKey = async (keyId) => {
    if (!window.confirm('Revoke this API key? This cannot be undone.')) return;
    try {
      await api.delete(`/api/keys/${keyId}`);
      fetchApiKeys();
    } catch (_) {}
  };

  const copyToClipboard = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch (_) {}
  };

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
            <div className="settings-row">
              <label>{theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />} Theme</label>
              <button className="theme-toggle-btn" onClick={toggleTheme}>
                {theme === 'dark' ? <><Sun size={14} /> Switch to Light</> : <><Moon size={14} /> Switch to Dark</>}
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2><Key size={18} /> API Keys</h2>
          <p className="settings-hint">Use API keys to integrate DocuBrain with external apps via <code>POST /api/v1/query</code>.</p>
          <div className="settings-card">
            <div className="api-key-create-row">
              <input
                type="text"
                className="api-key-name-input"
                placeholder="Key name (e.g. My App)"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateKey(); }}
                maxLength={50}
              />
              <button className="api-key-create-btn" onClick={handleCreateKey} disabled={!newKeyName.trim()}>
                <Plus size={14} /> Generate Key
              </button>
            </div>
            {newKeyResult && (
              <div className="api-key-new-result">
                <p>Your new API key (copy it now, it won't be shown again):</p>
                <div className="api-key-display">
                  <code>{newKeyResult.key}</code>
                  <button className="api-key-copy-btn" onClick={() => copyToClipboard(newKeyResult.key)}><Copy size={14} /></button>
                </div>
              </div>
            )}
            {apiKeys.length > 0 ? (
              <div className="api-keys-list">
                {apiKeys.map(k => (
                  <div key={k.id} className={`api-key-item ${k.revoked ? 'revoked' : ''}`}>
                    <div className="api-key-info">
                      <span className="api-key-item-name">{k.name}</span>
                      <code className="api-key-preview">{k.keyPreview}</code>
                      <span className="api-key-meta">Used {k.usageCount}x{k.revoked ? ' · Revoked' : ''}</span>
                    </div>
                    {!k.revoked && (
                      <button className="api-key-revoke-btn" onClick={() => handleRevokeKey(k.id)}><Trash2 size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="settings-placeholder">No API keys yet.</p>
            )}
          </div>
        </section>

        {analytics && (
          <section className="settings-section">
            <h2><Activity size={18} /> Analytics</h2>
            <div className="settings-card analytics-card">
              <div className="analytics-grid">
                <div className="analytics-stat">
                  <span className="analytics-value">{analytics.totalQueries}</span>
                  <span className="analytics-label">Total Queries</span>
                </div>
                <div className="analytics-stat">
                  <span className="analytics-value">{analytics.avgSourcesPerQuery}</span>
                  <span className="analytics-label">Avg Sources/Query</span>
                </div>
                <div className="analytics-stat">
                  <span className="analytics-value">{analytics.feedbackSummary?.up || 0}</span>
                  <span className="analytics-label">Positive Feedback</span>
                </div>
                <div className="analytics-stat">
                  <span className="analytics-value">{analytics.feedbackSummary?.down || 0}</span>
                  <span className="analytics-label">Negative Feedback</span>
                </div>
              </div>
              {analytics.modelsUsed?.length > 0 && (
                <div className="analytics-models">
                  <span className="analytics-label">Models used:</span>
                  {analytics.modelsUsed.map(m => <span key={m} className="analytics-model-chip">{m}</span>)}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default Settings;
