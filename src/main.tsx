import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const missingSupabaseEnv =
  !import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY;

function ErrorDisplay({ title, message, detail }: { title: string; message: string; detail?: string }) {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ color: '#dc2626', marginBottom: 8 }}>{title}</h1>
      <p style={{ color: '#374151', marginBottom: 16 }}>{message}</p>
      {detail && <pre style={{ background: '#f3f4f6', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12 }}>{detail}</pre>}
      {missingSupabaseEnv && (
        <>
          <p style={{ color: '#6b7280', fontSize: 14, marginTop: 16 }}>
            Em Netlify: Site configuration → Environment variables. Adiciona VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY e faz um novo deploy.
          </p>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            Se já configuraste, tenta Ctrl+Shift+R (hard refresh) para limpar a cache.
          </p>
        </>
      )}
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 16 }}>
        Se abriste o link pelo WhatsApp, toca nos ⋮ e escolhe «Abrir no browser» (Chrome/Safari), depois atualiza a página.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: 16,
          padding: '10px 16px',
          background: '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        Recarregar página
      </button>
    </div>
  );
}

/** Browser extensions / Google Translate / in-app browsers often mutate the DOM and trigger these. */
function isBenignDomMutationError(message: string, error?: unknown): boolean {
  const text = `${message} ${error instanceof Error ? error.message : ''} ${error instanceof Error ? error.name : ''}`;
  return (
    /NotFoundError/i.test(text) &&
    (/removeChild/i.test(text) || /insertBefore/i.test(text) || /replaceChild/i.test(text))
  );
}

const rootEl = document.getElementById('root')!;
rootEl.setAttribute('translate', 'no');
const rootInstance = createRoot(rootEl);

function showError(title: string, message: string, detail?: string) {
  rootInstance.render(<ErrorDisplay title={title} message={message} detail={detail} />);
}

async function init() {
  try {
    const { initializeOrganizationTheme } = await import('./lib/organizationTheme');
    await initializeOrganizationTheme();

    // Register Service Worker for push notifications
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/service-worker.js', {
          scope: '/',
        });
        console.log('[SW] Service Worker registered:', registration.scope);
      } catch (error) {
        console.error('[SW] Service Worker registration failed:', error);
      }
    }

    const path = window.location.pathname;
    const isLivePage = path.match(/^\/tournament\/[^/]+\/live$/);
    const registerId = new URLSearchParams(window.location.search).get('register');

    const { I18nProvider } = await import('./lib/i18nContext');

    if (isLivePage) {
      const { default: LiveTournamentView } = await import('./components/LiveTournamentView');
      rootInstance.render(
        <StrictMode>
          <I18nProvider>
            <LiveTournamentView />
          </I18nProvider>
        </StrictMode>
      );
      return;
    }

    // Public registration bypasses organizer App gates (license/module/role spinner)
    if (registerId) {
      const { AuthProvider } = await import('./lib/authContext');
      const { default: PublicRegistrationPage } = await import('./components/PublicRegistrationPage');
      rootInstance.render(
        <StrictMode>
          <I18nProvider>
            <AuthProvider>
              <PublicRegistrationPage />
            </AuthProvider>
          </I18nProvider>
        </StrictMode>
      );
      return;
    }

    const { AuthProvider } = await import('./lib/authContext');
    const { default: App } = await import('./App.tsx');

    rootInstance.render(
      <StrictMode>
        <I18nProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
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
  if (isBenignDomMutationError(event.message, event.error)) {
    console.warn('[ignored benign DOM error]', event.message);
    event.preventDefault();
    return;
  }
  if (!hasShownError) {
    hasShownError = true;
    showError('Erro na aplicação', event.message, event.error?.stack);
  }
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = String(reason?.message ?? reason);
  if (isBenignDomMutationError(message, reason)) {
    console.warn('[ignored benign DOM rejection]', message);
    event.preventDefault();
    return;
  }
  if (!hasShownError) {
    hasShownError = true;
    showError('Erro na aplicação', message, reason?.stack);
  }
});

init();
