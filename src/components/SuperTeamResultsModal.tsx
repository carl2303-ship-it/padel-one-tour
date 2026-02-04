import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Save, Trophy } from 'lucide-react';

type SuperTeamPlayer = {
  id: string;
  name: string;
  email: string;
  phone_number: string;
  is_captain: boolean;
  player_order: number;
};

type SuperTeam = {
  id: string;
  name: string;
  category_id: string | null;
  super_team_players: SuperTeamPlayer[];
};

type Confrontation = {
  id: string;
  super_team_1_id: string | null;
  super_team_2_id: string | null;
  status: string;
  team1_matches_won: number;
  team2_matches_won: number;
  has_super_tiebreak: boolean;
  winner_super_team_id: string | null;
  next_confrontation_id?: string | null;
  next_team_slot?: number | null;
};

type Game = {
  id: string;
  confrontation_id: string;
  game_type: 'duo1' | 'duo2' | 'super_tiebreak';
  game_order: number;
  team1_score: number | null;
  team2_score: number | null;
  set_scores: string | null; // JSON com os scores de cada set
  status: string;
};

type Props = {
  confrontation: Confrontation;
  team1: SuperTeam | null | undefined;
  team2: SuperTeam | null | undefined;
  gameFormat?: '1set' | '3sets'; // Formato definido na categoria
  onClose: () => void;
  onSuccess: () => void;
};

