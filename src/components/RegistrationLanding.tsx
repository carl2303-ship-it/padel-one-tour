import { useState, useEffect } from 'react';
import { supabase, Tournament, TournamentCategory } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import { useCustomLogo } from '../lib/useCustomLogo';
import { Trophy, Calendar, Users, MapPin, Clock, CheckCircle, CreditCard, User, LogIn, ArrowRight, Phone, ChevronDown } from 'lucide-react';

const sendWelcomeEmail = async (
  playerEmail: string,
  playerName: string,
  playerPhone: string,
  tournamentName: string,
  categoryName?: string
) => {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-player-welcome-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          email: playerEmail,
          tournamentName,
          categoryName,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to send welcome email:', error);
    } else {
      const result = await response.json();
      console.log('Welcome email sent:', result);
    }
  } catch (error) {
    console.error('Error sending welcome email:', error);
  }
};

const notifyOrganizer = async (
  tournamentId: string,
  playerName: string,
  partnerName?: string,
  categoryName?: string,
  isTeam?: boolean
) => {
  try {
    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-organizer-registration`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          tournamentId,
          playerName,
          partnerName,
          categoryName,
          isTeam: isTeam ?? false,
        }),
      }
    );
  } catch (error) {
    console.error('Error notifying organizer:', error);
  }
};

type RegistrationLandingProps = {
  tournament: Tournament;
  onClose: () => void;
};

type RegistrationStep = 'check_account' | 'login' | 'register';

interface PlayerAccount {
  phone_number: string;
  name: string;
  email: string | null;
  user_id: string | null;
}

export default function RegistrationLanding({ tournament, onClose }: RegistrationLandingProps) {
  const { t, language } = useI18n();
  const { user } = useAuth();
  const { logoUrl } = useCustomLogo(tournament.user_id);
  const [step, setStep] = useState<RegistrationStep>('check_account');
  const [checkPhone, setCheckPhone] = useState('');
  const [existingAccount, setExistingAccount] = useState<PlayerAccount | null>(null);
  const [isNewPlayer, setIsNewPlayer] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loggedInPlayer, setLoggedInPlayer] = useState<PlayerAccount | null>(null);

  const [formData, setFormData] = useState({
    teamName: '',
    player1Name: '',
    player1Email: '',
    player1Phone: '',
    player2Name: '',
    player2Email: '',
    player2Phone: '',
    categoryId: '',
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [registeredTeamsCount, setRegisteredTeamsCount] = useState(0);
  const [categories, setCategories] = useState<TournamentCategory[]>([]);
  const [categoryTeams, setCategoryTeams] = useState<any[]>([]);
  const [categoryPlayersCount, setCategoryPlayersCount] = useState(0);
  const [newAccountCredentials, setNewAccountCredentials] = useState<{name: string, phone: string, password: string}[]>([]);
  const [pendingSignOut, setPendingSignOut] = useState(false);
  const [partnerLookupLoading, setPartnerLookupLoading] = useState(false);
  const [partnerFound, setPartnerFound] = useState(false);
  const [showRegisteredList, setShowRegisteredList] = useState(false);
  const [allRegistered, setAllRegistered] = useState<any[]>([]);
  const [payAtClubSelected, setPayAtClubSelected] = useState(false);

  const isIndividualFormat = () => {
    // Formatos que são sempre individuais
    if (tournament.format === 'mixed_american' || 
        tournament.format === 'crossed_playoffs' || 
        tournament.format === 'mixed_gender') {
      return true;
    }
    if (formData.categoryId) {
      const category = categories.find(c => c.id === formData.categoryId);
      if (category) {
        if (category.format === 'individual_groups_knockout' || category.format === 'mixed_american' || category.format === 'crossed_playoffs' || category.format === 'mixed_gender') {
          return true;
        }
        if (category.format === 'round_robin') {
          return tournament.round_robin_type === 'individual';
        }
        return false;
      }
    }
    return (tournament.format === 'round_robin' && tournament.round_robin_type === 'individual') ||
           tournament.format === 'individual_groups_knockout' ||
           tournament.format === 'mixed_american' ||
           tournament.format === 'crossed_playoffs' ||
           tournament.format === 'mixed_gender';
  };

  useEffect(() => {
    fetchTeamsCount();
    fetchCategories();
    checkLoggedInPlayer();
  }, [tournament.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('enrolled') === '1') {
      fetchAllRegistered();
      setShowRegisteredList(true);
    }
  }, [tournament.id]);

  useEffect(() => {
    if (formData.categoryId && categories.length > 0) {
      fetchCategoryTeams(formData.categoryId);
    } else {
      setCategoryTeams([]);
      setCategoryPlayersCount(0);
    }
  }, [formData.categoryId, categories]);

  const checkLoggedInPlayer = async () => {
    if (!user) return;

    const { data: playerAccount } = await supabase
      .from('player_accounts')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (playerAccount) {
      setLoggedInPlayer(playerAccount);
      setFormData(prev => ({
        ...prev,
        player1Name: playerAccount.name || '',
        player1Email: playerAccount.email || '',
        player1Phone: playerAccount.phone_number || '',
      }));
      setStep('register');
    }
  };

  const fetchCategoryTeams = async (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    const isCategoryIndividual = category?.format === 'individual_groups_knockout' ||
      category?.format === 'mixed_american' ||
      category?.format === 'crossed_playoffs' ||
      category?.format === 'mixed_gender' ||
      (category?.format === 'round_robin' && tournament.round_robin_type === 'individual');

    if (isCategoryIndividual) {
      const { data: players, count } = await supabase
        .from('players')
        .select('id, name', { count: 'exact' })
        .eq('tournament_id', tournament.id)
        .eq('category_id', categoryId)
        .order('name');

      if (players) {
        setCategoryTeams(players.map(p => ({ id: p.id, name: p.name, isPlayer: true })));
        setCategoryPlayersCount(count || 0);
      }
    } else {
      const { data, count } = await supabase
        .from('teams')
        .select(`
          id,
          name,
          player1:players!teams_player1_id_fkey(name),
          player2:players!teams_player2_id_fkey(name)
        `, { count: 'exact' })
        .eq('tournament_id', tournament.id)
        .eq('category_id', categoryId)
        .order('name');

      if (data) {
        setCategoryTeams(data);
        setCategoryPlayersCount(count || 0);
      }
    }
  };

  const fetchTeamsCount = async () => {
    const isIndividual = (tournament.format === 'round_robin' && tournament.round_robin_type === 'individual') ||
                         tournament.format === 'individual_groups_knockout' ||
                         tournament.format === 'mixed_american' ||
                         tournament.format === 'crossed_playoffs' ||
                         tournament.format === 'mixed_gender';

    if (isIndividual) {
      const { count } = await supabase
        .from('players')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournament.id);
      setRegisteredTeamsCount(count || 0);
    } else {
      const { count } = await supabase
        .from('teams')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournament.id);
      setRegisteredTeamsCount(count || 0);
    }
  };

  const fetchAllRegistered = async () => {
    const isIndividual = (tournament.format === 'round_robin' && tournament.round_robin_type === 'individual') ||
                         tournament.format === 'individual_groups_knockout' ||
                         tournament.format === 'mixed_american' ||
                         tournament.format === 'crossed_playoffs' ||
                         tournament.format === 'mixed_gender';

    if (isIndividual) {
      const { data } = await supabase
        .from('players')
        .select('id, name, category_id')
        .eq('tournament_id', tournament.id)
        .order('created_at', { ascending: true });
      setAllRegistered(data || []);
    } else {
      const { data } = await supabase
        .from('teams')
        .select(`
          id,
          name,
          category_id,
          player1:players!teams_player1_id_fkey(name),
          player2:players!teams_player2_id_fkey(name)
        `)
        .eq('tournament_id', tournament.id)
        .order('created_at', { ascending: true });

      const formatted = (data || []).map(team => ({
        id: team.id,
        name: team.name,
        category_id: team.category_id,
        player1_name: team.player1?.name,
        player2_name: team.player2?.name,
      }));
      setAllRegistered(formatted);
    }
  };

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('tournament_categories')
      .select('*')
      .eq('tournament_id', tournament.id)
      .order('name');

    if (data) {
      setCategories(data);
    }
  };

  const getRegistrationFee = () => {
    if (formData.categoryId) {
      const category = categories.find(c => c.id === formData.categoryId);
      if (category?.registration_fee !== undefined && category?.registration_fee !== null) {
        return category.registration_fee;
      }
      return tournament.registration_fee || 0;
    }
    return tournament.registration_fee || 0;
  };

  const getCategoryMaxSlots = () => {
    // Se uma categoria está selecionada, retorna o max dessa categoria
    if (formData.categoryId) {
      const category = categories.find(c => c.id === formData.categoryId);
      return category?.max_teams || 0;
    }
    // Caso contrário, soma o max de todas as categorias
    return categories.reduce((sum, c) => sum + (c.max_teams || 0), 0);
  };

  const isCategoryFull = () => {
    const maxSlots = getCategoryMaxSlots();
    if (formData.categoryId) {
      return categoryPlayersCount >= maxSlots;
    }
    return registeredTeamsCount >= maxSlots;
  };

  const getCategorySpotsRemaining = () => {
    const maxSlots = getCategoryMaxSlots();
    if (formData.categoryId) {
      return maxSlots - categoryPlayersCount;
    }
    return maxSlots - registeredTeamsCount;
  };

  const handleCheckPhone = async () => {
    if (!checkPhone) {
      setError(t.registration.pleaseEnterPhone);
      return;
    }

    setLoading(true);
    setError('');

    const normalizedPhone = checkPhone.replace(/\s+/g, '').startsWith('+')
      ? checkPhone.replace(/\s+/g, '')
      : '+' + checkPhone.replace(/\s+/g, '');

    const { data: account } = await supabase
      .from('player_accounts')
      .select('*')
      .eq('phone_number', normalizedPhone)
      .maybeSingle();

    if (account) {
      setExistingAccount(account);
      setFormData(prev => ({
        ...prev,
        player1Name: account.name || '',
        player1Email: account.email || '',
        player1Phone: normalizedPhone,
      }));
      setStep('login');
    } else {
      setIsNewPlayer(true);
      setFormData(prev => ({
        ...prev,
        player1Phone: normalizedPhone,
      }));
      setStep('register');
    }

    setLoading(false);
  };

  const handleLogin = async () => {
    if (!existingAccount || !loginPassword) {
      setLoginError(t.registration.pleaseEnterPassword);
      return;
    }

    setLoginLoading(true);
    setLoginError('');

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-player-login-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ phone_number: existingAccount.phone_number }),
        }
      );

      const emailData = await response.json();

      if (!emailData?.success || !emailData?.email) {
        setLoginError('Erro ao verificar conta');
        setLoginLoading(false);
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: emailData.email,
        password: loginPassword,
      });

      if (error) {
        setLoginError('Password incorreta');
        setLoginLoading(false);
        return;
      }

      setLoggedInPlayer(existingAccount);
      setStep('register');
    } catch (err) {
      setLoginError('Erro ao fazer login');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSkipLogin = () => {
    if (existingAccount) {
      setFormData(prev => ({
        ...prev,
        player1Name: existingAccount.name || '',
        player1Email: existingAccount.email || '',
        player1Phone: existingAccount.phone_number,
      }));
    }
    setStep('register');
  };

  const lookupPartnerByPhone = async (phone: string) => {
    if (!phone || phone.length < 8) {
      setPartnerFound(false);
      return;
    }

    setPartnerLookupLoading(true);

    const normalizedPhone = phone.replace(/\s+/g, '').startsWith('+')
      ? phone.replace(/\s+/g, '')
      : '+' + phone.replace(/\s+/g, '');

    const { data: account } = await supabase
      .from('player_accounts')
      .select('*')
      .eq('phone_number', normalizedPhone)
      .maybeSingle();

    if (account) {
      setFormData(prev => ({
        ...prev,
        player2Phone: normalizedPhone,
        player2Name: account.name || '',
        player2Email: account.email || '',
      }));
      setPartnerFound(true);
    } else {
      setFormData(prev => ({
        ...prev,
        player2Phone: normalizedPhone,
      }));
      setPartnerFound(false);
    }

    setPartnerLookupLoading(false);
  };

  const createOrGetPlayerAccount = async (name: string, email: string, phone: string) => {
    const normalizedPhone = phone.replace(/\s+/g, '');
    const tempPassword = `Player${normalizedPhone.slice(-4)}!`;
    const userEmail = email || `${normalizedPhone}@temp.player.com`;

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-player-auth`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          email: userEmail,
          password: tempPassword,
          phone_number: normalizedPhone,
          name,
        }),
      }
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to create player account');
    }

    return {
      account: data.account,
      isNew: data.isNew,
      password: data.isNew ? tempPassword : undefined,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const wasAuthenticated = (await supabase.auth.getSession()).data.session !== null;

    try {
      if (categories.length > 0 && !formData.categoryId) {
        setError('Por favor selecione uma categoria');
        setLoading(false);
        return;
      }

      if (isCategoryFull()) {
        const category = categories.find(c => c.id === formData.categoryId);
        setError(category ? `A categoria ${category.name} esta cheia` : t.registration.tournamentFull);
        setLoading(false);
        return;
      }

      const player1Result = await createOrGetPlayerAccount(
        formData.player1Name,
        formData.player1Email,
        formData.player1Phone
      );

      const credentials: {name: string, phone: string, password: string}[] = [];

      if (player1Result.isNew) {
        credentials.push({
          name: formData.player1Name,
          phone: formData.player1Phone.replace(/\s+/g, ''),
          password: player1Result.password || `Player${formData.player1Phone.replace(/\s+/g, '').slice(-4)}!`
        });
      }

      let player2Account = null;
      if (!isIndividualFormat()) {
        const player2Result = await createOrGetPlayerAccount(
          formData.player2Name,
          formData.player2Email,
          formData.player2Phone
        );
        player2Account = player2Result.account;

        if (player2Result.isNew) {
          credentials.push({
            name: formData.player2Name,
            phone: formData.player2Phone.replace(/\s+/g, ''),
            password: player2Result.password || `Player${formData.player2Phone.replace(/\s+/g, '').slice(-4)}!`
          });
        }
      }

      if (credentials.length > 0) {
        setNewAccountCredentials(credentials);
      }

      const registrationFee = getRegistrationFee();
      const isIndividual = isIndividualFormat();
      const canPayAtClub = tournament.allow_club_payment === true;

      if (registrationFee && registrationFee > 0 && !(canPayAtClub && payAtClubSelected)) {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              tournamentId: tournament.id,
              categoryId: formData.categoryId || null,
              isIndividual,
              teamName: isIndividual ? undefined : formData.teamName,
              player1: {
                name: formData.player1Name,
                email: formData.player1Email,
                phone: formData.player1Phone,
              },
              player2: isIndividual ? undefined : {
                name: formData.player2Name,
                email: formData.player2Email,
                phone: formData.player2Phone,
              },
              organizerUserId: tournament.user_id,
            }),
          }
        );

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to create checkout session');
        }

        if (data.url) {
          window.location.href = data.url;
        } else {
          throw new Error('Payment is required for this tournament');
        }
        return;
      }

      const selectedCategory = categories.find(c => c.id === formData.categoryId);

      if (isIndividual) {
        const { error: playerError } = await supabase
          .from('players')
          .insert([
            {
              tournament_id: tournament.id,
              category_id: formData.categoryId || null,
              name: formData.player1Name,
              email: formData.player1Email,
              phone_number: formData.player1Phone,
              user_id: null,
            },
          ]);

        if (playerError) throw playerError;

        if (formData.player1Email) {
          await sendWelcomeEmail(
            formData.player1Email,
            formData.player1Name,
            formData.player1Phone,
            tournament.name,
            selectedCategory?.name
          );
        }

        await notifyOrganizer(
          tournament.id,
          formData.player1Name,
          undefined,
          selectedCategory?.name,
          false
        );
      } else {
        const { data: players, error: playersError } = await supabase
          .from('players')
          .insert([
            {
              tournament_id: tournament.id,
              name: formData.player1Name,
              email: formData.player1Email,
              phone_number: formData.player1Phone,
              user_id: null,
            },
            {
              tournament_id: tournament.id,
              name: formData.player2Name,
              email: formData.player2Email,
              phone_number: formData.player2Phone,
              user_id: null,
            },
          ])
          .select();

        if (playersError) throw playersError;
        if (!players || players.length !== 2) throw new Error('Failed to create players');

        const { error: teamError } = await supabase
          .from('teams')
          .insert([
            {
              tournament_id: tournament.id,
              name: formData.teamName,
              seed: registeredTeamsCount + 1,
              player1_id: players[0].id,
              player2_id: players[1].id,
              category_id: formData.categoryId || null,
              payment_status: 'exempt',
            },
          ]);

        if (teamError) throw teamError;

        if (formData.player1Email) {
          await sendWelcomeEmail(
            formData.player1Email,
            formData.player1Name,
            formData.player1Phone,
            tournament.name,
            selectedCategory?.name
          );
        }

        if (formData.player2Email) {
          await sendWelcomeEmail(
            formData.player2Email,
            formData.player2Name,
            formData.player2Phone,
            tournament.name,
            selectedCategory?.name
          );
        }

        await notifyOrganizer(
          tournament.id,
          formData.player1Name,
          formData.player2Name,
          selectedCategory?.name,
          true
        );
      }

      setSuccess(true);
      fetchTeamsCount();

      if (!wasAuthenticated) {
        setPendingSignOut(true);
      }
    } catch (err: any) {
      setError(err.message || t.registration.error);
    } finally {
      setLoading(false);
    }
  };

  const spotsRemaining = getCategorySpotsRemaining();
  const isFull = isCategoryFull();

  if (success) {
    const handleClose = async () => {
      if (pendingSignOut) {
        await supabase.auth.signOut();
      }
      const redirectUrl = (tournament as any).registration_redirect_url;
      if (redirectUrl) {
        window.location.href = redirectUrl;
      } else {
        onClose();
      }
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          {logoUrl && (
            <div className="mb-6">
              <img
                src={logoUrl}
                alt="Tournament Logo"
                className="h-20 mx-auto object-contain"
              />
            </div>
          )}
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-12 h-12 text-green-600" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-4">{t.registration.success}</h2>
          <p className="text-gray-600 mb-2">
            {isIndividualFormat() ? (
              <>Inscricao confirmada no torneio</>
            ) : (
              <>A equipa <span className="font-semibold">{formData.teamName}</span> foi inscrita no torneio</>
            )}
          </p>
          <p className="text-xl font-semibold text-blue-600 mb-6">{tournament.name}</p>

          {newAccountCredentials.length > 0 && (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6 text-left">
              <h3 className="font-bold text-blue-900 mb-2 text-center">
                {newAccountCredentials.length === 1 ? 'Conta de Jogador Criada!' : 'Contas de Jogadores Criadas!'}
              </h3>
              <p className="text-sm text-blue-800 mb-3">
                {newAccountCredentials.length === 1
                  ? 'Foi criada uma conta para aceder aos torneios e jogos.'
                  : 'Foram criadas contas para cada jogador aceder aos torneios e jogos.'}
              </p>
              <div className="space-y-3">
                {newAccountCredentials.map((cred, index) => (
                  <div key={index} className="bg-white rounded p-3 space-y-2">
                    <div className="font-semibold text-blue-900 border-b border-blue-100 pb-1">
                      {cred.name}
                    </div>
                    <div>
                      <span className="font-semibold text-blue-900">Telefone:</span>
                      <span className="ml-2 text-gray-900">{cred.phone}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-blue-900">Password:</span>
                      <span className="ml-2 text-gray-900 font-mono">{cred.password}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-blue-700 mt-3">
                Use estes dados para fazer login como "Jogador" e ver os jogos e estatisticas!
              </p>
            </div>
          )}

          {newAccountCredentials.length === 0 && loggedInPlayer && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 text-left">
              <p className="text-sm text-green-800">
                Inscricao associada a sua conta. Aceda ao seu painel de jogador para ver os seus jogos.
              </p>
            </div>
          )}

          <button
            onClick={handleClose}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            {t.button.back}
          </button>
        </div>
      </div>
    );
  }

  const renderTournamentInfo = () => (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">{t.tournament.viewDetails}</h2>

      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Calendar className="w-5 h-5 text-blue-600 mt-1 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-500">{t.tournament.startDate}</p>
            <p className="text-gray-900">
              {(() => {
                const d = new Date(tournament.start_date);
                return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
              })()}{' '}
              -{' '}
              {(() => {
                const d = new Date(tournament.end_date);
                return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
              })()}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Clock className="w-5 h-5 text-blue-600 mt-1 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-500">{t.tournament.startTime}</p>
            <p className="text-gray-900">
              {tournament.start_time} - {tournament.end_time}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Trophy className="w-5 h-5 text-blue-600 mt-1 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-500">{t.tournament.format}</p>
            <p className="text-gray-900">
              {t.format[tournament.format as keyof typeof t.format]}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Users className="w-5 h-5 text-blue-600 mt-1 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-500">
              {formData.categoryId ? 'Inscritos na categoria' : t.tournament.status}
            </p>
            <p className="text-gray-900">
              {formData.categoryId ? categoryPlayersCount : registeredTeamsCount} / {getCategoryMaxSlots()} {isIndividualFormat() ? 'jogadores' : t.nav.teams.toLowerCase()}
            </p>
            {!isFull && spotsRemaining > 0 && (
              <p className="text-sm text-green-600 font-medium mt-1">
                {spotsRemaining} {spotsRemaining === 1 ? 'vaga' : 'vagas'} disponivel
              </p>
            )}
            {isFull && <p className="text-sm text-red-600 font-medium mt-1">{t.registration.tournamentFull}</p>}
            <button
              onClick={() => {
                if (!showRegisteredList && allRegistered.length === 0) {
                  fetchAllRegistered();
                }
                setShowRegisteredList(!showRegisteredList);
              }}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium mt-2 flex items-center gap-1"
            >
              {showRegisteredList ? 'Esconder lista' : 'Ver inscritos'}
              <ChevronDown className={`w-4 h-4 transition-transform ${showRegisteredList ? 'rotate-180' : ''}`} />
            </button>
            {showRegisteredList && (
              <div className="mt-3 bg-gray-50 rounded-lg p-3 max-h-80 overflow-y-auto">
                {allRegistered.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-2">Nenhum inscrito ainda</p>
                ) : (
                  <div className="space-y-4">
                    {categories.length > 1
                      ? (() => {
                          const byCategory = categories.map((cat) => ({
                            cat,
                            items: allRegistered.filter((i) => i.category_id === cat.id),
                          }));
                          const uncategorized = allRegistered.filter((i) => !categories.some((c) => c.id === i.category_id));
                          return (
                            <>
                              {byCategory.map(({ cat, items }) =>
                                items.length > 0 ? (
                                  <div key={cat.id}>
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{cat.name}</p>
                                    <ul className="space-y-1">
                                      {items.map((item, idx) => (
                                        <li key={item.id} className="text-sm">
                                          <span className="font-medium text-gray-700">{idx + 1}.</span>{' '}
                                          {item.player1_name ? (
                                            <span className="text-gray-900">{item.player1_name} / {item.player2_name}</span>
                                          ) : (
                                            <span className="text-gray-900">{item.name}</span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null
                              )}
                              {uncategorized.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Outros</p>
                                  <ul className="space-y-1">
                                    {uncategorized.map((item, idx) => (
                                      <li key={item.id} className="text-sm">
                                        <span className="font-medium text-gray-700">{idx + 1}.</span>{' '}
                                        {item.player1_name ? (
                                          <span className="text-gray-900">{item.player1_name} / {item.player2_name}</span>
                                        ) : (
                                          <span className="text-gray-900">{item.name}</span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          );
                        })()
                      : (
                        <ul className="space-y-2">
                          {allRegistered.map((item, index) => (
                            <li key={item.id} className="text-sm">
                              <span className="font-medium text-gray-700">{index + 1}.</span>{' '}
                              {item.player1_name ? (
                                <span className="text-gray-900">{item.player1_name} / {item.player2_name}</span>
                              ) : (
                                <span className="text-gray-900">{item.name}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3">
          <MapPin className="w-5 h-5 text-blue-600 mt-1 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-500">{t.tournament.courts}</p>
            <p className="text-gray-900">{tournament.number_of_courts}</p>
          </div>
        </div>
      </div>

      {tournament.image_url && (
        <div className="mt-6 w-full rounded-xl overflow-hidden shadow-lg" style={{ aspectRatio: '3/4' }}>
          <img
            src={tournament.image_url}
            alt={tournament.name}
            className="w-full h-full object-cover"
          />
        </div>
      )}
    </div>
  );

  const renderCheckAccountStep = () => (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <User className="w-8 h-8 text-blue-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{t.registration.title}</h2>
        <p className="text-gray-600">{t.registration.enterPhoneToStart}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <Phone className="w-4 h-4 inline mr-2" />
            {t.registration.phoneNumber}
          </label>
          <input
            type="tel"
            value={checkPhone}
            onChange={(e) => setCheckPhone(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleCheckPhone()}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
            placeholder="+351 912 345 678"
            autoFocus
          />
          <p className="text-xs text-gray-500 mt-2">
            {t.registration.phoneHint}
          </p>
        </div>

        <button
          onClick={handleCheckPhone}
          disabled={loading || !checkPhone}
          className="w-full px-6 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            t.registration.checking
          ) : (
            <>
              {t.registration.continue}
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white text-gray-500">{t.registration.or}</span>
          </div>
        </div>

        <button
          onClick={() => {
            setIsNewPlayer(true);
            setStep('register');
          }}
          className="w-full px-6 py-3 border-2 border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
        >
          {t.registration.newPlayerCreateAccount}
        </button>
      </div>

      <div className="mt-6 text-center">
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 transition-colors text-sm"
        >
          {t.registration.back}
        </button>
      </div>
    </div>
  );

  const renderLoginStep = () => (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <LogIn className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{t.registration.accountFound}</h2>
        <p className="text-gray-600">
          {t.registration.welcomeBack} <span className="font-semibold">{existingAccount?.name}</span>! {t.registration.loginToContinue}
        </p>
      </div>

      {loginError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {loginError}
        </div>
      )}

      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <User className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">{existingAccount?.name}</p>
            <p className="text-sm text-gray-500">{existingAccount?.phone_number}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Password
          </label>
          <input
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Introduza a sua password"
            autoFocus
          />
          <p className="text-xs text-gray-500 mt-2">
            Password padrao: Player + ultimos 4 digitos do telefone + !
          </p>
        </div>

        <button
          onClick={handleLogin}
          disabled={loginLoading || !loginPassword}
          className="w-full px-6 py-4 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loginLoading ? 'A entrar...' : 'Entrar e Inscrever'}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white text-gray-500">{t.registration.or}</span>
          </div>
        </div>

        <button
          onClick={handleSkipLogin}
          className="w-full px-6 py-3 border-2 border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
        >
          {t.registration.continueWithoutLogin}
        </button>

        <button
          onClick={() => {
            setStep('check_account');
            setExistingAccount(null);
            setLoginPassword('');
            setLoginError('');
          }}
          className="w-full text-gray-500 hover:text-gray-700 transition-colors text-sm"
        >
          {t.registration.useAnotherPhone}
        </button>
      </div>
    </div>
  );

  const renderRegistrationForm = () => (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        {loggedInPlayer ? 'Confirmar Inscricao' : t.registration.title}
      </h2>

      {loggedInPlayer && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <div>
              <p className="font-medium text-green-900">Sessao iniciada como {loggedInPlayer.name}</p>
              <p className="text-sm text-green-700">Os seus dados serao associados a esta inscricao</p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {isFull ? (
        <div className="text-center py-8">
          <p className="text-lg text-gray-600 mb-4">
            {t.registration.tournamentFull}
          </p>
          <button
            onClick={onClose}
            className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            {t.button.back}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {!isIndividualFormat() && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.registration.teamName} *
              </label>
              <input
                type="text"
                required
                value={formData.teamName}
                onChange={(e) => setFormData({ ...formData, teamName: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Thunder Strikers"
              />
            </div>
          )}

          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Categoria *
              </label>
              <select
                value={formData.categoryId}
                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Selecione uma categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.max_teams && ` (max ${category.max_teams})`}
                    {category.registration_fee && category.registration_fee > 0 && ` - ${category.registration_fee}EUR`}
                  </option>
                ))}
              </select>

              {formData.categoryId && categoryTeams.length > 0 && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-xs font-medium text-gray-700 mb-2">
                    {categoryTeams.length} {isIndividualFormat()
                      ? (categoryTeams.length === 1 ? 'jogador inscrito' : 'jogadores inscritos')
                      : (categoryTeams.length === 1 ? 'equipa inscrita' : 'equipas inscritas')
                    } nesta categoria:
                  </p>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {categoryTeams.map((team) => (
                      <div key={team.id} className="text-xs text-gray-600 bg-white p-2 rounded border border-gray-100">
                        <p className="font-semibold text-gray-900">{team.name}</p>
                        {!team.isPlayer && (
                          <p className="text-gray-500">
                            {team.player1?.name || 'Player 1'} & {team.player2?.name || 'Player 2'}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {getRegistrationFee() > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CreditCard className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-blue-900">Taxa de Inscricao</p>
                  {tournament.member_price || tournament.non_member_price ? (
                    <div className="mt-1 space-y-1">
                      {tournament.member_price !== undefined && tournament.member_price !== null && (
                        <p className="text-sm text-blue-800">Membros: <span className="font-bold">{tournament.member_price}€</span></p>
                      )}
                      {tournament.non_member_price !== undefined && tournament.non_member_price !== null && (
                        <p className="text-sm text-blue-800">Não-Membros: <span className="font-bold">{tournament.non_member_price}€</span></p>
                      )}
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-blue-600">{getRegistrationFee()}€</p>
                  )}
                </div>
              </div>

              {tournament.allow_club_payment && (
                <div className="mt-4 border-t border-blue-200 pt-4">
                  <p className="text-sm font-medium text-blue-900 mb-3">Como pretende pagar?</p>
                  <div className="space-y-2">
                    <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      !payAtClubSelected ? 'border-blue-400 bg-blue-100' : 'border-gray-200 bg-white hover:border-blue-300'
                    }`}>
                      <input
                        type="radio"
                        name="payment_method"
                        checked={!payAtClubSelected}
                        onChange={() => setPayAtClubSelected(false)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Pagar online agora</p>
                        <p className="text-xs text-gray-500">Pagamento seguro via Stripe</p>
                      </div>
                    </label>
                    <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      payAtClubSelected ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white hover:border-green-300'
                    }`}>
                      <input
                        type="radio"
                        name="payment_method"
                        checked={payAtClubSelected}
                        onChange={() => setPayAtClubSelected(true)}
                        className="w-4 h-4 text-green-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Pagar no clube</p>
                        <p className="text-xs text-gray-500">Pague diretamente no clube antes do torneio</p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {!tournament.allow_club_payment && (
                <p className="text-xs text-blue-700 mt-2">Sera redirecionado para pagamento seguro via Stripe</p>
              )}
            </div>
          )}

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {isIndividualFormat() ? 'Os Seus Dados' : t.registration.player1Name}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.registration.name} *</label>
                <input
                  type="text"
                  required
                  value={formData.player1Name}
                  onChange={(e) => setFormData({ ...formData, player1Name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={!!loggedInPlayer}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                <input
                  type="email"
                  required
                  value={formData.player1Email}
                  onChange={(e) => setFormData({ ...formData, player1Email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="email@exemplo.com"
                  disabled={!!loggedInPlayer}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.registration.phone} *</label>
                <input
                  type="tel"
                  required
                  value={formData.player1Phone}
                  onChange={(e) => setFormData({ ...formData, player1Phone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="+351 912 345 678"
                  disabled={!!loggedInPlayer || !!existingAccount}
                />
              </div>
            </div>
          </div>

          {!isIndividualFormat() && (
            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">{t.registration.player2Name}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.registration.phone} *</label>
                  <div className="relative">
                    <input
                      type="tel"
                      required
                      value={formData.player2Phone}
                      onChange={(e) => {
                        setFormData({ ...formData, player2Phone: e.target.value });
                        setPartnerFound(false);
                      }}
                      onBlur={(e) => lookupPartnerByPhone(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="+351 912 345 678"
                    />
                    {partnerLookupLoading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Introduza o telefone do parceiro para verificar se ja esta registado
                  </p>
                </div>

                {partnerFound && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <p className="text-sm text-green-800">
                      Jogador encontrado: <span className="font-semibold">{formData.player2Name}</span>
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.registration.name} *</label>
                  <input
                    type="text"
                    required
                    value={formData.player2Name}
                    onChange={(e) => setFormData({ ...formData, player2Name: e.target.value })}
                    className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${partnerFound ? 'bg-gray-50' : ''}`}
                    disabled={partnerFound}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email {!partnerFound && '*'}
                  </label>
                  <input
                    type="email"
                    required={!partnerFound}
                    value={formData.player2Email}
                    onChange={(e) => setFormData({ ...formData, player2Email: e.target.value })}
                    className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${partnerFound ? 'bg-gray-50' : ''}`}
                    placeholder="email@exemplo.com"
                    disabled={partnerFound}
                  />
                  {!partnerFound && (
                    <p className="text-xs text-gray-500 mt-1">
                      Obrigatorio para novos jogadores receberem as credenciais e instrucoes
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => {
                if (loggedInPlayer) {
                  onClose();
                } else {
                  setStep('check_account');
                  setExistingAccount(null);
                  setIsNewPlayer(false);
                }
              }}
              className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              {t.button.cancel}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? t.message.saving
                : getRegistrationFee() > 0
                  ? (payAtClubSelected ? 'Inscrever (Pagar no Clube)' : `Pagar ${getRegistrationFee()}€`)
                  : t.registration.submit
              }
            </button>
          </div>
        </form>
      )}
    </div>
  );

  // Mostrar página de torneio cancelado
  if (tournament.status === 'cancelled') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-red-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          {logoUrl && (
            <div className="mb-6">
              <img
                src={logoUrl}
                alt="Tournament Logo"
                className="h-20 mx-auto object-contain"
              />
            </div>
          )}
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{tournament.name}</h1>
          <div className="inline-flex items-center px-4 py-2 bg-red-100 text-red-800 rounded-full font-semibold mb-4">
            <span className="w-2 h-2 bg-red-500 rounded-full mr-2"></span>
            TORNEIO CANCELADO
          </div>
          <p className="text-gray-600 mb-6">
            Este torneio foi cancelado e as inscrições estão encerradas.
          </p>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
          >
            {t.button.back}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          {logoUrl && (
            <div className="mb-6">
              <img
                src={logoUrl}
                alt="Tournament Logo"
                className="h-24 mx-auto object-contain"
              />
            </div>
          )}
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">{tournament.name}</h1>
          {tournament.description && (
            <div
              className="text-xl text-gray-600 max-w-2xl mx-auto"
              dangerouslySetInnerHTML={{ __html: tournament.description }}
            />
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          {renderTournamentInfo()}

          {step === 'check_account' && renderCheckAccountStep()}
          {step === 'login' && renderLoginStep()}
          {step === 'register' && renderRegistrationForm()}
        </div>

        <div className="text-center">
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            {t.button.back}
          </button>
        </div>
      </div>
    </div>
  );
}
