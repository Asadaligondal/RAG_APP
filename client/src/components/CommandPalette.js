import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCommandPalette } from '../CommandPaletteContext';
import { LayoutDashboard, FileText, Settings, Plus, Home, Command } from 'lucide-react';
import './CommandPalette.css';

const ACTIONS = [
  { id: 'new-chat', label: 'New Chat', icon: Plus, shortcut: 'N', path: '/dashboard', action: 'new-chat' },
  { id: 'dashboard', label: 'Go to Dashboard', icon: LayoutDashboard, shortcut: 'G D', path: '/dashboard' },
  { id: 'documents', label: 'Go to Documents', icon: FileText, shortcut: 'G O', path: '/documents' },
  { id: 'settings', label: 'Go to Settings', icon: Settings, shortcut: 'G S', path: '/settings' },
  { id: 'home', label: 'Go to Home', icon: Home, shortcut: 'G H', path: '/' },
];

function CommandPalette() {
  const { isOpen, close, onNewChat } = useCommandPalette();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();

  const filtered = ACTIONS.filter(
    (a) => !query.trim() || a.label.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = useCallback(
    (action) => {
      if (action.action === 'new-chat') {
        onNewChat?.();
        close();
        navigate('/dashboard');
      } else {
        navigate(action.path);
        close();
      }
    },
    [navigate, close, onNewChat]
  );

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
        return;
      }
      if (e.key === 'Enter' && filtered[selected]) {
        e.preventDefault();
        handleSelect(filtered[selected]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filtered, selected, handleSelect, close]);

  if (!isOpen) return null;

  return (
    <div className="command-palette-overlay" onClick={close}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-header">
          <Command size={18} className="command-palette-icon" />
          <input
            type="text"
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="command-palette-input"
            autoFocus
          />
        </div>
        <div className="command-palette-list">
          {filtered.length === 0 ? (
            <div className="command-palette-empty">No commands found</div>
          ) : (
            filtered.map((action, i) => (
              <button
                key={action.id}
                className={`command-palette-item ${i === selected ? 'selected' : ''}`}
                onClick={() => handleSelect(action)}
                onMouseEnter={() => setSelected(i)}
              >
                <action.icon size={18} className="command-palette-item-icon" />
                <span>{action.label}</span>
                {action.shortcut && (
                  <span className="command-palette-shortcut">{action.shortcut}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
