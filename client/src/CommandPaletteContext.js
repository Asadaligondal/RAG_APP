import React, { createContext, useState, useContext, useCallback } from 'react';

const CommandPaletteContext = createContext();

export const useCommandPalette = () => {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) return { isOpen: false, open: () => {}, close: () => {} };
  return ctx;
};

export const CommandPaletteProvider = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [onNewChat, setOnNewChat] = useState(null);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const registerNewChat = useCallback((fn) => setOnNewChat(() => fn), []);

  return (
    <CommandPaletteContext.Provider
      value={{ isOpen, open, close, onNewChat, registerNewChat }}
    >
      {children}
    </CommandPaletteContext.Provider>
  );
};
