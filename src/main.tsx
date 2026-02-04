import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

function showError(title: string, message: string, detail?: string) {
  const root = document.getElementById('root')!;
  root.innerHTML = `
    <div style="padding: 24px; font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
      <h1 style="color: #dc2626; margin-bottom: 8px;">${title}</h1>
      <p style="color: #374151; margin-bottom: 16px;">${message}</p>
      ${detail ? `<pre style="background: #f3f4f6; padding: 12px; border-radius: 8px; overflow: auto; font-size: 12px;">${detail}</pre>` : ''}
      <p style="color: #6b7280; font-size: 14px; margin-top: 16px;">Em Netlify: Site configuration → Environment variables. Adiciona VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY e faz um novo deploy.</p>
      <p style="color: #6b7280; font-size: 14px;">Se já configuraste, tenta Ctrl+Shift+R (hard refresh) para limpar a cache.</p>
    </div>
  `;
}

async function init() {
  try {
    const path = window.location.pathname;
    const isLivePage = path.match(/^\/tournament\/[^/]+\/live$/);

    const { I18nProvider } = await import('./lib/i18nContext');
    const { AuthProvider } = await import('./lib/authContext');
    const { default: App } = await import('./App.tsx');
    const { default: LiveTournamentView } = await import('./components/LiveTournamentView');

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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = err instanceof Error ? err.stack : undefined;
    showError('Erro ao carregar a aplicação', message, detail);
    console.error(err);
  }
}

window.addEventListener('error', (event) => {
  if (!document.getElementById('root')?.innerHTML?.includes('Erro ao carregar')) {
    showError('Erro na aplicação', event.message, event.error?.stack);
  }
});
window.addEventListener('unhandledrejection', (event) => {
  if (!document.getElementById('root')?.innerHTML?.includes('Erro ao carregar')) {
    showError('Erro na aplicação', String(event.reason?.message ?? event.reason), event.reason?.stack);
  }
});

init();
