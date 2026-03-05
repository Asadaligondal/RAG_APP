import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import './ShortcutsHelp.css';

const ShortcutsHelp = ({ onClose }) => {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const mod = isMac ? '⌘' : 'Ctrl';

  const shortcuts = [
    { keys: `${mod}K`, desc: 'Open command palette' },
    { keys: `${mod}?`, desc: 'Show keyboard shortcuts' },
    { keys: 'Esc', desc: 'Close modal / command palette' },
  ];

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="shortcuts-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <ul className="shortcuts-list">
          {shortcuts.map((s, i) => (
            <li key={i} className="shortcuts-item">
              <kbd>{s.keys}</kbd>
              <span>{s.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default ShortcutsHelp;
