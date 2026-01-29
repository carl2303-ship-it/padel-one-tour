import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import LiveTournamentView from './components/LiveTournamentView';
import './index.css';
import { I18nProvider } from './lib/i18nContext';
import { AuthProvider } from './lib/authContext';

const path = window.location.pathname;
const isLivePage = path.match(/^\/tournament\/[^/]+\/live$/);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      {isLivePage ? (
        <LiveTournamentView />
      ) : (
        <AuthProvider>
          <App />
        </AuthProvider>
      )}
    </I18nProvider>
  </StrictMode>
);
