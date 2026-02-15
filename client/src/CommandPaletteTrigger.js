import React, { useEffect } from 'react';
import { useCommandPalette } from './CommandPaletteContext';

export default function CommandPaletteTrigger() {
  const { open } = useCommandPalette();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return null;
}
