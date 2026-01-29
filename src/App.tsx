import { useState, useEffect } from 'react';
import { supabase, Tournament } from './lib/supabase';
import TournamentList from './components/TournamentList';
import TournamentDetail from './components/TournamentDetail';
import CreateTournamentModal from './components/CreateTournamentModal';
import AddTeamModal from './components/AddTeamModal';
import MatchModal from './components/MatchModal';
import RegistrationLanding from './components/RegistrationLanding';
import LanguageSelector from './components/LanguageSelector';
import AuthForm from './components/AuthForm';
import UserSettings from './components/UserSettings';
import PlayerSettings from './components/PlayerSettings';
import LeagueManagement from './components/LeagueManagement';
import LiveTournamentView from './components/LiveTournamentView';
import PlayerDashboard from './components/PlayerDashboard';
import { useI18n } from './lib/i18nContext';
import { useAuth } from './lib/authContext';
import { useCustomLogo } from './lib/useCustomLogo';
import { LogOut, Settings, Menu, X, Trophy, CheckCircle } from 'lucide-react';

type View = 'list' | 'detail' | 'registration' | 'leagues' | 'live';

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

  const handleSelectTournament = (tournament: Tournament) => {
    setSelectedTournament(tournament);
    setView('detail');
  };

  const handleShowRegistration = (tournament: Tournament) => {
    setSelectedTournament(tournament);
    setView('registration');
  };

  const handleBack = () => {
    setView('list');
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
    } else {
      loadUserRole();
    }
  }, [user]);

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
            />
          )}

          {view === 'detail' && selectedTournament && (
            <TournamentDetail tournament={selectedTournament} onBack={handleBack} />
          )}

          {view === 'registration' && selectedTournament && (
            <RegistrationLanding tournament={selectedTournament} onClose={handleBack} />
          )}

          {view === 'leagues' && <LeagueManagement onBack={() => setView('list')} />}
        </main>
      </div>

      {showCreateTournament && (
        <CreateTournamentModal
          onClose={() => setShowCreateTournament(false)}
          onSuccess={handleCreateSuccess}
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
    </div>
  );
}

export default App;
