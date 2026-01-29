import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import { X, Lock, Mail, CheckCircle, AlertCircle } from 'lucide-react';

interface PlayerSettingsProps {
  onClose: () => void;
}

export default function PlayerSettings({ onClose }: PlayerSettingsProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [emailMessage, setEmailMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [playerAccount, setPlayerAccount] = useState<{ phone_number: string; name: string } | null>(null);

  useEffect(() => {
    const fetchPlayerAccount = async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from('player_accounts')
        .select('phone_number, name')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data) {
        setPlayerAccount(data);
      }
    };
    fetchPlayerAccount();
  }, [user?.id]);

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

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailMessage(null);

    if (!newEmail || newEmail === user?.email) {
      setEmailMessage({ type: 'error', text: 'Por favor introduza um email diferente' });
      return;
    }

    if (!playerAccount?.phone_number) {
      setEmailMessage({ type: 'error', text: 'Conta de jogador nao encontrada' });
      return;
    }

    setEmailLoading(true);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error('Sessao expirada. Por favor faca login novamente.');
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/update-player-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          userId: user?.id,
          newEmail: newEmail,
          phoneNumber: playerAccount.phone_number,
          playerName: playerAccount.name
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao atualizar email');
      }

      setEmailMessage({
        type: 'success',
        text: 'Email atualizado! Verifique a sua caixa de correio para instrucoes de acesso.'
      });
      setNewEmail('');

      // Refresh the session to get the updated email
      await supabase.auth.refreshSession();

      // Wait a bit for the session to update, then close
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error: any) {
      setEmailMessage({ type: 'error', text: error.message });
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
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

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Alterar Email
            </h3>
            <div className="p-4 bg-gray-50 rounded-lg mb-4">
              <p className="text-sm text-gray-500 mb-1">Email atual:</p>
              <p className="font-medium text-gray-900">{user?.email}</p>
            </div>
            <form onSubmit={handleChangeEmail} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Novo Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="novo@email.com"
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>

              {emailMessage && (
                <div className={`flex items-center gap-2 p-4 rounded-lg ${
                  emailMessage.type === 'success'
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}>
                  {emailMessage.type === 'success' ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <AlertCircle className="w-5 h-5" />
                  )}
                  <span className="text-sm font-medium">{emailMessage.text}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={emailLoading}
                className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {emailLoading ? 'A enviar...' : 'Alterar Email'}
              </button>
            </form>
          </div>

          <hr className="border-gray-200" />

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Alterar Password
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
        </div>
      </div>
    </div>
  );
}
