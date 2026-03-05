import React, { createContext, useState, useContext } from 'react';
import ShortcutsHelp from './components/ShortcutsHelp';

const ShortcutsHelpContext = createContext();

export const useShortcutsHelp = () => useContext(ShortcutsHelpContext);

export const ShortcutsHelpProvider = ({ children }) => {
  const [open, setOpen] = useState(false);
  return (
    <ShortcutsHelpContext.Provider value={{ open: () => setOpen(true), close: () => setOpen(false) }}>
      {children}
      {open && <ShortcutsHelp onClose={() => setOpen(false)} />}
    </ShortcutsHelpContext.Provider>
  );
};
