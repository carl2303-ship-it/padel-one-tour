import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/authContext';
import { useI18n } from '../lib/i18nContext';
import { supabase } from '../lib/supabase';
import { useCustomLogo } from '../lib/useCustomLogo';

interface AuthFormProps {
  onSuccess?: () => void;
}

export default function AuthForm({ onSuccess }: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [userType, setUserType] = useState<'organizer' | 'player'>('organizer');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const { signIn, resetPassword } = useAuth();
  const { t } = useI18n();
  const { logoUrl } = useCustomLogo();

  useEffect(() => {
    // Check if this is a password recovery link
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');

    if (type === 'recovery') {
      setIsPasswordRecovery(true);
      setShowResetPassword(false);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (userType === 'player') {
      if (!phoneNumber || !password) {
        setError('Por favor preencha o telefone e password');
        return;
      }

      setLoading(true);

      try {
        let normalizedPhone = phoneNumber.trim().replace(/[\s\-\(\)\.]/g, '');

        if (!normalizedPhone.startsWith('+')) {
          if (normalizedPhone.startsWith('00')) {
            normalizedPhone = '+' + normalizedPhone.substring(2);
          } else if (normalizedPhone.startsWith('9') && normalizedPhone.length === 9) {
            normalizedPhone = '+351' + normalizedPhone;
          } else if (normalizedPhone.startsWith('351')) {
            normalizedPhone = '+' + normalizedPhone;
          } else {
            normalizedPhone = '+' + normalizedPhone;
          }
        }

        console.log('[VERSION 2.1] Logging in with normalized phone:', normalizedPhone);

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-player-login-email`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ phone_number: normalizedPhone }),
          }
        );

        console.log('[VERSION 2.0] Response status:', response.status);

        const emailData = await response.json();

        console.log('[VERSION 2.0] Email lookup result:', emailData);

        if (!response.ok || emailData?.error || !emailData?.success || !emailData?.email) {
          console.error('[DEBUG] Function returned error:', emailData);
          console.error('[DEBUG] Normalized phone sent:', normalizedPhone);
          console.error('[DEBUG] Response status:', response.status);
          setError('Conta não encontrada. Faça primeiro o registo através de um torneio.');
          setLoading(false);
          return;
        }

        console.log('Attempting login with email:', emailData.email);
        const { error } = await signIn(emailData.email, password);
        if (error) {
          console.error('Login error:', error);
          setError('Telefone ou password incorretos');
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: existing } = await supabase
              .from('user_logo_settings')
              .select('id')
              .eq('user_id', user.id)
              .maybeSingle();

            if (existing) {
              await supabase
                .from('user_logo_settings')
                .update({ role: userType, updated_at: new Date().toISOString() })
                .eq('user_id', user.id);
            } else {
              await supabase
                .from('user_logo_settings')
                .insert({ user_id: user.id, role: userType, logo_url: null });
            }

            // Update players table with user_id to link the player account
            await supabase
              .from('players')
              .update({ user_id: user.id })
              .eq('phone_number', normalizedPhone)
              .is('user_id', null);
          }
          onSuccess?.();
        }
      } catch (err) {
        setError(t.auth.errors.somethingWrong);
      } finally {
        setLoading(false);
      }
    } else {
      if (!email || !password) {
        setError(t.auth.errors.fillAllFields);
        return;
      }

      setLoading(true);

      try {
        const { error } = await signIn(email, password);
        if (error) {
          setError(t.auth.errors.invalidCredentials);
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: existing } = await supabase
              .from('user_logo_settings')
              .select('id, is_paid_organizer')
              .eq('user_id', user.id)
              .maybeSingle();

            if (existing) {
              if (!existing.is_paid_organizer) {
                await supabase.auth.signOut();
                setError('Esta conta não tem acesso de organizador. Adquira a licença em boostpadel.store');
                setLoading(false);
                return;
              }
              await supabase
                .from('user_logo_settings')
                .update({ role: 'organizer', updated_at: new Date().toISOString() })
                .eq('user_id', user.id);
            } else {
              await supabase.auth.signOut();
              setError('Esta conta não tem acesso de organizador. Adquira a licença em boostpadel.store');
              setLoading(false);
              return;
            }
          }
          onSuccess?.();
        }
      } catch (err) {
        setError(t.auth.errors.somethingWrong);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email) {
      setError(t.auth.errors.fillAllFields);
      return;
    }

    setLoading(true);

    try {
      const { error } = await resetPassword(email);
      if (error) {
        setError(t.auth.errors.somethingWrong);
      } else {
        setSuccess(t.auth.resetEmailSent);
        setTimeout(() => {
          setShowResetPassword(false);
          setSuccess('');
        }, 3000);
      }
    } catch (err) {
      setError(t.auth.errors.somethingWrong);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!password || !confirmPassword) {
      setError(t.auth.errors.fillAllFields);
      return;
    }

    if (password.length < 6) {
      setError(t.auth.errors.passwordTooShort);
      return;
    }

    if (password !== confirmPassword) {
      setError(t.auth.errors.passwordsDontMatch);
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) {
        setError(t.auth.errors.somethingWrong);
      } else {
        setSuccess(t.auth.passwordUpdated);
        setTimeout(() => {
          setIsPasswordRecovery(false);
          setPassword('');
          setConfirmPassword('');
          window.location.hash = '';
        }, 2000);
      }
    } catch (err) {
      setError(t.auth.errors.somethingWrong);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-6">
              <img
                src={logoUrl}
                alt="Logo"
                className="h-32 w-auto"
              />
            </div>
            <h1 className="text-3xl font-black text-[#111111] mb-2">
              {t.app.title}
            </h1>
            <p className="text-slate-600">
              {t.auth.welcomeBack}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {success && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">{success}</p>
            </div>
          )}

          {isPasswordRecovery ? (
            <form onSubmit={handleUpdatePassword} className="space-y-5">
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-slate-700 mb-2">
                  {t.auth.newPassword}
                </label>
                <div className="relative">
                  <input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#007BFF] focus:border-transparent transition pr-12"
                    placeholder={t.auth.passwordPlaceholder}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition"
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 mb-2">
                  {t.auth.confirmPassword}
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#007BFF] focus:border-transparent transition pr-12"
                    placeholder={t.auth.confirmPasswordPlaceholder}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition"
                  >
                    {showConfirmPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#007BFF] hover:bg-[#0069d9] text-white font-bold py-3 rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
              >
                {loading ? t.auth.pleaseWait : t.auth.updatePassword}
              </button>
            </form>
          ) : showResetPassword ? (
            <form onSubmit={handleResetPassword} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                  {t.auth.email}
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#007BFF] focus:border-transparent transition"
                  placeholder={t.auth.emailPlaceholder}
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#007BFF] hover:bg-[#0069d9] text-white font-bold py-3 rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
              >
                {loading ? t.auth.pleaseWait : t.auth.resetPassword}
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowResetPassword(false);
                  setError('');
                  setSuccess('');
                }}
                className="w-full text-[#007BFF] hover:text-[#0069d9] font-medium py-2 transition"
              >
                {t.auth.backToSignIn}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Login como
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setUserType('organizer')}
                  className={`px-4 py-3 rounded-lg font-bold transition ${
                    userType === 'organizer'
                      ? 'bg-[#007BFF] text-white shadow-md'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  disabled={loading}
                >
                  Organizador
                </button>
                <button
                  type="button"
                  onClick={() => setUserType('player')}
                  className={`px-4 py-3 rounded-lg font-bold transition ${
                    userType === 'player'
                      ? 'bg-[#007BFF] text-white shadow-md'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  disabled={loading}
                >
                  Jogador
                </button>
              </div>
            </div>

            {userType === 'player' ? (
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-2">
                  Número de Telefone
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#007BFF] focus:border-transparent transition"
                  placeholder="+351 912345678"
                  disabled={loading}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Use o mesmo telefone do registo do torneio
                </p>
              </div>
            ) : (
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                  {t.auth.email}
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#007BFF] focus:border-transparent transition"
                  placeholder={t.auth.emailPlaceholder}
                  disabled={loading}
                />
              </div>
            )}

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
                {t.auth.password}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#007BFF] focus:border-transparent transition pr-12"
                  placeholder={t.auth.passwordPlaceholder}
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition"
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#007BFF] hover:bg-[#0069d9] text-white font-bold py-3 rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
              >
                {loading ? t.auth.pleaseWait : t.auth.signIn}
              </button>

              {userType === 'player' && (
                <>
                  <div className="text-center text-sm text-slate-600 bg-blue-50 p-3 rounded-lg">
                    <p className="font-medium mb-1">Primeira vez?</p>
                    <p className="text-xs">Registe-se através do link de inscrição de um torneio para criar a sua conta gratuita.</p>
                    <p className="text-xs mt-1 font-medium">Password: Player + últimos 4 dígitos do telefone + !</p>
                    <p className="text-xs text-slate-500">(Ex: telefone 912345678 → password: Player5678!)</p>
                  </div>

                  <div className="text-center mt-3">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!phoneNumber) {
                          setError('Por favor introduza o número de telefone');
                          return;
                        }

                        setLoading(true);
                        setError('');
                        setSuccess('');

                        try {
                          let normalizedPhone = phoneNumber.trim().replace(/[\s\-\(\)\.]/g, '');
                          if (!normalizedPhone.startsWith('+')) {
                            if (normalizedPhone.startsWith('00')) {
                              normalizedPhone = '+' + normalizedPhone.substring(2);
                            } else if (normalizedPhone.startsWith('9') && normalizedPhone.length === 9) {
                              normalizedPhone = '+351' + normalizedPhone;
                            } else if (normalizedPhone.startsWith('351')) {
                              normalizedPhone = '+' + normalizedPhone;
                            } else {
                              normalizedPhone = '+' + normalizedPhone;
                            }
                          }

                          const response = await fetch(
                            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-player-password`,
                            {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                              },
                              body: JSON.stringify({ phone_number: normalizedPhone }),
                            }
                          );

                          const data = await response.json();

                          if (data.success) {
                            setSuccess(`Password resetada! Nova password: ${data.password}`);
                          } else {
                            setError(data.error || 'Erro ao resetar password');
                          }
                        } catch (err) {
                          setError('Erro ao resetar password');
                        } finally {
                          setLoading(false);
                        }
                      }}
                      className="text-sm text-[#007BFF] hover:text-[#0069d9] font-medium underline transition"
                      disabled={loading}
                    >
                      Esqueci a password
                    </button>
                  </div>
                </>
              )}

              {userType === 'organizer' && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setShowResetPassword(true);
                      setError('');
                    }}
                    className="text-sm text-[#007BFF] hover:text-[#0069d9] font-medium transition"
                  >
                    {t.auth.forgotPassword}
                  </button>
                </div>
              )}
            </form>
          )}

        </div>

        <div className="mt-8 text-center text-sm text-slate-600">
          <p>{t.auth.footer}</p>
          <a href="https://boostpadel.store" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 font-medium mt-2 inline-block">
            Ainda não tem conta? Adquira aqui
          </a>
        </div>
      </div>
    </div>
  );
}