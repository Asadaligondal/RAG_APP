import { useEffect } from 'react';
import { useCommandPalette } from './CommandPaletteContext';
import { useShortcutsHelp } from './ShortcutsHelpContext';

export default function CommandPaletteTrigger() {
  const { open } = useCommandPalette();
  const { open: openShortcuts } = useShortcutsHelp();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        open();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '?') {
        e.preventDefault();
        openShortcuts();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, openShortcuts]);

  return null;
}
