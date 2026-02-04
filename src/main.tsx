import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

function ErrorDisplay({ title, message, detail }: { title: string; message: string; detail?: string }) {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ color: '#dc2626', marginBottom: 8 }}>{title}</h1>
      <p style={{ color: '#374151', marginBottom: 16 }}>{message}</p>
      {detail && <pre style={{ background: '#f3f4f6', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12 }}>{detail}</pre>}
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 16 }}>Em Netlify: Site configuration → Environment variables. Adiciona VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY e faz um novo deploy.</p>
      <p style={{ color: '#6b7280', fontSize: 14 }}>Se já configuraste, tenta Ctrl+Shift+R (hard refresh) para limpar a cache.</p>
    </div>
  );
}

const rootEl = document.getElementById('root')!;
const rootInstance = createRoot(rootEl);

function showError(title: string, message: string, detail?: string) {
  rootInstance.render(<ErrorDisplay title={title} message={message} detail={detail} />);
}

async function init() {
  try {
    const path = window.location.pathname;
    const isLivePage = path.match(/^\/tournament\/[^/]+\/live$/);

    const { I18nProvider } = await import('./lib/i18nContext');
    const { AuthProvider } = await import('./lib/authContext');
    const { default: App } = await import('./App.tsx');
    const { default: LiveTournamentView } = await import('./components/LiveTournamentView');

    rootInstance.render(
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = err instanceof Error ? err.stack : undefined;
    showError('Erro ao carregar a aplicação', message, detail);
    console.error(err);
  }
}

let hasShownError = false;
window.addEventListener('error', (event) => {
  if (!hasShownError) {
    hasShownError = true;
    showError('Erro na aplicação', event.message, event.error?.stack);
  }
});
window.addEventListener('unhandledrejection', (event) => {
  if (!hasShownError) {
    hasShownError = true;
    showError('Erro na aplicação', String(event.reason?.message ?? event.reason), event.reason?.stack);
  }
});

init();
