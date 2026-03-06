import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { db } from './firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import api from './utils/api';

const ChatContext = createContext();

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within ChatProvider');
  return context;
};

export function ChatProvider({ children }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);

  useEffect(() => {
    if (!user) { setChats([]); return; }
    const chatsRef = collection(db, 'users', user.uid, 'chats');
    const q = query(chatsRef, orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setChats(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [user]);

  const handleNewChat = useCallback(() => {
    setCurrentChatId(null);
  }, []);

  const handleDeleteChat = async (chatId) => {
    if (!window.confirm('Delete this chat and its document?')) return;
    try {
      await api.delete(`/api/chats/${chatId}`);
      if (currentChatId === chatId) setCurrentChatId(null);
    } catch (error) {
      console.error('Error deleting chat:', error);
      toast('Failed to delete. Please try again.', 'error');
    }
  };

  return (
    <ChatContext.Provider value={{ chats, currentChatId, setCurrentChatId, handleNewChat, handleDeleteChat }}>
      {children}
    </ChatContext.Provider>
  );
}
