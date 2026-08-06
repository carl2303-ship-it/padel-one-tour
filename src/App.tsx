import { useState, useEffect } from 'react';
import { supabase, Tournament } from './lib/supabase';
import TournamentList from './components/TournamentList';
import TournamentDetail from './components/TournamentDetail';
import CreateTournamentModal from './components/CreateTournamentModal';
import AddTeamModal from './components/AddTeamModal';
import MatchModal from './components/MatchModal';
import RegistrationLanding from './components/RegistrationLanding';
import SuperTeamRegistration from './components/SuperTeamRegistration';
import LanguageSelector from './components/LanguageSelector';
import AuthForm from './components/AuthForm';
import UserSettings from './components/UserSettings';
import PlayerSettings from './components/PlayerSettings';
import LeagueManagement from './components/LeagueManagement';
import LiveTournamentView from './components/LiveTournamentView';
import PlayerDashboard from './components/PlayerDashboard';
import TournamentSimulator from './components/TournamentSimulator';
import { useI18n } from './lib/i18nContext';
import { useAuth } from './lib/authContext';
import { useCustomLogo } from './lib/useCustomLogo';
import OrganizerDashboard from './components/OrganizerDashboard';
import OrganizerMembers from './components/OrganizerMembers';
import OrganizerMetrics from './components/OrganizerMetrics';
import OrganizerSponsors from './components/OrganizerSponsors';
import { fetchClientModules } from './lib/useClientModules';
import { loadOrganizerBrandColors } from './lib/organizerBrandColors';
import { LogOut, Settings, Menu, X, Trophy, CheckCircle } from 'lucide-react';

type View = 'list' | 'detail' | 'registration' | 'leagues' | 'live' | 'dashboard' | 'members' | 'sponsors' | 'metrics';

