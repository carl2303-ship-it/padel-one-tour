import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import { usePushNotifications } from '../lib/usePushNotifications';
import { X, Lock, Mail, CheckCircle, AlertCircle, CreditCard, Image, KeyRound, Send, Bell, BellOff } from 'lucide-react';

interface UserSettingsProps {
  onClose: () => void;
}

export default function UserSettings({ onClose }: UserSettingsProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const {
    permission: pushPermission,
    isSubscribed: isPushSubscribed,
    isSupported: isPushSupported,
    loading: pushLoading,
    subscribe: subscribePush,
    unsubscribe: unsubscribePush,
  } = usePushNotifications();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pushMessage, setPushMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [stripePublishableKey, setStripePublishableKey] = useState('');
  const [stripeSecretKey, setStripeSecretKey] = useState('');
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeMessage, setStripeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [logoUrl, setLogoUrl] = useState('');
  const [logoLoading, setLogoLoading] = useState(false);
  const [logoMessage, setLogoMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [resetPhoneNumber, setResetPhoneNumber] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState<{ type: 'success' | 'error'; text: string; password?: string } | null>(null);

  const [welcomeEmail, setWelcomeEmail] = useState('');
  const [welcomeTournamentName, setWelcomeTournamentName] = useState('');
  const [welcomeCategoryName, setWelcomeCategoryName] = useState('');
  const [welcomePlayerName, setWelcomePlayerName] = useState('');
  const [welcomePhoneNumber, setWelcomePhoneNumber] = useState('');
  const [welcomeLoading, setWelcomeLoading] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [testEmail, setTestEmail] = useState('');
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [testEmailMessage, setTestEmailMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadStripeSettings();
    loadLogoSettings();
  }, [user]);

  const loadStripeSettings = async () => {
    if (!user) return;

    const { data } = await supabase
      .from('user_stripe_settings')
      .select('publishable_key, secret_key')
      .eq('user_id', user.id)
      .maybeSingle();

    if (data) {
      setStripePublishableKey(data.publishable_key || '');
      setStripeSecretKey(data.secret_key || '');
    }
  };

  const loadLogoSettings = async () => {
    if (!user) return;

    const { data } = await supabase
      .from('user_logo_settings')
      .select('logo_url')
      .eq('user_id', user.id)
      .maybeSingle();

    if (data) {
      setLogoUrl(data.logo_url || '');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: t.settings?.passwordMismatch || 'Passwords do not match' });
      return;
    }

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: t.settings?.passwordTooShort || 'Password must be at least 6 characters' });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      setMessage({ type: 'success', text: t.settings?.passwordChanged || 'Password changed successfully!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStripeSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setStripeMessage(null);
    setStripeLoading(true);

    try {
      const { data: existing } = await supabase
        .from('user_stripe_settings')
        .select('id')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('user_stripe_settings')
          .update({
            publishable_key: stripePublishableKey,
            secret_key: stripeSecretKey,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user?.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_stripe_settings')
          .insert({
            user_id: user?.id,
            publishable_key: stripePublishableKey,
            secret_key: stripeSecretKey,
          });

        if (error) throw error;
      }

      setStripeMessage({ type: 'success', text: t.settings.stripe.saved });
    } catch (error: any) {
      setStripeMessage({ type: 'error', text: error.message });
    } finally {
      setStripeLoading(false);
    }
  };

  const handleResetPlayerPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetMessage(null);
    setResetLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('reset-player-password', {
        body: { phone_number: resetPhoneNumber },
      });

      if (error) {
        setResetMessage({ type: 'error', text: error.message });
      } else if (data.error) {
        setResetMessage({ type: 'error', text: data.error });
      } else {
        setResetMessage({
          type: 'success',
          text: data.message,
          password: data.password,
        });
        setResetPhoneNumber('');
      }
    } catch (error: any) {
      setResetMessage({ type: 'error', text: error.message });
    } finally {
      setResetLoading(false);
    }
  };

  const handleSendWelcomeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setWelcomeMessage(null);
    setWelcomeLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('send-player-welcome-email', {
        body: {
          email: welcomeEmail,
          tournamentName: welcomeTournamentName,
          categoryName: welcomeCategoryName || undefined,
          playerName: welcomePlayerName || undefined,
          phoneNumber: welcomePhoneNumber || undefined,
        },
      });

      if (error) {
        setWelcomeMessage({ type: 'error', text: error.message });
      } else if (data.error) {
        setWelcomeMessage({ type: 'error', text: data.error });
      } else {
        setWelcomeMessage({
          type: 'success',
          text: t.settings.admin.welcomeSent,
        });
        setWelcomeEmail('');
        setWelcomeTournamentName('');
        setWelcomeCategoryName('');
        setWelcomePlayerName('');
        setWelcomePhoneNumber('');
      }
    } catch (error: any) {
      setWelcomeMessage({ type: 'error', text: error.message });
    } finally {
      setWelcomeLoading(false);
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestEmailMessage(null);
    setTestEmailLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('test-email', {
        body: {
          email: testEmail,
        },
      });

      if (error) {
        setTestEmailMessage({ type: 'error', text: error.message });
      } else if (data.error) {
        setTestEmailMessage({ type: 'error', text: data.error });
      } else {
        setTestEmailMessage({
          type: 'success',
          text: `Email de teste enviado com sucesso para ${testEmail}!`,
        });
        setTestEmail('');
      }
    } catch (error: any) {
      setTestEmailMessage({ type: 'error', text: error.message });
    } finally {
      setTestEmailLoading(false);
    }
  };

  const handleTogglePush = async () => {
    setPushMessage(null);
    if (isPushSubscribed) {
      const success = await unsubscribePush();
      if (success) {
        setPushMessage({ type: 'success', text: 'Notificacoes desativadas' });
      } else {
        setPushMessage({ type: 'error', text: 'Erro ao desativar notificacoes' });
      }
    } else {
      const success = await subscribePush();
      if (success) {
        setPushMessage({ type: 'success', text: 'Notificacoes ativadas! Recebera alertas de novas inscricoes.' });
      } else if (pushPermission === 'denied') {
        setPushMessage({ type: 'error', text: 'Permissao negada. Ative as notificacoes nas definicoes do browser.' });
      } else {
        setPushMessage({ type: 'error', text: 'Erro ao ativar notificacoes' });
      }
    }
  };

  const handleSaveLogoSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLogoMessage(null);
    setLogoLoading(true);

    try {
      if (!logoUrl.trim()) {
        setLogoMessage({ type: 'error', text: t.settings.logo.error });
        setLogoLoading(false);
        return;
      }

      const { data: existing } = await supabase
        .from('user_logo_settings')
        .select('id')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('user_logo_settings')
          .update({
            logo_url: logoUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user?.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_logo_settings')
          .insert({
            user_id: user?.id,
            logo_url: logoUrl,
          });

        if (error) throw error;
      }

      setLogoMessage({ type: 'success', text: t.settings.logo.saved });
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error: any) {
      setLogoMessage({ type: 'error', text: error.message });
    } finally {
      setLogoLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">
            {t.settings?.title || 'Account Settings'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 text-gray-700">
              <Mail className="w-5 h-5" />
              <span className="font-medium">{user?.email}</span>
            </div>
          </div>

          {isPushSupported && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Notificacoes Push
              </h3>
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {isPushSubscribed ? (
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                          <Bell className="w-5 h-5 text-green-600" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                          <BellOff className="w-5 h-5 text-gray-500" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-gray-900">
                          {isPushSubscribed ? 'Notificacoes ativas' : 'Notificacoes desativadas'}
                        </p>
                        <p className="text-sm text-gray-500">
                          {isPushSubscribed
                            ? 'Recebera alertas de novas inscricoes'
                            : 'Ative para receber alertas no telemovel'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleTogglePush}
                      disabled={pushLoading}
                      className={`px-4 py-2 rounded-lg font-medium transition ${
                        isPushSubscribed
                          ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      } disabled:opacity-50`}
                    >
                      {pushLoading ? '...' : isPushSubscribed ? 'Desativar' : 'Ativar'}
                    </button>
                  </div>
                </div>

                {pushPermission === 'denied' && (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm text-yellow-800">
                      As notificacoes foram bloqueadas. Para ativar, aceda as definicoes do browser e permita notificacoes para este site.
                    </p>
                  </div>
                )}

                {pushMessage && (
                  <div className={`flex items-center gap-2 p-4 rounded-lg ${
                    pushMessage.type === 'success'
                      ? 'bg-green-50 text-green-800'
                      : 'bg-red-50 text-red-800'
                  }`}>
                    {pushMessage.type === 'success' ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      <AlertCircle className="w-5 h-5" />
                    )}
                    <span className="text-sm font-medium">{pushMessage.text}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Image className="w-5 h-5" />
              {t.settings.logo.title}
            </h3>
            <form onSubmit={handleSaveLogoSettings} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t.settings.logo.url}
                </label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="https://example.com/your-logo.png"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t.settings.logo.urlHelper}
                </p>
              </div>

              {logoUrl && (
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm font-medium text-gray-700 mb-2">{t.settings.logo.preview}</p>
                  <img
                    src={logoUrl}
                    alt={t.settings.logo.previewAlt}
                    className="h-16 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '';
                      (e.target as HTMLImageElement).alt = 'Failed to load image';
                    }}
                  />
                </div>
              )}

              {logoMessage && (
                <div className={`flex items-center gap-2 p-4 rounded-lg ${
                  logoMessage.type === 'success'
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}>
                  {logoMessage.type === 'success' ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <AlertCircle className="w-5 h-5" />
                  )}
                  <span className="text-sm font-medium">{logoMessage.text}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={logoLoading}
                className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {logoLoading ? t.settings.logo.saving : t.settings.logo.save}
              </button>
            </form>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <KeyRound className="w-5 h-5" />
              {t.settings.admin.resetPasswordTitle}
            </h3>
            <form onSubmit={handleResetPlayerPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t.settings.admin.playerPhone}
                </label>
                <input
                  type="tel"
                  value={resetPhoneNumber}
                  onChange={(e) => setResetPhoneNumber(e.target.value)}
                  placeholder="+351969365060"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t.settings.admin.phoneHelper}
                </p>
              </div>

              {resetMessage && (
                <div className={`flex items-center gap-2 p-4 rounded-lg ${
                  resetMessage.type === 'success'
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}>
                  {resetMessage.type === 'success' ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <AlertCircle className="w-5 h-5" />
                  )}
                  <div className="flex-1">
                    <span className="text-sm font-medium block">{resetMessage.text}</span>
                    {resetMessage.password && (
                      <span className="text-sm font-mono block mt-1">
                        {t.settings.admin.newPasswordLabel} <strong>{resetMessage.password}</strong>
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-800">
                  {t.settings.admin.resetNote}
                </p>
              </div>

              <button
                type="submit"
                disabled={resetLoading}
                className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {resetLoading ? t.settings.admin.resetting : t.settings.admin.resetButton}
              </button>
            </form>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Send className="w-5 h-5" />
              {t.settings.admin.sendWelcomeTitle}
            </h3>
            <form onSubmit={handleSendWelcomeEmail} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t.settings.admin.playerEmail || 'Player Email'}
                </label>
                <input
                  type="email"
                  value={welcomeEmail}
                  onChange={(e) => setWelcomeEmail(e.target.value)}
                  placeholder="player@example.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t.settings.admin.tournamentName}
                </label>
                <input
                  type="text"
                  value={welcomeTournamentName}
                  onChange={(e) => setWelcomeTournamentName(e.target.value)}
                  placeholder="Summer Cup 2024"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t.settings.admin.categoryName}
                </label>
                <input
                  type="text"
                  value={welcomeCategoryName}
                  onChange={(e) => setWelcomeCategoryName(e.target.value)}
                  placeholder="Men's Open"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="border-t pt-4 mt-4">
                <p className="text-sm text-gray-500 mb-3">
                  Campos opcionais (usar se o jogador não tem conta):
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Nome do Jogador
                    </label>
                    <input
                      type="text"
                      value={welcomePlayerName}
                      onChange={(e) => setWelcomePlayerName(e.target.value)}
                      placeholder="João Silva"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Telefone
                    </label>
                    <input
                      type="text"
                      value={welcomePhoneNumber}
                      onChange={(e) => setWelcomePhoneNumber(e.target.value)}
                      placeholder="+351912345678"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {welcomeMessage && (
                <div className={`flex items-center gap-2 p-4 rounded-lg ${
                  welcomeMessage.type === 'success'
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}>
                  {welcomeMessage.type === 'success' ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <AlertCircle className="w-5 h-5" />
                  )}
                  <span className="text-sm font-medium">{welcomeMessage.text}</span>
                </div>
              )}

              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-800">
                  {t.settings.admin.welcomeNote}
                </p>
              </div>

              <button
                type="submit"
                disabled={welcomeLoading}
                className="w-full py-3 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {welcomeLoading ? t.settings.admin.sending : t.settings.admin.sendButton}
              </button>
            </form>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Send className="w-5 h-5" />
              Testar Sistema de Email
            </h3>
            <form onSubmit={handleSendTestEmail} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email de Teste
                </label>
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="seu-email@example.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              {testEmailMessage && (
                <div className={`flex items-center gap-2 p-4 rounded-lg ${
                  testEmailMessage.type === 'success'
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}>
                  {testEmailMessage.type === 'success' ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <AlertCircle className="w-5 h-5" />
                  )}
                  <span className="text-sm font-medium">{testEmailMessage.text}</span>
                </div>
              )}

              <div className="p-3 bg-yellow-50 rounded-lg">
                <p className="text-xs text-yellow-800">
                  Use este formulário para testar se o sistema de envio de emails está a funcionar corretamente. 
                  Será enviado um email de teste para o endereço indicado.
                </p>
              </div>

              <button
                type="submit"
                disabled={testEmailLoading}
                className="w-full py-3 px-4 bg-yellow-600 text-white rounded-lg font-medium hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {testEmailLoading ? 'A enviar...' : 'Enviar Email de Teste'}
              </button>
            </form>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Lock className="w-5 h-5" />
              {t.settings?.changePassword || 'Change Password'}
            </h3>
            <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.settings?.newPassword || 'New Password'}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  minLength={6}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.settings?.confirmPassword || 'Confirm New Password'}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  minLength={6}
                />
              </div>
            </div>

            {message && (
              <div className={`flex items-center gap-2 p-4 rounded-lg ${
                message.type === 'success'
                  ? 'bg-green-50 text-green-800'
                  : 'bg-red-50 text-red-800'
              }`}>
                {message.type === 'success' ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  <AlertCircle className="w-5 h-5" />
                )}
                <span className="text-sm font-medium">{message.text}</span>
              </div>
            )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {loading ? (t.message?.loading || 'Loading...') : (t.settings?.changePassword || 'Change Password')}
              </button>
            </form>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              {t.settings.stripe.title}
            </h3>
            <form onSubmit={handleSaveStripeSettings} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t.settings.stripe.publishableKey}
                </label>
                <input
                  type="text"
                  value={stripePublishableKey}
                  onChange={(e) => setStripePublishableKey(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  placeholder="pk_test_..."
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t.settings.stripe.publishableKeyHelper}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t.settings.stripe.secretKey}
                </label>
                <input
                  type="password"
                  value={stripeSecretKey}
                  onChange={(e) => setStripeSecretKey(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  placeholder="sk_test_..."
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t.settings.stripe.secretKeyHelper}
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <strong>{t.settings.stripe.howToTitle}</strong>
                </p>
                <ol className="text-sm text-blue-700 mt-2 space-y-1 list-decimal list-inside">
                  <li>{t.settings.stripe.step1} <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="underline">{t.settings.stripe.step1Link}</a></li>
                  <li>{t.settings.stripe.step2}</li>
                  <li>{t.settings.stripe.step3}</li>
                  <li>{t.settings.stripe.step4}</li>
                </ol>
              </div>

              {stripeMessage && (
                <div className={`flex items-center gap-2 p-4 rounded-lg ${
                  stripeMessage.type === 'success'
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}>
                  {stripeMessage.type === 'success' ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <AlertCircle className="w-5 h-5" />
                  )}
                  <span className="text-sm font-medium">{stripeMessage.text}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={stripeLoading}
                className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {stripeLoading ? t.button.saving : t.settings.stripe.save}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