export default function SuperTeamResultsModal({ confrontation, team1, team2, gameFormat = '1set', onClose, onSuccess }: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // O formato vem da categoria
  const format = gameFormat;

  // Scores para cada jogo - cada jogo pode ter até 3 sets
  // Jogo 1 (Dupla 1)
  const [duo1Set1Team1, setDuo1Set1Team1] = useState<number | ''>('');
  const [duo1Set1Team2, setDuo1Set1Team2] = useState<number | ''>('');
  const [duo1Set2Team1, setDuo1Set2Team1] = useState<number | ''>('');
  const [duo1Set2Team2, setDuo1Set2Team2] = useState<number | ''>('');
  const [duo1Set3Team1, setDuo1Set3Team1] = useState<number | ''>('');
  const [duo1Set3Team2, setDuo1Set3Team2] = useState<number | ''>('');
  
  // Jogo 2 (Dupla 2)
  const [duo2Set1Team1, setDuo2Set1Team1] = useState<number | ''>('');
  const [duo2Set1Team2, setDuo2Set1Team2] = useState<number | ''>('');
  const [duo2Set2Team1, setDuo2Set2Team1] = useState<number | ''>('');
  const [duo2Set2Team2, setDuo2Set2Team2] = useState<number | ''>('');
  const [duo2Set3Team1, setDuo2Set3Team1] = useState<number | ''>('');
  const [duo2Set3Team2, setDuo2Set3Team2] = useState<number | ''>('');
  
  // Super Tie-Break do confronto (se empate 1-1 nos jogos)
  const [tiebreakTeam1Score, setTiebreakTeam1Score] = useState<number | ''>('');
  const [tiebreakTeam2Score, setTiebreakTeam2Score] = useState<number | ''>('');

  useEffect(() => {
    fetchGames();
  }, [confrontation.id]);

  const ensureGames = async () => {
    const { data: existing } = await supabase
      .from('super_team_games')
      .select('id')
      .eq('confrontation_id', confrontation.id);
    if (existing && existing.length > 0) return;
    await supabase.from('super_team_games').insert([
      { confrontation_id: confrontation.id, game_type: 'duo1', game_order: 1 },
      { confrontation_id: confrontation.id, game_type: 'duo2', game_order: 2 },
      { confrontation_id: confrontation.id, game_type: 'super_tiebreak', game_order: 3 },
    ]);
  };

  const fetchGames = async () => {
    setLoading(true);
    try {
      await ensureGames();
      const { data, error } = await supabase
        .from('super_team_games')
        .select('*')
        .eq('confrontation_id', confrontation.id)
        .order('game_order');

      if (error) throw error;

      if (data) {
        setGames(data);
        // Preencher scores existentes - os sets são armazenados como JSON em set_scores
        data.forEach(game => {
          const setScores = game.set_scores ? JSON.parse(game.set_scores) : null;
          if (game.game_type === 'duo1') {
            // Detectar formato: se tem set2 preenchido, é 3sets
            if (setScores) {
              setDuo1Set1Team1(setScores.set1?.team1 ?? '');
              setDuo1Set1Team2(setScores.set1?.team2 ?? '');
              setDuo1Set2Team1(setScores.set2?.team1 ?? '');
              setDuo1Set2Team2(setScores.set2?.team2 ?? '');
              setDuo1Set3Team1(setScores.set3?.team1 ?? '');
              setDuo1Set3Team2(setScores.set3?.team2 ?? '');
              // O formato vem da categoria, não dos dados guardados
            }
          } else if (game.game_type === 'duo2') {
            if (setScores) {
              setDuo2Set1Team1(setScores.set1?.team1 ?? '');
              setDuo2Set1Team2(setScores.set1?.team2 ?? '');
              setDuo2Set2Team1(setScores.set2?.team1 ?? '');
              setDuo2Set2Team2(setScores.set2?.team2 ?? '');
              setDuo2Set3Team1(setScores.set3?.team1 ?? '');
              setDuo2Set3Team2(setScores.set3?.team2 ?? '');
              // O formato vem da categoria, não dos dados guardados
            }
          } else if (game.game_type === 'super_tiebreak') {
            setTiebreakTeam1Score(game.team1_score ?? '');
            setTiebreakTeam2Score(game.team2_score ?? '');
          }
        });
      }
    } catch (err) {
      console.error('Error fetching games:', err);
      setError('Erro ao carregar jogos');
    } finally {
      setLoading(false);
    }
  };

  // Calcular vencedor de um jogo baseado no formato (1 set ou melhor de 3)
  const calculateGameWinner = (
    format: '1set' | '3sets',
    set1t1: number | '', set1t2: number | '',
    set2t1: number | '', set2t2: number | '',
    set3t1: number | '', set3t2: number | ''
  ): { team1Sets: number; team2Sets: number; winner: 'team1' | 'team2' | null; needsSet3: boolean } => {
    // Se é só 1 set, basta comparar o set 1
    if (format === '1set') {
      if (set1t1 !== '' && set1t2 !== '') {
        if (Number(set1t1) > Number(set1t2)) return { team1Sets: 1, team2Sets: 0, winner: 'team1', needsSet3: false };
        if (Number(set1t2) > Number(set1t1)) return { team1Sets: 0, team2Sets: 1, winner: 'team2', needsSet3: false };
      }
      return { team1Sets: 0, team2Sets: 0, winner: null, needsSet3: false };
    }
    
    // Melhor de 3 sets
    let team1Sets = 0;
    let team2Sets = 0;
    
    // Set 1
    if (set1t1 !== '' && set1t2 !== '') {
      if (Number(set1t1) > Number(set1t2)) team1Sets++;
      else if (Number(set1t2) > Number(set1t1)) team2Sets++;
    }
    
    // Set 2
    if (set2t1 !== '' && set2t2 !== '') {
      if (Number(set2t1) > Number(set2t2)) team1Sets++;
      else if (Number(set2t2) > Number(set2t1)) team2Sets++;
    }
    
    // Precisa de set 3?
    const needsSet3 = team1Sets === 1 && team2Sets === 1;
    
    // Set 3 (super tie-break)
    if (needsSet3 && set3t1 !== '' && set3t2 !== '') {
      if (Number(set3t1) > Number(set3t2)) team1Sets++;
      else if (Number(set3t2) > Number(set3t1)) team2Sets++;
    }
    
    const winner = team1Sets >= 2 ? 'team1' : team2Sets >= 2 ? 'team2' : null;
    return { team1Sets, team2Sets, winner, needsSet3 };
  };

  const calculateResults = () => {
    let team1Wins = 0;
    let team2Wins = 0;
    let needsTiebreak = false;

    // Jogo 1 (Dupla 1)
    const duo1Result = calculateGameWinner(
      format,
      duo1Set1Team1, duo1Set1Team2,
      duo1Set2Team1, duo1Set2Team2,
      duo1Set3Team1, duo1Set3Team2
    );
    if (duo1Result.winner === 'team1') team1Wins++;
    else if (duo1Result.winner === 'team2') team2Wins++;

    // Jogo 2 (Dupla 2)
    const duo2Result = calculateGameWinner(
      format,
      duo2Set1Team1, duo2Set1Team2,
      duo2Set2Team1, duo2Set2Team2,
      duo2Set3Team1, duo2Set3Team2
    );
    if (duo2Result.winner === 'team1') team1Wins++;
    else if (duo2Result.winner === 'team2') team2Wins++;

    // Verificar se precisa de Super Tie-Break do confronto (1-1 nos jogos)
    needsTiebreak = team1Wins === 1 && team2Wins === 1;

    // Super Tie-Break do confronto
    if (needsTiebreak && tiebreakTeam1Score !== '' && tiebreakTeam2Score !== '') {
      if (Number(tiebreakTeam1Score) > Number(tiebreakTeam2Score)) team1Wins++;
      else if (Number(tiebreakTeam2Score) > Number(tiebreakTeam1Score)) team2Wins++;
    }

    return { team1Wins, team2Wins, needsTiebreak, duo1Result, duo2Result };
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {
      const { team1Wins, team2Wins, needsTiebreak, duo1Result, duo2Result } = calculateResults();

      // Atualizar jogos
      const duo1Game = games.find(g => g.game_type === 'duo1');
      const duo2Game = games.find(g => g.game_type === 'duo2');
      const tiebreakGame = games.find(g => g.game_type === 'super_tiebreak');

      // Jogo 1 (Dupla 1)
      if (duo1Game && (duo1Set1Team1 !== '' || duo1Set1Team2 !== '')) {
        const setScores = JSON.stringify({
          format: format,
          set1: { team1: duo1Set1Team1, team2: duo1Set1Team2 },
          set2: format === '3sets' ? { team1: duo1Set2Team1, team2: duo1Set2Team2 } : null,
          set3: format === '3sets' ? { team1: duo1Set3Team1, team2: duo1Set3Team2 } : null
        });
        const winnerId = duo1Result.winner === 'team1' ? (team1?.id || null)
          : duo1Result.winner === 'team2' ? (team2?.id || null)
          : null;
        await supabase.from('super_team_games').update({
          team1_score: duo1Result.team1Sets,
          team2_score: duo1Result.team2Sets,
          set_scores: setScores,
          winner_super_team_id: winnerId,
          status: duo1Result.winner ? 'completed' : 'in_progress'
        }).eq('id', duo1Game.id);
      }

      // Jogo 2 (Dupla 2)
      if (duo2Game && (duo2Set1Team1 !== '' || duo2Set1Team2 !== '')) {
        const setScores = JSON.stringify({
          format: format,
          set1: { team1: duo2Set1Team1, team2: duo2Set1Team2 },
          set2: format === '3sets' ? { team1: duo2Set2Team1, team2: duo2Set2Team2 } : null,
          set3: format === '3sets' ? { team1: duo2Set3Team1, team2: duo2Set3Team2 } : null
        });
        const winnerId = duo2Result.winner === 'team1' ? (team1?.id || null)
          : duo2Result.winner === 'team2' ? (team2?.id || null)
          : null;
        await supabase.from('super_team_games').update({
          team1_score: duo2Result.team1Sets,
          team2_score: duo2Result.team2Sets,
          set_scores: setScores,
          winner_super_team_id: winnerId,
          status: duo2Result.winner ? 'completed' : 'in_progress'
        }).eq('id', duo2Game.id);
      }

      if (tiebreakGame && needsTiebreak && tiebreakTeam1Score !== '' && tiebreakTeam2Score !== '') {
        const winnerId = Number(tiebreakTeam1Score) > Number(tiebreakTeam2Score)
          ? (team1?.id || null)
          : Number(tiebreakTeam2Score) > Number(tiebreakTeam1Score)
            ? (team2?.id || null)
            : null;
        await supabase.from('super_team_games').update({
          team1_score: String(tiebreakTeam1Score),
          team2_score: String(tiebreakTeam2Score),
          winner_super_team_id: winnerId,
          status: 'completed'
        }).eq('id', tiebreakGame.id);
      }

      // Determinar vencedor do confronto
      let winnerId = null;
      let status = 'scheduled';

      if (team1Wins === 2 || (needsTiebreak && team1Wins > team2Wins)) {
        winnerId = confrontation.super_team_1_id ?? null;
        status = 'completed';
      } else if (team2Wins === 2 || (needsTiebreak && team2Wins > team1Wins)) {
        winnerId = confrontation.super_team_2_id ?? null;
        status = 'completed';
      }

      // Atualizar confronto com resultados globais
      await supabase.from('super_team_confrontations').update({
        team1_matches_won: team1Wins,
        team2_matches_won: team2Wins,
        has_super_tiebreak: needsTiebreak,
        winner_super_team_id: winnerId,
        status: status,
      }).eq('id', confrontation.id);

      // Avançar vencedor para o próximo jogo do quadro (se existir)
      if (winnerId && confrontation.next_confrontation_id && (confrontation.next_team_slot === 1 || confrontation.next_team_slot === 2)) {
        const slot = confrontation.next_team_slot;
        const updatePayload = slot === 1
          ? { super_team_1_id: winnerId }
          : { super_team_2_id: winnerId };
        await supabase
          .from('super_team_confrontations')
          .update(updatePayload)
          .eq('id', confrontation.next_confrontation_id);
      }
      
      // Atualizar standings (classificação) para o grupo - só para jogos de grupo
      if (status === 'completed' && team1 && team2) {
        try {
          // Buscar o confronto atualizado para obter tournament_id e category_id
          const { data: confData } = await supabase
            .from('super_team_confrontations')
            .select('tournament_id, category_id, group_name, round')
            .eq('id', confrontation.id)
            .single();
          
          // Só atualizar standings para jogos de grupo
          if (confData && confData.tournament_id && confData.round === 'group') {
            const tournamentId = confData.tournament_id;
            const categoryId = confData.category_id;
            const groupName = confData.group_name;
            
            // Calcular estatísticas para cada equipa baseado em TODOS os confrontos do grupo
            const { data: allConfronts } = await supabase
              .from('super_team_confrontations')
              .select('super_team_1_id, super_team_2_id, winner_super_team_id, team1_matches_won, team2_matches_won')
              .eq('tournament_id', tournamentId)
              .eq('category_id', categoryId)
              .eq('group_name', groupName)
              .eq('round', 'group')
              .eq('status', 'completed');
            
            if (allConfronts && allConfronts.length > 0) {
              // Calcular stats para cada equipa do grupo
              const teamStats: Record<string, { played: number; won: number; lost: number; gamesWon: number; gamesLost: number; points: number }> = {};
              
              for (const conf of allConfronts) {
                const t1Id = conf.super_team_1_id;
                const t2Id = conf.super_team_2_id;
                
                if (t1Id && t2Id) {
                  if (!teamStats[t1Id]) teamStats[t1Id] = { played: 0, won: 0, lost: 0, gamesWon: 0, gamesLost: 0, points: 0 };
                  if (!teamStats[t2Id]) teamStats[t2Id] = { played: 0, won: 0, lost: 0, gamesWon: 0, gamesLost: 0, points: 0 };
                  
                  teamStats[t1Id].played++;
                  teamStats[t2Id].played++;
                  
                  // Vitórias/Derrotas (baseado no confronto, não nos jogos individuais)
                  if (conf.winner_super_team_id === t1Id) {
                    teamStats[t1Id].won++;
                    teamStats[t2Id].lost++;
                    teamStats[t1Id].points += 3;
                  } else if (conf.winner_super_team_id === t2Id) {
                    teamStats[t2Id].won++;
                    teamStats[t1Id].lost++;
                    teamStats[t2Id].points += 3;
                  }
                  
                  // Games ganhos = jogos individuais ganhos dentro do confronto
                  teamStats[t1Id].gamesWon += (conf.team1_matches_won || 0);
                  teamStats[t1Id].gamesLost += (conf.team2_matches_won || 0);
                  teamStats[t2Id].gamesWon += (conf.team2_matches_won || 0);
                  teamStats[t2Id].gamesLost += (conf.team1_matches_won || 0);
                }
              }
              
              // Atualizar ou inserir standings para cada equipa
              for (const [teamId, stats] of Object.entries(teamStats)) {
                // Verificar se já existe
                const { data: existingStandings } = await supabase
                  .from('super_team_standings')
                  .select('id')
                  .eq('tournament_id', tournamentId)
                  .eq('super_team_id', teamId);
                
                const standingData = {
                  tournament_id: tournamentId,
                  category_id: categoryId,
                  super_team_id: teamId,
                  group_name: groupName,
                  confrontations_played: stats.played,
                  confrontations_won: stats.won,
                  confrontations_lost: stats.lost,
                  games_won: stats.gamesWon,
                  games_lost: stats.gamesLost,
                  games_diff: stats.gamesWon - stats.gamesLost,
                  points: stats.points,
                };
                
                if (existingStandings && existingStandings.length > 0) {
                  await supabase
                    .from('super_team_standings')
                    .update(standingData)
                    .eq('id', existingStandings[0].id);
                } else {
                  await supabase
                    .from('super_team_standings')
                    .insert(standingData);
                }
              }
            }
          }
        } catch (standingsError) {
          console.error('Error updating standings:', standingsError);
          // Não falhar o save por causa de erro nos standings
        }
      }

      onSuccess();
    } catch (err: any) {
      console.error('Error saving results:', err);
      setError(err.message || 'Erro ao guardar resultados');
    } finally {
      setSaving(false);
    }
  };

  const { team1Wins, team2Wins, needsTiebreak } = calculateResults();

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Introduzir Resultados</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Teams */}
        <div className="p-4 bg-gray-50 border-b">
          <div className="flex items-center justify-between text-center">
            <div className="flex-1">
              <p className="font-semibold text-blue-600">{team1?.name ?? 'A definir'}</p>
            </div>
            <div className="px-4 text-gray-400 font-bold text-xl">VS</div>
            <div className="flex-1">
              <p className="font-semibold text-red-600">{team2?.name ?? 'A definir'}</p>
            </div>
          </div>
        </div>

        {/* Results Summary */}
        <div className="p-4 bg-gradient-to-r from-blue-50 to-red-50 border-b">
          <div className="flex items-center justify-center gap-4">
            <span className={`text-3xl font-bold ${team1Wins > team2Wins ? 'text-green-600' : 'text-gray-700'}`}>
              {team1Wins}
            </span>
            <span className="text-gray-400 text-xl">-</span>
            <span className={`text-3xl font-bold ${team2Wins > team1Wins ? 'text-green-600' : 'text-gray-700'}`}>
              {team2Wins}
            </span>
          </div>
          {needsTiebreak && (
            <p className="text-center text-sm text-yellow-600 mt-1">Super Tie-Break necessário!</p>
          )}
        </div>

        {/* Games */}
        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Jogo 1 - Dupla 1 */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-700">Jogo 1 (Dupla 1)</h3>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                {format === '3sets' ? 'Melhor de 3' : '1 Set'}
              </span>
            </div>
            <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-center">
              <div className="text-center text-xs text-gray-500 font-medium">{team1?.name ?? 'Equipa 1'}</div>
              <div></div>
              <div className="text-center text-xs text-gray-500 font-medium">{team2?.name ?? 'Equipa 2'}</div>
              
              {/* Set 1 */}
              <input type="number" min="0" max="7" value={duo1Set1Team1}
                onChange={(e) => setDuo1Set1Team1(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-2 py-1 border rounded text-center font-bold focus:ring-2 focus:ring-blue-500" placeholder="0" />
              <span className="text-xs text-gray-400 text-center">{format === '1set' ? 'Resultado' : 'Set 1'}</span>
              <input type="number" min="0" max="7" value={duo1Set1Team2}
                onChange={(e) => setDuo1Set1Team2(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-2 py-1 border rounded text-center font-bold focus:ring-2 focus:ring-blue-500" placeholder="0" />
              
              {/* Set 2 - só visível se for melhor de 3 */}
              {format === '3sets' && (
                <>
                  <input type="number" min="0" max="7" value={duo1Set2Team1}
                    onChange={(e) => setDuo1Set2Team1(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-2 py-1 border rounded text-center font-bold focus:ring-2 focus:ring-blue-500" placeholder="0" />
                  <span className="text-xs text-gray-400 text-center">Set 2</span>
                  <input type="number" min="0" max="7" value={duo1Set2Team2}
                    onChange={(e) => setDuo1Set2Team2(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-2 py-1 border rounded text-center font-bold focus:ring-2 focus:ring-blue-500" placeholder="0" />
                  
                  {/* Set 3 (Super Tie-Break) */}
                  <input type="number" min="0" value={duo1Set3Team1}
                    onChange={(e) => setDuo1Set3Team1(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-2 py-1 border border-yellow-300 bg-yellow-50 rounded text-center font-bold focus:ring-2 focus:ring-yellow-500" placeholder="0" />
                  <span className="text-xs text-yellow-600 text-center">Set 3</span>
                  <input type="number" min="0" value={duo1Set3Team2}
                    onChange={(e) => setDuo1Set3Team2(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-2 py-1 border border-yellow-300 bg-yellow-50 rounded text-center font-bold focus:ring-2 focus:ring-yellow-500" placeholder="0" />
                </>
              )}
            </div>
          </div>

          {/* Jogo 2 - Dupla 2 */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-700">Jogo 2 (Dupla 2)</h3>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                {format === '3sets' ? 'Melhor de 3' : '1 Set'}
              </span>
            </div>
            <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-center">
              <div className="text-center text-xs text-gray-500 font-medium">{team1?.name ?? 'Equipa 1'}</div>
              <div></div>
              <div className="text-center text-xs text-gray-500 font-medium">{team2?.name ?? 'Equipa 2'}</div>
              
              {/* Set 1 */}
              <input type="number" min="0" max="7" value={duo2Set1Team1}
                onChange={(e) => setDuo2Set1Team1(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-2 py-1 border rounded text-center font-bold focus:ring-2 focus:ring-blue-500" placeholder="0" />
              <span className="text-xs text-gray-400 text-center">{format === '1set' ? 'Resultado' : 'Set 1'}</span>
              <input type="number" min="0" max="7" value={duo2Set1Team2}
                onChange={(e) => setDuo2Set1Team2(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-2 py-1 border rounded text-center font-bold focus:ring-2 focus:ring-blue-500" placeholder="0" />
              
              {/* Set 2 - só visível se for melhor de 3 */}
              {format === '3sets' && (
                <>
                  <input type="number" min="0" max="7" value={duo2Set2Team1}
                    onChange={(e) => setDuo2Set2Team1(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-2 py-1 border rounded text-center font-bold focus:ring-2 focus:ring-blue-500" placeholder="0" />
                  <span className="text-xs text-gray-400 text-center">Set 2</span>
                  <input type="number" min="0" max="7" value={duo2Set2Team2}
                    onChange={(e) => setDuo2Set2Team2(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-2 py-1 border rounded text-center font-bold focus:ring-2 focus:ring-blue-500" placeholder="0" />
                  
                  {/* Set 3 (Super Tie-Break) */}
                  <input type="number" min="0" value={duo2Set3Team1}
                    onChange={(e) => setDuo2Set3Team1(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-2 py-1 border border-yellow-300 bg-yellow-50 rounded text-center font-bold focus:ring-2 focus:ring-yellow-500" placeholder="0" />
                  <span className="text-xs text-yellow-600 text-center">Set 3</span>
                  <input type="number" min="0" value={duo2Set3Team2}
                    onChange={(e) => setDuo2Set3Team2(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-2 py-1 border border-yellow-300 bg-yellow-50 rounded text-center font-bold focus:ring-2 focus:ring-yellow-500" placeholder="0" />
                </>
              )}
            </div>
          </div>

          {/* Super Tie-Break (apenas se empate 1-1) */}
          {needsTiebreak && (
            <div className="border-2 border-yellow-300 bg-yellow-50 rounded-lg p-4">
              <h3 className="font-medium text-yellow-700 mb-3 flex items-center gap-2">
                <Trophy className="w-4 h-4" />
                Super Tie-Break (até 10 pontos)
              </h3>
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">{team1?.name ?? 'Equipa 1'}</label>
                  <input
                    type="number"
                    min="0"
                    value={tiebreakTeam1Score}
                    onChange={(e) => setTiebreakTeam1Score(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg text-center text-lg font-bold focus:ring-2 focus:ring-yellow-500"
                    placeholder="0"
                  />
                </div>
                <span className="text-gray-400 text-xl font-bold">-</span>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">{team2?.name ?? 'Equipa 2'}</label>
                  <input
                    type="number"
                    min="0"
                    value={tiebreakTeam2Score}
                    onChange={(e) => setTiebreakTeam2Score(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg text-center text-lg font-bold focus:ring-2 focus:ring-yellow-500"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'A guardar...' : 'Guardar Resultados'}
          </button>
        </div>
      </div>
    </div>
  );
}
