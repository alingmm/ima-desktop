import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatPage from './pages/ChatPage';
import KnowledgePage from './pages/KnowledgePage';
import NotesPage from './pages/NotesPage';
import VideoPage from './pages/VideoPage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import TrackingPage from './pages/TrackingPage';
import { ToastProvider } from './components/Toast';

export type PageType = 'chat' | 'knowledge' | 'notes' | 'tracking' | 'video' | 'search' | 'settings';

function App() {
  const [currentPage, setCurrentPage] = useState<PageType>('chat');

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PageType>).detail;
      if (detail) setCurrentPage(detail);
    };
    window.addEventListener('navigate', handler);
    return () => window.removeEventListener('navigate', handler);
  }, []);

  const renderPage = () => {
    switch (currentPage) {
      case 'chat':
        return <ChatPage />;
      case 'knowledge':
        return <KnowledgePage />;
      case 'notes':
        return <NotesPage />;
      case 'tracking':
        return <TrackingPage />;
      case 'video':
        return <VideoPage />;
      case 'search':
        return <SearchPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <ChatPage />;
    }
  };

  return (
    <ToastProvider>
      <div className="flex h-screen bg-[var(--color-main-bg)]">
        <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
        <main className="flex-1 overflow-hidden">{renderPage()}</main>
      </div>
    </ToastProvider>
  );
}

export default App;
