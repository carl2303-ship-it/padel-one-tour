import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useCustomLogo } from '../lib/useCustomLogo';
import {
  Users,
  Phone,
  Mail,
  User,
  Crown,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  Loader2,
} from 'lucide-react';

interface Tournament {
  id: string;
  name: string;
  user_id: string;
  format: string;
  status: string;
  registration_fee?: number;
}

interface SuperTeamRegistrationProps {
  tournament: Tournament;
  onClose: () => void;
}

interface PlayerData {
  name: string;
  email: string;
  phone: string;
  isCaptain: boolean;
  found: boolean;
  loading: boolean;
}

export default function SuperTeamRegistration({ tournament, onClose }: SuperTeamRegistrationProps) {
  const { t } = useI18n();
  const { logoUrl } = useCustomLogo(tournament.user_id);
  
  const [teamName, setTeamName] = useState('');
  const [players, setPlayers] = useState<PlayerData[]>([
    { name: '', email: '', phone: '', isCaptain: true, found: false, loading: false },
    { name: '', email: '', phone: '', isCaptain: false, found: false, loading: false },
    { name: '', email: '', phone: '', isCaptain: false, found: false, loading: false },
    { name: '', email: '', phone: '', isCaptain: false, found: false, loading: false },
  ]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const normalizePhone = (phone: string): string => {
    let normalized = phone.replace(/[\s\-\(\)\.]/g, '');
    if (!normalized.startsWith('+')) {
      if (normalized.startsWith('00')) {
        normalized = '+' + normalized.substring(2);
      } else if (normalized.startsWith('9') && normalized.length === 9) {
        normalized = '+351' + normalized;
      } else if (normalized.startsWith('351')) {
        normalized = '+' + normalized;
      }
    }
    return normalized;
  };

  const lookupPlayerByPhone = async (index: number, phone: string) => {
    if (!phone || phone.length < 9) return;

    const normalizedPhone = normalizePhone(phone);
    
    setPlayers(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], loading: true };
      return updated;
    });

    try {
      const { data: account } = await supabase
        .from('player_accounts')
        .select('name, email, phone_number')
        .eq('phone_number', normalizedPhone)
        .maybeSingle();

      if (account) {
        setPlayers(prev => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            name: account.name || '',
            email: account.email || '',
            phone: normalizedPhone,
            found: true,
            loading: false,
          };
          return updated;
        });
      } else {
        setPlayers(prev => {
          const updated = [...prev];
          updated[index] = { ...updated[index], phone: normalizedPhone, found: false, loading: false };
          return updated;
        });
      }
    } catch (err) {
      setPlayers(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], loading: false };
        return updated;
      });
    }
  };

  const updatePlayer = (index: number, field: keyof PlayerData, value: string | boolean) => {
    setPlayers(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      
      // Se mudar o capitão, remover de outros
      if (field === 'isCaptain' && value === true) {
        updated.forEach((p, i) => {
          if (i !== index) p.isCaptain = false;
        });
      }
      
      // Se mudar o telefone, resetar found
      if (field === 'phone') {
        updated[index].found = false;
      }
      
      return updated;
    });
  };

  const validateForm = (): boolean => {
    if (!teamName.trim()) {
      setError('Por favor introduza o nome da equipa');
      return false;
    }

    for (let i = 0; i < 4; i++) {
      const player = players[i];
      if (!player.name.trim()) {
        setError(`Por favor introduza o nome do Jogador ${i + 1}`);
        return false;
      }
      if (!player.phone.trim()) {
        setError(`Por favor introduza o telefone do Jogador ${i + 1}`);
        return false;
      }
      if (!player.email.trim() && !player.found) {
        setError(`Por favor introduza o email do Jogador ${i + 1} (obrigatório para novos jogadores)`);
        return false;
      }
    }

    // Verificar se há capitão selecionado
    if (!players.some(p => p.isCaptain)) {
      setError('Por favor selecione um capitão para a equipa');
      return false;
    }

    // Verificar telefones duplicados
    const phones = players.map(p => normalizePhone(p.phone));
    const uniquePhones = new Set(phones);
    if (uniquePhones.size !== 4) {
      setError('Cada jogador deve ter um número de telefone único');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) return;

    setLoading(true);

    try {
      // Obter a ordem de inscrição
      const { count } = await supabase
        .from('super_teams')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournament.id);

      const registrationOrder = (count || 0) + 1;

      // Criar a Super Equipa
      const { data: superTeam, error: teamError } = await supabase
        .from('super_teams')
        .insert({
          tournament_id: tournament.id,
          name: teamName.trim(),
          registration_order: registrationOrder,
        })
        .select()
        .single();

      if (teamError) throw teamError;

      // Criar ou obter player_accounts e inserir jogadores
      const playerInserts = [];
      
      for (let i = 0; i < 4; i++) {
        const player = players[i];
        const normalizedPhone = normalizePhone(player.phone);

        // Verificar se já existe player_account
        let playerAccountId = null;
        const { data: existingAccount } = await supabase
          .from('player_accounts')
          .select('id')
          .eq('phone_number', normalizedPhone)
          .maybeSingle();

        if (existingAccount) {
          playerAccountId = existingAccount.id;
        } else {
          // Criar novo player_account via Edge Function
          const password = `Player${normalizedPhone.slice(-4)}!`;
          
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-player-account`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              },
              body: JSON.stringify({
                name: player.name,
                email: player.email,
                phoneNumber: normalizedPhone,
                password,
                tournamentName: tournament.name,
              }),
            }
          );

          const result = await response.json();
          if (result.success && result.accountId) {
            playerAccountId = result.accountId;
          }
        }

        playerInserts.push({
          super_team_id: superTeam.id,
          player_account_id: playerAccountId,
          name: player.name.trim(),
          email: player.email.trim(),
          phone_number: normalizedPhone,
          is_captain: player.isCaptain,
          player_order: i + 1,
        });
      }

      const { error: playersError } = await supabase
        .from('super_team_players')
        .insert(playerInserts);

      if (playersError) throw playersError;

      // Atualizar captain_player_id na super_team
      const captainPlayer = playerInserts.find(p => p.is_captain);
      if (captainPlayer) {
        const { data: captainData } = await supabase
          .from('super_team_players')
          .select('id')
          .eq('super_team_id', superTeam.id)
          .eq('is_captain', true)
          .maybeSingle();

        if (captainData) {
          await supabase
            .from('super_teams')
            .update({ captain_player_id: captainData.id })
            .eq('id', superTeam.id);
        }
      }

      setSuccess(true);
    } catch (err: any) {
      console.error('Erro ao registar super equipa:', err);
      setError(err.message || 'Erro ao registar equipa');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Inscrição Confirmada!</h2>
          <p className="text-gray-600 mb-6">
            A equipa <strong>{teamName}</strong> foi inscrita com sucesso no torneio{' '}
            <strong>{tournament.name}</strong>.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            O capitão receberá instruções por email para definir as duplas antes de cada confronto.
          </p>
          <button
            onClick={onClose}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-green-600 to-green-700 p-6 text-white">
            <div className="flex items-center gap-4">
              {logoUrl && (
                <img src={logoUrl} alt="Logo" className="w-16 h-16 rounded-lg bg-white p-1" />
              )}
              <div>
                <h1 className="text-2xl font-bold">{tournament.name}</h1>
                <p className="text-green-100">Inscrição Super Equipas (4 Jogadores)</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                <p className="text-red-800 text-sm">{error}</p>
              </div>
            )}

            {/* Nome da Equipa */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Users className="w-4 h-4 inline mr-2" />
                Nome da Equipa *
              </label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-lg"
                placeholder="Ex: Os Invencíveis"
                required
              />
            </div>

            {/* 4 Jogadores */}
            <div className="space-y-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <User className="w-5 h-5" />
                Jogadores (4 obrigatórios)
              </h3>

              {players.map((player, index) => (
                <div
                  key={index}
                  className={`border rounded-lg p-4 ${
                    player.isCaptain ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-gray-900">
                      Jogador {index + 1}
                      {player.isCaptain && (
                        <span className="ml-2 text-yellow-600 text-sm">
                          <Crown className="w-4 h-4 inline" /> Capitão
                        </span>
                      )}
                    </h4>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="captain"
                        checked={player.isCaptain}
                        onChange={() => updatePlayer(index, 'isCaptain', true)}
                        className="text-yellow-500 focus:ring-yellow-500"
                      />
                      <span className="text-sm text-gray-600">Capitão</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Telefone */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        <Phone className="w-3 h-3 inline mr-1" />
                        Telefone *
                      </label>
                      <div className="relative">
                        <input
                          type="tel"
                          value={player.phone}
                          onChange={(e) => updatePlayer(index, 'phone', e.target.value)}
                          onBlur={(e) => lookupPlayerByPhone(index, e.target.value)}
                          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent ${
                            player.found ? 'bg-green-50 border-green-300' : 'border-gray-300'
                          }`}
                          placeholder="+351 912 345 678"
                          required
                        />
                        {player.loading && (
                          <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-gray-400" />
                        )}
                        {player.found && (
                          <CheckCircle className="absolute right-3 top-2.5 w-4 h-4 text-green-600" />
                        )}
                      </div>
                    </div>

                    {/* Nome */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        <User className="w-3 h-3 inline mr-1" />
                        Nome *
                      </label>
                      <input
                        type="text"
                        value={player.name}
                        onChange={(e) => updatePlayer(index, 'name', e.target.value)}
                        disabled={player.found}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent ${
                          player.found ? 'bg-gray-50 border-gray-200' : 'border-gray-300'
                        }`}
                        placeholder="Nome completo"
                        required
                      />
                    </div>

                    {/* Email */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        <Mail className="w-3 h-3 inline mr-1" />
                        Email {!player.found && '*'}
                      </label>
                      <input
                        type="email"
                        value={player.email}
                        onChange={(e) => updatePlayer(index, 'email', e.target.value)}
                        disabled={player.found}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent ${
                          player.found ? 'bg-gray-50 border-gray-200' : 'border-gray-300'
                        }`}
                        placeholder="email@exemplo.com"
                        required={!player.found}
                      />
                    </div>
                  </div>

                  {player.found && (
                    <p className="text-xs text-green-600 mt-2">
                      ✓ Jogador encontrado no sistema
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-blue-900 mb-2">Informação Importante</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• O <strong>capitão</strong> define as duplas antes de cada confronto</li>
                <li>• Cada confronto tem 2 jogos + Super Tie-Break (se empate)</li>
                <li>• O capitão escolhe os jogadores para o Super Tie-Break</li>
                <li>• Todos os jogadores receberão instruções por email</li>
              </ul>
            </div>

            {/* Botões */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    A registar...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Confirmar Inscrição
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
