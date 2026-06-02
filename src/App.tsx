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
import OrganizerSponsors from './components/OrganizerSponsors';
import { LogOut, Settings, Menu, X, Trophy, CheckCircle, BarChart3, Users, Award } from 'lucide-react';

type View = 'list' | 'detail' | 'registration' | 'leagues' | 'live' | 'dashboard' | 'members' | 'sponsors';

function App() {
  const { t } = useI18n();
  const { user, loading: authLoading, signOut } = useAuth();
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
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [userRole, setUserRole] = useState<'organizer' | 'player' | null>(null);
  const [isIndependentOrganizer, setIsIndependentOrganizer] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);

  // License / contract validation
  const [needsLicense, setNeedsLicense] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [activatingLicense, setActivatingLicense] = useState(false);
  const [licenseError, setLicenseError] = useState('');
  const [licenseResult, setLicenseResult] = useState<{ plan?: string; contract_expires_at?: string } | null>(null);

  const handleSelectTournament = (tournament: Tournament) => {
    setSelectedTournament(tournament);
    setView('detail');
  };

  const handleShowRegistration = (tournament: Tournament) => {
    setSelectedTournament(tournament);
    setView('registration');
  };

  const handleBack = () => {
    setView(isIndependentOrganizer ? 'dashboard' : 'list');
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
    const checkForDeepLink = async () => {
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
        setIsLoadingDeepLink(false);
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
        }
      }
      setIsLoadingDeepLink(false);
    };

    checkForDeepLink();
  }, []);

  useEffect(() => {
    if (!user) {
      if (view !== 'registration' && view !== 'live') {
        setView('list');
        setSelectedTournament(null);
      }
      setShowCreateTournament(false);
      setShowAddTeam(false);
      setShowMatchModal(false);
      setShowSettings(false);
      setNeedsLicense(false);
    } else {
      checkLicenseAndLoadRole();
    }
  }, [user]);

  const checkLicenseAndLoadRole = async () => {
    if (!user) {
      setUserRole(null);
      return;
    }

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
      setIsIndependentOrganizer(!ownedClub);
      await loadUserRole();
      if (!ownedClub) setView('dashboard');
      return;
    }

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

    // Paid organizer: check contract expiration
    if (settings?.is_paid_organizer) {
      const { data: orgRecord } = await supabase
        .from('organizers')
        .select('subscription_expires_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (orgRecord?.subscription_expires_at && new Date(orgRecord.subscription_expires_at) < new Date()) {
        setLicenseMessage('A sua licença de organizador expirou. Introduza uma nova chave para renovar.');
        setNeedsLicense(true);
        return;
      }

      setNeedsLicense(false);
      setIsIndependentOrganizer(!ownedClub);
      setUserRole('organizer');
      if (!ownedClub) setView('dashboard');
      return;
    }

    // Club owner: check club contract
    if (ownedClub) {
      const hasValidContract = ownedClub.contract_expires_at &&
        new Date(ownedClub.contract_expires_at) > new Date();
      if (hasValidContract) {
        setNeedsLicense(false);
        setIsIndependentOrganizer(false);
        setUserRole('organizer');
        return;
      }
      setLicenseMessage(
        ownedClub.contract_expires_at
          ? 'O contrato do seu clube expirou. Introduza uma nova chave de licença.'
          : 'O seu clube ainda não foi ativado. Introduza a chave de licença que recebeu.'
      );
      setNeedsLicense(true);
      return;
    }

    // No settings or not paid — needs license
    if (!settings) {
      setLicenseMessage('Introduza a chave de licença que recebeu para ativar o seu acesso.');
      setNeedsLicense(true);
      return;
    }

    // Has settings but not paid organizer
    setLicenseMessage('Introduza a chave de licença que recebeu para ativar o seu acesso.');
    setNeedsLicense(true);
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

  if (authLoading || isLoadingDeepLink || (user && userRole === null)) {
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
    return <AuthForm />;
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src={logoUrl}
                alt="Logo"
                className="h-12 w-auto"
              />
              <div>
                <h1 className="text-4xl font-black text-[#111111]">{t.app.title}</h1>
                <p className="text-gray-600 mt-1 font-normal">{t.app.subtitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {user && (
                <>
                  {/* Desktop Menu */}
                  <div className="hidden md:flex items-center gap-3">
                    <span className="text-sm text-gray-600">{user.email}</span>
                    {isIndependentOrganizer && (
                      <>
                        <button
                          onClick={() => setView('dashboard')}
                          className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition shadow-md ${view === 'dashboard' ? 'bg-blue-700 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                        >
                          <BarChart3 className="w-4 h-4" />
                          Dashboard
                        </button>
                        <button
                          onClick={() => { setView('list'); setSelectedTournament(null); }}
                          className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition shadow-md ${view === 'list' || view === 'detail' ? 'bg-emerald-700 text-white' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                        >
                          <Trophy className="w-4 h-4" />
                          {t.nav.tournaments}
                        </button>
                        <button
                          onClick={() => setView('members')}
                          className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition shadow-md ${view === 'members' ? 'bg-purple-700 text-white' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
                        >
                          <Users className="w-4 h-4" />
                          {(t as any).organizerNav?.members || 'Membros'}
                        </button>
                        <button
                          onClick={() => setView('sponsors')}
                          className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition shadow-md ${view === 'sponsors' ? 'bg-amber-700 text-white' : 'bg-amber-600 text-white hover:bg-amber-700'}`}
                        >
                          <Award className="w-4 h-4" />
                          Sponsors
                        </button>
                      </>
                    )}
                    {userRole === 'organizer' && (
                      <button
                        onClick={() => setView('leagues')}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 transition shadow-md"
                      >
                        <Trophy className="w-4 h-4" />
                        {t.nav.leagues}
                      </button>
                    )}
                    <button
                      onClick={() => setShowSettings(true)}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-[#007BFF] rounded-lg hover:bg-[#0069d9] transition shadow-md"
                    >
                      <Settings className="w-4 h-4" />
                      {t.settings.button}
                    </button>
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-[#111111] bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                    >
                      <LogOut className="w-4 h-4" />
                      {t.auth.signOut}
                    </button>
                  </div>

                  {/* Mobile Menu Button */}
                  <button
                    onClick={() => setShowMobileMenu(!showMobileMenu)}
                    className="md:hidden p-2 text-white bg-[#007BFF] rounded-lg hover:bg-[#0069d9] transition shadow-md"
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

          {/* Mobile Dropdown Menu */}
          {user && showMobileMenu && (
            <div className="md:hidden mt-4 p-4 bg-white rounded-lg shadow-xl border border-gray-200">
              <div className="space-y-3">
                <div className="text-sm text-gray-600 pb-3 border-b border-gray-200">
                  {user.email}
                </div>
                <LanguageSelector />
                {isIndependentOrganizer && (
                  <>
                    <button
                      onClick={() => { setView('dashboard'); setShowMobileMenu(false); }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition shadow-md"
                    >
                      <BarChart3 className="w-4 h-4" />
                      Dashboard
                    </button>
                    <button
                      onClick={() => { setView('list'); setSelectedTournament(null); setShowMobileMenu(false); }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition shadow-md"
                    >
                      <Trophy className="w-4 h-4" />
                      {t.nav.tournaments}
                    </button>
                    <button
                      onClick={() => { setView('members'); setShowMobileMenu(false); }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition shadow-md"
                    >
                      <Users className="w-4 h-4" />
                      {(t as any).organizerNav?.members || 'Membros'}
                    </button>
                    <button
                      onClick={() => { setView('sponsors'); setShowMobileMenu(false); }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition shadow-md"
                    >
                      <Award className="w-4 h-4" />
                      Sponsors
                    </button>
                  </>
                )}
                {userRole === 'organizer' && (
                  <button
                    onClick={() => {
                      setView('leagues');
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 transition shadow-md"
                  >
                    <Trophy className="w-4 h-4" />
                    {t.nav.leagues}
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowSettings(true);
                    setShowMobileMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-[#007BFF] rounded-lg hover:bg-[#0069d9] transition shadow-md"
                >
                  <Settings className="w-4 h-4" />
                  {t.settings.button}
                </button>
                <button
                  onClick={() => {
                    handleSignOut();
                    setShowMobileMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm font-bold text-[#111111] bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  <LogOut className="w-4 h-4" />
                  {t.auth.signOut}
                </button>
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

          {view === 'leagues' && <LeagueManagement onBack={() => setView(isIndependentOrganizer ? 'dashboard' : 'list')} />}

          {view === 'dashboard' && isIndependentOrganizer && (
            <OrganizerDashboard onNavigate={(v) => setView(v as View)} />
          )}

          {view === 'members' && isIndependentOrganizer && <OrganizerMembers />}

          {view === 'sponsors' && isIndependentOrganizer && <OrganizerSponsors />}
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