function App() {
  const { t } = useI18n();
  const { user, loading: authLoading, signOut } = useAuth();
  const userId = user?.id;
  const { logoUrl } = useCustomLogo();
  const [view, setView] = useState<View>('list');
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [showCreateTournament, setShowCreateTournament] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isLoadingDeepLink, setIsLoadingDeepLink] = useState(true);
  const [registrationLinkError, setRegistrationLinkError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [userRole, setUserRole] = useState<'organizer' | 'player' | null>(null);
  const [isIndependentOrganizer, setIsIndependentOrganizer] = useState(false);
  /** Hub Tour (Dashboard, Membros, Métricas, Sponsors) — organizadores independentes ou clubes lite (torneios sem manager). */
  const [showOrganizerHub, setShowOrganizerHub] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);

  // License / contract validation
  const [needsLicense, setNeedsLicense] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [activatingLicense, setActivatingLicense] = useState(false);
  const [licenseError, setLicenseError] = useState('');
  const [licenseResult, setLicenseResult] = useState<{ plan?: string; contract_expires_at?: string } | null>(null);
  const [needsModule, setNeedsModule] = useState(false);
  const [moduleMessage, setModuleMessage] = useState('');

  const handleSelectTournament = (tournament: Tournament) => {
    setSelectedTournament(tournament);
    setView('detail');
  };

  const handleShowRegistration = (tournament: Tournament) => {
    setSelectedTournament(tournament);
    setView('registration');
  };

  const handleBack = () => {
    setView(showOrganizerHub ? 'dashboard' : 'list');
    setSelectedTournament(null);
    setRefreshKey((k) => k + 1);
  };

  const handleCreateSuccess = () => {
    setRefreshKey((k) => k + 1);
  };

  const handleTeamSuccess = () => {
    setRefreshKey((k) => k + 1);
    if (selectedTournament) {
      setView('detail');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setView('list');
    setSelectedTournament(null);
    setShowCreateTournament(false);
    setShowAddTeam(false);
    setShowMatchModal(false);
    setShowSettings(false);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    if (user && userRole === 'organizer') {
      loadOrganizerBrandColors(user.id);
    }
  }, [user, userRole]);

  useEffect(() => {
    const checkForDeepLink = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const tournamentId = urlParams.get('register');
        const paymentStatus = urlParams.get('payment');
        const pathname = window.location.pathname;

        if (paymentStatus === 'success') {
          setPaymentSuccess(true);
          const cleanUrl = window.location.pathname;
          window.history.replaceState({}, '', cleanUrl);
          setTimeout(() => {
            setPaymentSuccess(false);
          }, 8000);
        }

        const liveMatch = pathname.match(/^\/tournament\/([^/]+)\/live$/);
        if (liveMatch) {
          const tournamentIdFromPath = liveMatch[1];
          const { data: tournament } = await supabase
            .from('tournaments')
            .select('*')
            .eq('id', tournamentIdFromPath)
            .maybeSingle();

          if (tournament) {
            setSelectedTournament(tournament);
            setView('live');
          }
          return;
        }

        if (tournamentId) {
          const { data: tournament } = await supabase
            .from('tournaments')
            .select('*')
            .eq('id', tournamentId)
            .maybeSingle();

          if (tournament) {
            setSelectedTournament(tournament);
            setView('registration');
            setRegistrationLinkError(null);
          } else {
            const { data: rpcTournament } = await supabase.rpc('get_public_tournament', {
              p_tournament_id: tournamentId,
            });
            if (rpcTournament && typeof rpcTournament === 'object' && (rpcTournament as { id?: string }).id) {
              setSelectedTournament(rpcTournament as Tournament);
              setView('registration');
              setRegistrationLinkError(null);
            } else {
              setRegistrationLinkError('Torneio não encontrado ou inscrições não estão abertas.');
            }
          }
        }
      } catch (err) {
        console.error('[DeepLink] error:', err);
        setRegistrationLinkError('Não foi possível abrir o link. Tente novamente.');
      } finally {
        setIsLoadingDeepLink(false);
      }
    };

    checkForDeepLink();
  }, []);

  useEffect(() => {
    if (!userId) {
      if (view !== 'registration' && view !== 'live') {
        setView('list');
        setSelectedTournament(null);
      }
      setShowCreateTournament(false);
      setShowAddTeam(false);
      setShowMatchModal(false);
      setShowSettings(false);
      setNeedsLicense(false);
      setShowOrganizerHub(false);
      setIsIndependentOrganizer(false);
    } else {
      checkLicenseAndLoadRole();
    }
  }, [userId]);

  const checkLicenseAndLoadRole = async () => {
    if (!user) {
      setUserRole(null);
      return;
    }

    const hasPublicDeepLink =
      view === 'registration' ||
      view === 'live' ||
      !!new URLSearchParams(window.location.search).get('register');

    const goOrganizerHome = () => {
      if (!hasPublicDeepLink) {
        setView((currentView) => currentView === 'list' ? 'dashboard' : currentView);
      }
    };

    // Check if user owns a club (needed for multiple paths below)
    const { data: ownedClub } = await supabase
      .from('clubs')
      .select('id, contract_expires_at')
      .eq('owner_id', user.id)
      .maybeSingle();

    // Super admins bypass license but still detect independent organizer
    const { data: saRecord } = await supabase
      .from('super_admins')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (saRecord) {
      setNeedsLicense(false);
      if (ownedClub) {
        const mods = await fetchClientModules('club', ownedClub.id);
        const liteClubMode = mods.hasTournaments && !mods.hasManager;
        setShowOrganizerHub(liteClubMode);
        setIsIndependentOrganizer(false);
        if (liteClubMode) goOrganizerHome();
      } else {
        setShowOrganizerHub(true);
        setIsIndependentOrganizer(true);
        goOrganizerHome();
      }
      await loadUserRole();
      return;
    }

    const isBoostSaasOrganizer = user.user_metadata?.source === 'boost_saas';

    // Check user_logo_settings
    const { data: settings } = await supabase
      .from('user_logo_settings')
      .select('role, is_paid_organizer')
      .eq('user_id', user.id)
      .maybeSingle();

    // Players don't need license
    if (settings?.role === 'player') {
      setNeedsLicense(false);
      setUserRole('player');
      return;
    }

    // Club owner takes priority over independent organizer flags
    if (ownedClub) {
      const hasValidContract = ownedClub.contract_expires_at &&
        new Date(ownedClub.contract_expires_at) > new Date();
      if (hasValidContract) {
        const mods = await fetchClientModules('club', ownedClub.id);
        if (!mods.hasTournaments) {
          setNeedsModule(true);
          setModuleMessage('O módulo de Torneios não está ativo para o seu clube. Contacte o suporte Padel One.');
          setNeedsLicense(false);
          setUserRole('organizer');
          return;
        }
        const liteClubMode = mods.hasTournaments && !mods.hasManager;
        setNeedsModule(false);
        setNeedsLicense(false);
        setShowOrganizerHub(liteClubMode);
        setIsIndependentOrganizer(false);
        setUserRole('organizer');
        if (liteClubMode) goOrganizerHome();
        return;
      }
      setLicenseMessage(
        ownedClub.contract_expires_at
          ? 'O contrato do seu clube expirou. Introduza uma nova chave de licença.'
          : 'O seu clube ainda não foi ativado. Introduza a chave de licença que recebeu.'
      );
      setNeedsLicense(true);
      setUserRole('organizer');
      return;
    }

    // Independent paid organizer (no club ownership)
    if (settings?.is_paid_organizer || isBoostSaasOrganizer) {
      const { data: orgRecord } = await supabase
        .from('organizers')
        .select('subscription_expires_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (orgRecord?.subscription_expires_at && new Date(orgRecord.subscription_expires_at) < new Date()) {
        setLicenseMessage('A sua licença de organizador expirou. Introduza uma nova chave para renovar.');
        setNeedsLicense(true);
        setUserRole('organizer');
        return;
      }

      const mods = await fetchClientModules('organizer', user.id);
      if (!mods.hasTournaments && !isBoostSaasOrganizer) {
        setNeedsModule(true);
        setModuleMessage('O módulo de Torneios não está ativo para a sua conta. Contacte o suporte Padel One.');
        setNeedsLicense(false);
        setUserRole('organizer');
        return;
      }

      setNeedsModule(false);
      setNeedsLicense(false);
      setShowOrganizerHub(true);
      setIsIndependentOrganizer(true);
      setUserRole('organizer');
      goOrganizerHome();
      return;
    }

    // No settings or not paid — needs license
    setLicenseMessage('Introduza a chave de licença que recebeu para ativar o seu acesso.');
    setNeedsLicense(true);
    setUserRole(settings?.role || 'organizer');
  };

  const loadUserRole = async () => {
    if (!user) {
      setUserRole(null);
      return;
    }

    const { data } = await supabase
      .from('user_logo_settings')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (data?.role) {
      setUserRole(data.role);
    } else {
      setUserRole('organizer');
    }
  };

  const handleActivateLicenseTour = async () => {
    if (!licenseKey.trim() || !user) return;
    setActivatingLicense(true);
    setLicenseError('');

    try {
      const baseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://rqiwnxcexsccguruiteq.supabase.co';
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
      const resp = await fetch(`${baseUrl}/functions/v1/activate-license`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ license_key: licenseKey.trim(), user_id: user.id }),
      });
      const data = await resp.json();

      if (!data?.ok) {
        setLicenseError(data?.error || 'Chave inválida');
        setActivatingLicense(false);
        return;
      }

      setLicenseResult(data);

      setTimeout(async () => {
        await signOut();
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('sb-')) localStorage.removeItem(key);
        });
        window.location.reload();
      }, 2500);
    } catch {
      setLicenseError('Erro ao ativar licença. Tente novamente.');
    }
    setActivatingLicense(false);
  };

  const handleCancelLicenseTour = async () => {
    await signOut();
    setNeedsLicense(false);
    setLicenseKey('');
    setLicenseResult(null);
    setLicenseError('');
  };

  const isPublicRegistrationOrLive =
    view === 'registration' ||
    view === 'live' ||
    !!new URLSearchParams(window.location.search).get('register');

  if (authLoading || isLoadingDeepLink || (user && userRole === null && !isPublicRegistrationOrLive)) {
    return (
      <div className="min-h-screen bg-[#f7f7f7] flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4 animate-pulse">
            <img
              src={logoUrl}
              alt="Logo"
              className="h-24 w-auto mx-auto"
            />
          </div>
          <p className="text-gray-600">{t.message.loading}</p>
        </div>
      </div>
    );
  }

  if (!user && view !== 'registration' && view !== 'live') {
    if (registrationLinkError) {
      return (
        <div className="min-h-screen bg-[#f7f7f7] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
            <Trophy className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Link indisponível</h2>
            <p className="text-sm text-gray-600">{registrationLinkError}</p>
          </div>
        </div>
      );
    }
    return <AuthForm />;
  }

  // Module not active screen
  if (user && needsModule && view !== 'registration' && view !== 'live') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <img src={logoUrl} alt="Logo" className="h-16 w-auto mx-auto mb-4" />
          <div className="text-3xl mb-3">🏆</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Módulo Torneios Inativo</h2>
          <p className="text-sm text-gray-500 mb-6">{moduleMessage}</p>
          <button
            onClick={handleCancelLicenseTour}
            className="w-full py-2 text-gray-500 text-sm hover:text-gray-700"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  // License activation screen
  if (user && needsLicense && view !== 'registration' && view !== 'live') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <img src={logoUrl} alt="Logo" className="h-16 w-auto mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900">Ativar Licença</h2>
            <p className="text-sm text-gray-500 mt-2">{licenseMessage}</p>
          </div>

          {licenseResult ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <div className="text-2xl mb-2">✅</div>
              <p className="text-green-800 font-semibold">Licença ativada com sucesso!</p>
              {licenseResult.plan && (
                <p className="text-green-700 text-sm mt-1">Plano: <strong>{licenseResult.plan}</strong></p>
              )}
              {licenseResult.contract_expires_at && (
                <p className="text-green-700 text-sm">Expira: <strong>{new Date(licenseResult.contract_expires_at).toLocaleDateString('pt-PT')}</strong></p>
              )}
              <p className="text-green-600 text-xs mt-2">A redirecionar...</p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Chave de Licença</label>
                <input
                  type="text"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                  placeholder="PADEL-XXXX-XXXX-XXXX"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-lg font-mono tracking-wider"
                />
              </div>

              {licenseError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                  <p className="text-red-700 text-sm text-center">{licenseError}</p>
                </div>
              )}

              <button
                onClick={handleActivateLicenseTour}
                disabled={activatingLicense || !licenseKey.trim()}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {activatingLicense ? 'A ativar...' : 'Ativar Licença'}
              </button>

              <button
                onClick={handleCancelLicenseTour}
                className="w-full mt-3 py-2 text-gray-500 text-sm hover:text-gray-700 transition-colors"
              >
                Sair / Cancelar
              </button>

              <p className="text-center text-xs text-gray-400 mt-4">
                Não tem uma chave? Contacte o suporte Padel One.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (view === 'live') {
    return <LiveTournamentView />;
  }

  return (
    <div className="min-h-screen bg-[#f7f7f7]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <img
                src={logoUrl}
                alt="Logo"
                className="h-16 sm:h-20 w-auto object-contain flex-shrink-0"
              />
              <h1 className="text-2xl sm:text-3xl font-black text-[#111111] whitespace-nowrap truncate">
                {t.app.title}
              </h1>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {user && (
                <>
                  <div className="hidden md:flex items-center gap-1">
                    {showOrganizerHub && (
                      <nav className="flex items-center gap-1 mr-2">
                        {([
                          { id: 'dashboard' as View, label: 'Dashboard' },
                          { id: 'list' as View, label: t.nav.tournaments },
                          { id: 'members' as View, label: 'Membros' },
                          { id: 'sponsors' as View, label: 'Sponsors' },
                        ]).map((item) => {
                          const active =
                            view === item.id ||
                            (item.id === 'list' && (view === 'detail' || view === 'leagues'));
                          return (
                            <button
                              key={item.id}
                              onClick={() => {
                                if (item.id === 'list') setSelectedTournament(null);
                                setView(item.id);
                              }}
                              className={`px-3 py-2 text-sm font-semibold rounded-lg transition ${
                                active
                                  ? 'text-blue-600 bg-blue-50'
                                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                              }`}
                            >
                              {item.label}
                            </button>
                          );
                        })}
                      </nav>
                    )}
                    <button
                      onClick={() => setShowSettings(true)}
                      className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
                      title={t.settings.button}
                    >
                      <Settings className="w-5 h-5" />
                    </button>
                    <button
                      onClick={handleSignOut}
                      className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
                      title={t.auth.signOut}
                    >
                      <LogOut className="w-5 h-5" />
                    </button>
                  </div>
                  <button
                    onClick={() => setShowMobileMenu(!showMobileMenu)}
                    className="md:hidden p-2 text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition"
                  >
                    {showMobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                  </button>
                </>
              )}
              <div className="hidden md:block">
                <LanguageSelector />
              </div>
            </div>
          </div>

          {user && showMobileMenu && (
            <div className="md:hidden mt-4 p-4 bg-white rounded-xl shadow-lg border border-gray-200">
              <div className="space-y-1">
                <div className="text-sm text-gray-500 pb-3 mb-2 border-b border-gray-100">
                  {user.email}
                </div>
                <LanguageSelector />
                {showOrganizerHub && (
                  <>
                    <button
                      onClick={() => { setView('dashboard'); setShowMobileMenu(false); }}
                      className={`w-full text-left px-3 py-2.5 text-sm font-semibold rounded-lg ${view === 'dashboard' ? 'text-blue-600 bg-blue-50' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      Dashboard
                    </button>
                    <button
                      onClick={() => { setView('list'); setSelectedTournament(null); setShowMobileMenu(false); }}
                      className={`w-full text-left px-3 py-2.5 text-sm font-semibold rounded-lg ${view === 'list' || view === 'detail' || view === 'leagues' ? 'text-blue-600 bg-blue-50' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      {t.nav.tournaments}
                    </button>
                    <button
                      onClick={() => { setView('members'); setShowMobileMenu(false); }}
                      className={`w-full text-left px-3 py-2.5 text-sm font-semibold rounded-lg ${view === 'members' ? 'text-blue-600 bg-blue-50' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      Membros
                    </button>
                    <button
                      onClick={() => { setView('sponsors'); setShowMobileMenu(false); }}
                      className={`w-full text-left px-3 py-2.5 text-sm font-semibold rounded-lg ${view === 'sponsors' ? 'text-blue-600 bg-blue-50' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      Sponsors
                    </button>
                  </>
                )}
                <div className="border-t border-gray-100 pt-2 mt-2 space-y-1">
                  <button
                    onClick={() => { setShowSettings(true); setShowMobileMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-lg"
                  >
                    <Settings className="w-4 h-4" />
                    {t.settings.button}
                  </button>
                  <button
                    onClick={() => { handleSignOut(); setShowMobileMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-lg"
                  >
                    <LogOut className="w-4 h-4" />
                    {t.auth.signOut}
                  </button>
                </div>
              </div>
            </div>
          )}
        </header>

        {paymentSuccess && (
          <div className="mb-6 bg-green-50 border-2 border-green-500 rounded-xl p-6 animate-fade-in shadow-lg">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-green-900 mb-2">
                  {t.payment?.successTitle || 'Pagamento Confirmado!'}
                </h3>
                <p className="text-green-800 mb-2">
                  {t.payment?.successMessage || 'A sua inscrição foi processada com sucesso. Receberá um email de confirmação em breve.'}
                </p>
                <p className="text-sm text-green-700">
                  {t.payment?.successNote || 'O organizador irá rever a sua inscrição e entrará em contacto se necessário.'}
                </p>
              </div>
              <button
                onClick={() => setPaymentSuccess(false)}
                className="flex-shrink-0 text-green-600 hover:text-green-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        <main key={refreshKey}>
          {view === 'list' && userRole === 'player' && <PlayerDashboard />}

          {view === 'list' && userRole === 'organizer' && (
            <TournamentList
              onSelectTournament={handleSelectTournament}
              onCreateTournament={() => setShowCreateTournament(true)}
              onShowRegistration={handleShowRegistration}
              onOpenSimulator={() => setShowSimulator(true)}
              onOpenLeagues={showOrganizerHub || userRole === 'organizer' ? () => setView('leagues') : undefined}
            />
          )}

          {view === 'detail' && selectedTournament && (
            <TournamentDetail tournament={selectedTournament} onBack={handleBack} />
          )}

          {view === 'registration' && selectedTournament && (
            selectedTournament.format === 'super_teams'
              ? <SuperTeamRegistration tournament={selectedTournament} onClose={handleBack} />
              : <RegistrationLanding tournament={selectedTournament} onClose={handleBack} />
          )}

          {view === 'leagues' && <LeagueManagement onBack={() => setView(showOrganizerHub ? 'dashboard' : 'list')} />}

          {view === 'dashboard' && showOrganizerHub && (
            <OrganizerDashboard
              onNavigate={(v) => setView(v as View)}
              onOpenTournament={async (tournamentId) => {
                const { data } = await supabase
                  .from('tournaments')
                  .select('*')
                  .eq('id', tournamentId)
                  .maybeSingle();
                if (data) {
                  setSelectedTournament(data);
                  setView('detail');
                }
              }}
            />
          )}

          {view === 'members' && showOrganizerHub && <OrganizerMembers />}

          {view === 'metrics' && showOrganizerHub && (
            <OrganizerMetrics
              onOpenTournament={async (tournamentId) => {
                const { data } = await supabase
                  .from('tournaments')
                  .select('*')
                  .eq('id', tournamentId)
                  .maybeSingle();
                if (data) {
                  setSelectedTournament(data);
                  setView('detail');
                }
              }}
            />
          )}

          {view === 'sponsors' && showOrganizerHub && <OrganizerSponsors />}
        </main>
      </div>

      {showCreateTournament && (
        <CreateTournamentModal
          onClose={() => setShowCreateTournament(false)}
          onSuccess={handleCreateSuccess}
          isIndependentOrganizer={isIndependentOrganizer}
        />
      )}

      {showAddTeam && selectedTournament && (
        <AddTeamModal
          tournamentId={selectedTournament.id}
          onClose={() => setShowAddTeam(false)}
          onSuccess={handleTeamSuccess}
        />
      )}

      {showMatchModal && selectedTournament && (
        <MatchModal
          tournamentId={selectedTournament.id}
          tournament={selectedTournament}
          onClose={() => setShowMatchModal(false)}
          onSuccess={handleTeamSuccess}
        />
      )}

      {showSettings && userRole === 'organizer' && (
        <UserSettings onClose={() => setShowSettings(false)} />
      )}

      {showSettings && userRole === 'player' && (
        <PlayerSettings onClose={() => setShowSettings(false)} />
      )}

      {showSimulator && (
        <TournamentSimulator onClose={() => setShowSimulator(false)} />
      )}
    </div>
  );
}

export default App;
