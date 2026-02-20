import { useEffect, useState } from 'react';
import { supabase, Team, Player } from '../lib/supabase';
import { Trophy, Award, Medal } from 'lucide-react';
import { useI18n } from '../lib/i18nContext';
import { sortTeamsByTiebreaker, MatchData, TeamStats } from '../lib/groups';

type StandingsProps = {
  tournamentId: string;
  format: string;
  categoryId?: string | null;
  roundRobinType?: string | null;
  refreshKey?: number;
  qualifiedPerGroup?: number;
};

type IndividualPlayerStats = {
  id: string;
  name: string;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  gamesWon: number;
  gamesLost: number;
  final_position?: number | null;
  group_name?: string | null;
};

type KnockoutRanking = {
  position: number;
  players: { id: string; name: string }[];
  status: 'confirmed' | 'pending';
  matchType: string;
};

type IndividualFinalRanking = {
  position: number;
  player: { id: string; name: string };
  groupStats: { wins: number; gamesWon: number; gamesLost: number };
  status: 'confirmed' | 'pending';
};

type TeamWithPlayers = Team & {
  player1: Player;
  player2: Player;
  wins: number;
  losses: number;
  matchesPlayed: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
};

export default function Standings({ tournamentId, format, categoryId, roundRobinType, refreshKey, qualifiedPerGroup = 2 }: StandingsProps) {
  const { t } = useI18n();
  const [teams, setTeams] = useState<TeamWithPlayers[]>([]);
  const [groupedTeams, setGroupedTeams] = useState<Map<string, TeamWithPlayers[]>>(new Map());
  const [individualPlayers, setIndividualPlayers] = useState<IndividualPlayerStats[]>([]);
  const [knockoutRankings, setKnockoutRankings] = useState<KnockoutRanking[]>([]);
  const [individualFinalRankings, setIndividualFinalRankings] = useState<IndividualFinalRanking[]>([]);
  const [loading, setLoading] = useState(true);

  const isIndividualRoundRobin = format === 'round_robin' && roundRobinType === 'individual';
  const isIndividualGroupsKnockout = format === 'individual_groups_knockout' || format === 'crossed_playoffs' || format === 'mixed_gender' || format === 'mixed_american';
  const isMixedAmerican = format === 'mixed_american' || format === 'mixed_gender'; // Kept for rendering label only

  useEffect(() => {
    console.log('[STANDINGS] Component mounted, fetching standings...');
    fetchStandings();
  }, [tournamentId, categoryId, roundRobinType, refreshKey]);

  const fetchStandings = async () => {
    console.log('[STANDINGS] Fetching standings for tournament:', tournamentId, 'category:', categoryId, 'type:', roundRobinType);
    setLoading(true);

    // For individual groups knockout, fetch individual players with groups
    if (isIndividualGroupsKnockout) {
      console.log('[STANDINGS-INDIVIDUAL-GROUPS] Fetching individual players for tournament:', tournamentId);
      const { data: playersData, error: playersError } = await supabase
        .from('players')
        .select('id, name, group_name, category_id, final_position')
        .eq('tournament_id', tournamentId);

      if (categoryId) {
        const filteredPlayers = playersData?.filter(p => p.category_id === categoryId);
        const { data: matches, error: matchesError } = await supabase
          .from('matches')
          .select('id, round, status, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id')
          .eq('tournament_id', tournamentId)
          .eq('category_id', categoryId)
          .eq('status', 'completed');

        if (!filteredPlayers || !matches) {
          setLoading(false);
          return;
        }

        // Group players by group_name
        const playersByGroup = new Map<string, typeof filteredPlayers>();
        filteredPlayers.forEach(player => {
          if (player.group_name) {
            if (!playersByGroup.has(player.group_name)) {
              playersByGroup.set(player.group_name, []);
            }
            playersByGroup.get(player.group_name)!.push(player);
          }
        });

        const playerOrder = new Map<string, number>();
        filteredPlayers.forEach((player, index) => {
          playerOrder.set(player.id, index);
        });

        const groupedStatsMap = new Map<string, IndividualPlayerStats[]>();

        playersByGroup.forEach((groupPlayers, groupName) => {
          const playerStatsMap = new Map<string, IndividualPlayerStats>();

          groupPlayers.forEach(player => {
            playerStatsMap.set(player.id, {
              id: player.id,
              name: player.name,
              matchesPlayed: 0,
              wins: 0,
              draws: 0,
              losses: 0,
              gamesWon: 0,
              gamesLost: 0,
              final_position: player.final_position,
              group_name: player.group_name,
            });
          });

          const groupMatches = matches.filter(m =>
            m.round?.startsWith('group_') &&
            groupPlayers.some(p =>
              p.id === (m as any).player1_individual_id ||
              p.id === (m as any).player2_individual_id ||
              p.id === (m as any).player3_individual_id ||
              p.id === (m as any).player4_individual_id
            )
          );

          groupMatches.forEach(match => {
            const player1Id = (match as any).player1_individual_id;
            const player2Id = (match as any).player2_individual_id;
            const player3Id = (match as any).player3_individual_id;
            const player4Id = (match as any).player4_individual_id;

            const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
            const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
            const isDraw = team1Games === team2Games;
            const team1Won = team1Games > team2Games;

            [player1Id, player2Id].forEach(playerId => {
              if (playerId && playerStatsMap.has(playerId)) {
                const stats = playerStatsMap.get(playerId)!;
                stats.matchesPlayed++;
                stats.gamesWon += team1Games;
                stats.gamesLost += team2Games;
                if (isDraw) stats.draws++;
                else if (team1Won) stats.wins++;
                else stats.losses++;
              }
            });

            [player3Id, player4Id].forEach(playerId => {
              if (playerId && playerStatsMap.has(playerId)) {
                const stats = playerStatsMap.get(playerId)!;
                stats.matchesPlayed++;
                stats.gamesWon += team2Games;
                stats.gamesLost += team1Games;
                if (isDraw) stats.draws++;
                else if (!team1Won) stats.wins++;
                else stats.losses++;
              }
            });
          });

          const playerStats = Array.from(playerStatsMap.values());
          const teamStatsForSort: TeamStats[] = playerStats.map(p => ({
            id: p.id,
            name: p.name,
            group_name: groupName,
            wins: p.wins,
            draws: p.draws,
            gamesWon: p.gamesWon,
            gamesLost: p.gamesLost
          }));
          // INDIVIDUAL AMERICANO: NÃO existe confronto direto (parceiros mudam a cada ronda)
          // Critérios de desempate: 1° Vitórias > 2° Pontos > 3° Diferença de jogos > 4° Jogos ganhos > 5° Data inscrição
          const sortedTeamStats = sortTeamsByTiebreaker(teamStatsForSort, [], playerOrder);
          const sortedPlayerStats = sortedTeamStats.map(ts => playerStats.find(p => p.id === ts.id)!);

          groupedStatsMap.set(groupName, sortedPlayerStats);
        });

        // Store grouped stats for rendering
        setGroupedTeams(groupedStatsMap as any);

        // ═══════════════════════════════════════════════════════════════
        // BUSCAR TODOS OS MATCHES DO TORNEIO (uma query simples, sem filtros complexos)
        // ═══════════════════════════════════════════════════════════════
        const { data: allTournamentMatches } = await supabase
          .from('matches')
          .select('*')
          .eq('tournament_id', tournamentId);

        // Separar knockout matches (tudo que NÃO começa com 'group_')
        const knockoutMatches = (allTournamentMatches || []).filter(m => 
          m.round && !m.round.startsWith('group_')
        );

        // Create a global stats map for all players from group stage
        const globalPlayerStats = new Map<string, { wins: number; draws: number; gamesWon: number; gamesLost: number }>();
        groupedStatsMap.forEach((groupPlayers) => {
          groupPlayers.forEach(player => {
            globalPlayerStats.set(player.id, {
              wins: player.wins,
              draws: player.draws,
              gamesWon: player.gamesWon,
              gamesLost: player.gamesLost
            });
          });
        });

        // Para formatos mistos: buscar stats de TODAS as categorias
        if (isMixedAmerican) {
          const { data: allPlayersData } = await supabase
            .from('players')
            .select('id, name, group_name, category_id, final_position')
            .eq('tournament_id', tournamentId);
          
          if (allPlayersData) {
            // Buscar group matches da outra categoria
            const otherCatGroupMatches = (allTournamentMatches || []).filter(m => 
              m.round?.startsWith('group_') && m.status === 'completed' && m.category_id && m.category_id !== categoryId
            );
            
            const otherCatPlayers = allPlayersData.filter(p => p.category_id !== categoryId);
            otherCatPlayers.forEach(player => {
              if (!globalPlayerStats.has(player.id)) {
                globalPlayerStats.set(player.id, { wins: 0, draws: 0, gamesWon: 0, gamesLost: 0 });
              }
            });
            
            otherCatGroupMatches.forEach(match => {
              const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
              const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
              const team1Won = team1Games > team2Games;
              const isDraw = team1Games === team2Games;
              
              [match.player1_individual_id, match.player2_individual_id].forEach((pid: string) => {
                if (pid && globalPlayerStats.has(pid)) {
                  const s = globalPlayerStats.get(pid)!;
                  s.gamesWon += team1Games; s.gamesLost += team2Games;
                  if (isDraw) s.draws++; else if (team1Won) s.wins++;
                }
              });
              [match.player3_individual_id, match.player4_individual_id].forEach((pid: string) => {
                if (pid && globalPlayerStats.has(pid)) {
                  const s = globalPlayerStats.get(pid)!;
                  s.gamesWon += team2Games; s.gamesLost += team1Games;
                  if (isDraw) s.draws++; else if (!team1Won) s.wins++;
                }
              });
            });
          }
        }

        // PlayerMap: nomes de TODOS os jogadores
        const playerMap = new Map(filteredPlayers.map(p => [p.id, p.name]));
        if (isMixedAmerican) {
          const { data: allPlayersForMap } = await supabase
            .from('players')
            .select('id, name')
            .eq('tournament_id', tournamentId);
          allPlayersForMap?.forEach(p => { if (!playerMap.has(p.id)) playerMap.set(p.id, p.name); });
        }

        // ═══════════════════════════════════════════════════════════════
        // CLASSIFICAÇÃO FINAL — LÓGICA SIMPLES E CLARA
        // 1°, 2° = Vencedores da Final
        // 3°, 4° = Vencidos da Final  
        // 5°, 6° = Vencedores da Pequena Final (3°/4° lugar)
        // 7°, 8° = Vencidos da Pequena Final
        // ═══════════════════════════════════════════════════════════════
        const individualRankings: IndividualFinalRanking[] = [];
        
        const sortByGroupStats = (playerIds: string[]): string[] => {
          return [...playerIds].sort((a, b) => {
            const sa = globalPlayerStats.get(a) || { wins: 0, draws: 0, gamesWon: 0, gamesLost: 0 };
            const sb = globalPlayerStats.get(b) || { wins: 0, draws: 0, gamesWon: 0, gamesLost: 0 };
            if (sb.wins !== sa.wins) return sb.wins - sa.wins;
            const diffA = sa.gamesWon - sa.gamesLost;
            const diffB = sb.gamesWon - sb.gamesLost;
            if (diffB !== diffA) return diffB - diffA;
            return sb.gamesWon - sa.gamesWon;
          });
        };

        const getMatchWinnerLoser = (match: any) => {
          const t1 = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
          const t2 = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
          const team1 = [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
          const team2 = [match.player3_individual_id, match.player4_individual_id].filter(Boolean);
          return {
            winners: t1 > t2 ? team1 : team2,
            losers: t1 > t2 ? team2 : team1,
          };
        };

        // Encontrar matches completados
        const finalMatch = knockoutMatches.find(m => 
          (m.round === 'final' || m.round === 'mixed_final') && m.status === 'completed'
        );
        const thirdPlaceMatch = knockoutMatches.find(m => 
          (m.round === '3rd_place' || m.round === 'mixed_3rd_place') && m.status === 'completed'
        );

        console.log('[STANDINGS] Knockout: total=' + knockoutMatches.length + 
          ' rounds=' + knockoutMatches.map(m => m.round + ':' + m.status).join(', '));

        const rankedPlayerIds = new Set<string>();

        // 1°, 2° — VENCEDORES DA FINAL
        if (finalMatch) {
          const { winners, losers } = getMatchWinnerLoser(finalMatch);
          console.log('[STANDINGS] Final winners:', winners.map((id: string) => playerMap.get(id)), 
                       'losers:', losers.map((id: string) => playerMap.get(id)));
          
          sortByGroupStats(winners).forEach((pid: string, idx: number) => {
            individualRankings.push({
              position: idx + 1,  // FIXO: 1°, 2°
              player: { id: pid, name: playerMap.get(pid) || pid },
              groupStats: globalPlayerStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 },
              status: 'confirmed'
            });
            rankedPlayerIds.add(pid);
          });

          // 3°, 4° — VENCIDOS DA FINAL
          sortByGroupStats(losers).forEach((pid: string, idx: number) => {
            individualRankings.push({
              position: 3 + idx,  // FIXO: 3°, 4°
              player: { id: pid, name: playerMap.get(pid) || pid },
              groupStats: globalPlayerStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 },
              status: 'confirmed'
            });
            rankedPlayerIds.add(pid);
          });
        }

        // 5°, 6° — VENCEDORES DA PEQUENA FINAL (3°/4° lugar)
        if (thirdPlaceMatch) {
          const { winners, losers } = getMatchWinnerLoser(thirdPlaceMatch);
          
          sortByGroupStats(winners.filter((id: string) => !rankedPlayerIds.has(id)))
            .forEach((pid: string, idx: number) => {
              individualRankings.push({
                position: 5 + idx,  // FIXO: 5°, 6°
                player: { id: pid, name: playerMap.get(pid) || pid },
                groupStats: globalPlayerStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 },
                status: 'confirmed'
              });
              rankedPlayerIds.add(pid);
            });

          // 7°, 8° — VENCIDOS DA PEQUENA FINAL
          sortByGroupStats(losers.filter((id: string) => !rankedPlayerIds.has(id)))
            .forEach((pid: string, idx: number) => {
              individualRankings.push({
                position: 7 + idx,  // FIXO: 7°, 8°
                player: { id: pid, name: playerMap.get(pid) || pid },
                groupStats: globalPlayerStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 },
                status: 'confirmed'
              });
              rankedPlayerIds.add(pid);
            });
        }

        // Restantes (se houver jogadores não classificados pelo knockout)
        const remaining = Array.from(globalPlayerStats.keys()).filter(id => !rankedPlayerIds.has(id));
        if (remaining.length > 0) {
          const nextPos = individualRankings.length > 0
            ? Math.max(...individualRankings.map(r => r.position)) + 1
            : 1;
          sortByGroupStats(remaining).forEach((pid, idx) => {
            individualRankings.push({
              position: nextPos + idx,
              player: { id: pid, name: playerMap.get(pid) || pid },
              groupStats: globalPlayerStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 },
              status: 'pending'
            });
          });
        }

        individualRankings.sort((a, b) => a.position - b.position);
        setIndividualFinalRankings(individualRankings);
        setKnockoutRankings([]);

        setLoading(false);
        return;
      } else {
        // categoryId is null - process ALL players across all categories
        console.log('[STANDINGS-INDIVIDUAL-GROUPS] Processing all players (no category filter)');
        
        const { data: matches } = await supabase
          .from('matches')
          .select('id, round, status, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id, category_id')
          .eq('tournament_id', tournamentId)
          .eq('status', 'completed');

        if (!playersData || !matches) {
          setLoading(false);
          return;
        }

        // Group players by group_name
        const playersByGroup = new Map<string, typeof playersData>();
        playersData.forEach(player => {
          if (player.group_name) {
            if (!playersByGroup.has(player.group_name)) {
              playersByGroup.set(player.group_name, []);
            }
            playersByGroup.get(player.group_name)!.push(player);
          }
        });

        console.log('[STANDINGS-INDIVIDUAL-GROUPS] Groups found:', Array.from(playersByGroup.keys()));

        const groupedStatsMap = new Map<string, IndividualPlayerStats[]>();

        playersByGroup.forEach((groupPlayers, groupName) => {
          const playerStatsMap = new Map<string, IndividualPlayerStats>();

          groupPlayers.forEach(player => {
            playerStatsMap.set(player.id, {
              id: player.id,
              name: player.name,
              matchesPlayed: 0,
              wins: 0,
              draws: 0,
              losses: 0,
              gamesWon: 0,
              gamesLost: 0,
              final_position: player.final_position,
              group_name: player.group_name,
            });
          });

          const groupMatches = matches.filter(m =>
            m.round?.startsWith('group_') &&
            groupPlayers.some(p =>
              p.id === (m as any).player1_individual_id ||
              p.id === (m as any).player2_individual_id ||
              p.id === (m as any).player3_individual_id ||
              p.id === (m as any).player4_individual_id
            )
          );

          groupMatches.forEach(match => {
            const player1Id = (match as any).player1_individual_id;
            const player2Id = (match as any).player2_individual_id;
            const player3Id = (match as any).player3_individual_id;
            const player4Id = (match as any).player4_individual_id;

            const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
            const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
            const isDraw = team1Games === team2Games;
            const team1Won = team1Games > team2Games;

            [player1Id, player2Id].forEach(playerId => {
              if (playerId && playerStatsMap.has(playerId)) {
                const stats = playerStatsMap.get(playerId)!;
                stats.matchesPlayed++;
                stats.gamesWon += team1Games;
                stats.gamesLost += team2Games;
                if (isDraw) stats.draws++;
                else if (team1Won) stats.wins++;
                else stats.losses++;
              }
            });

            [player3Id, player4Id].forEach(playerId => {
              if (playerId && playerStatsMap.has(playerId)) {
                const stats = playerStatsMap.get(playerId)!;
                stats.matchesPlayed++;
                stats.gamesWon += team2Games;
                stats.gamesLost += team1Games;
                if (isDraw) stats.draws++;
                else if (!team1Won) stats.wins++;
                else stats.losses++;
              }
            });
          });

          const playerStats = Array.from(playerStatsMap.values());
          // Sort by: 1) Wins, 2) Points (V=2, E=1, D=0), 3) Game diff, 4) Games won
          playerStats.sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            const ptsA = a.wins * 2 + a.draws;
            const ptsB = b.wins * 2 + b.draws;
            if (ptsB !== ptsA) return ptsB - ptsA;
            const aDiff = a.gamesWon - a.gamesLost;
            const bDiff = b.gamesWon - b.gamesLost;
            if (bDiff !== aDiff) return bDiff - aDiff;
            return b.gamesWon - a.gamesWon;
          });

          groupedStatsMap.set(groupName, playerStats);
        });

        console.log('[STANDINGS-INDIVIDUAL-GROUPS] Grouped stats:', groupedStatsMap.size, 'groups');
        setGroupedTeams(groupedStatsMap as any);

        const globalPlayerStats = new Map<string, { wins: number; draws: number; gamesWon: number; gamesLost: number }>();
        groupedStatsMap.forEach((groupPlayers) => {
          groupPlayers.forEach(player => {
            globalPlayerStats.set(player.id, {
              wins: player.wins,
              draws: player.draws,
              gamesWon: player.gamesWon,
              gamesLost: player.gamesLost
            });
          });
        });

        // ═══════════════════════════════════════════════════════════════
        // Para formatos MISTOS: calcular ranking a partir dos KNOCKOUT RESULTS
        // NÃO usar final_position da DB (pode estar errado)
        // ═══════════════════════════════════════════════════════════════
        if (isMixedAmerican) {
          const sortByGroupStats = (playerIds: string[]): string[] => {
            return [...playerIds].sort((a, b) => {
              const sa = globalPlayerStats.get(a) || { wins: 0, draws: 0, gamesWon: 0, gamesLost: 0 };
              const sb = globalPlayerStats.get(b) || { wins: 0, draws: 0, gamesWon: 0, gamesLost: 0 };
              if (sb.wins !== sa.wins) return sb.wins - sa.wins;
              const diffA = sa.gamesWon - sa.gamesLost;
              const diffB = sb.gamesWon - sb.gamesLost;
              if (diffB !== diffA) return diffB - diffA;
              return sb.gamesWon - sa.gamesWon;
            });
          };

          const getMatchWL = (match: any) => {
            const t1 = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
            const t2 = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
            const team1 = [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
            const team2 = [match.player3_individual_id, match.player4_individual_id].filter(Boolean);
            return { winners: t1 > t2 ? team1 : team2, losers: t1 > t2 ? team2 : team1 };
          };

          const playerMap = new Map(playersData.map(p => [p.id, p.name]));
          const finalMatch = matches.find(m => (m.round === 'final' || m.round === 'mixed_final') && m.status === 'completed');
          const thirdPlaceMatch = matches.find(m => (m.round === '3rd_place' || m.round === 'mixed_3rd_place') && m.status === 'completed');

          console.log('[STANDINGS] Mixed knockout: final=' + (finalMatch ? 'completed' : 'not found') + 
                       ', 3rd_place=' + (thirdPlaceMatch ? 'completed' : 'not found'));

          const individualRankings: IndividualFinalRanking[] = [];
          const rankedIds = new Set<string>();

          if (finalMatch) {
            const { winners, losers } = getMatchWL(finalMatch);
            console.log('[STANDINGS] Final: winners=', winners.map((id: string) => playerMap.get(id)), 
                         'losers=', losers.map((id: string) => playerMap.get(id)));
            
            // 1°, 2° — Vencedores da Final
            sortByGroupStats(winners).forEach((pid: string, idx: number) => {
              individualRankings.push({
                position: idx + 1,
                player: { id: pid, name: playerMap.get(pid) || pid },
                groupStats: globalPlayerStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 },
                status: 'confirmed'
              });
              rankedIds.add(pid);
            });

            // 3°, 4° — Vencidos da Final
            sortByGroupStats(losers).forEach((pid: string, idx: number) => {
              individualRankings.push({
                position: 3 + idx,
                player: { id: pid, name: playerMap.get(pid) || pid },
                groupStats: globalPlayerStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 },
                status: 'confirmed'
              });
              rankedIds.add(pid);
            });
          }

          if (thirdPlaceMatch) {
            const { winners, losers } = getMatchWL(thirdPlaceMatch);
            
            // 5°, 6° — Vencedores da Pequena Final
            sortByGroupStats(winners.filter((id: string) => !rankedIds.has(id)))
              .forEach((pid: string, idx: number) => {
                individualRankings.push({
                  position: 5 + idx,
                  player: { id: pid, name: playerMap.get(pid) || pid },
                  groupStats: globalPlayerStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 },
                  status: 'confirmed'
                });
                rankedIds.add(pid);
              });

            // 7°, 8° — Vencidos da Pequena Final
            sortByGroupStats(losers.filter((id: string) => !rankedIds.has(id)))
              .forEach((pid: string, idx: number) => {
                individualRankings.push({
                  position: 7 + idx,
                  player: { id: pid, name: playerMap.get(pid) || pid },
                  groupStats: globalPlayerStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 },
                  status: 'confirmed'
                });
                rankedIds.add(pid);
              });
          }

          // Restantes
          const remaining = Array.from(globalPlayerStats.keys()).filter(id => !rankedIds.has(id));
          if (remaining.length > 0) {
            const nextPos = individualRankings.length > 0 ? Math.max(...individualRankings.map(r => r.position)) + 1 : 1;
            sortByGroupStats(remaining).forEach((pid, idx) => {
              individualRankings.push({
                position: nextPos + idx,
                player: { id: pid, name: playerMap.get(pid) || pid },
                groupStats: globalPlayerStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 },
                status: 'pending'
              });
            });
          }

          individualRankings.sort((a, b) => a.position - b.position);
          console.log('[STANDINGS] Mixed final rankings:', individualRankings.map(r => r.position + '° ' + r.player.name));
          setIndividualFinalRankings(individualRankings);
          setKnockoutRankings([]);
          setGroupedTeams(groupedStatsMap as any);
          setLoading(false);
          return;
        }

        // Para formatos NÃO mistos: usar final_position da DB se disponível
        const playersWithDbPosition = playersData.filter(p => p.final_position);
        if (playersWithDbPosition.length > 0) {
          const individualRankings: IndividualFinalRanking[] = [];
          playersWithDbPosition
            .sort((a, b) => (a.final_position || 999) - (b.final_position || 999))
            .forEach(player => {
              const stats = globalPlayerStats.get(player.id) || { wins: 0, gamesWon: 0, gamesLost: 0 };
              individualRankings.push({
                position: player.final_position!,
                player: { id: player.id, name: player.name },
                groupStats: stats,
                status: 'confirmed'
              });
            });

          const rankedIds = new Set(playersWithDbPosition.map(p => p.id));
          const unrankedPlayers = playersData
            .filter(p => !rankedIds.has(p.id))
            .sort((a, b) => {
              const statsA = globalPlayerStats.get(a.id) || { wins: 0, draws: 0, gamesWon: 0, gamesLost: 0 };
              const statsB = globalPlayerStats.get(b.id) || { wins: 0, draws: 0, gamesWon: 0, gamesLost: 0 };
              if (statsB.wins !== statsA.wins) return statsB.wins - statsA.wins;
              const diffA = statsA.gamesWon - statsA.gamesLost;
              const diffB = statsB.gamesWon - statsB.gamesLost;
              return diffB - diffA;
            });

          const maxPos = Math.max(...individualRankings.map(r => r.position));
          unrankedPlayers.forEach((player, idx) => {
            const stats = globalPlayerStats.get(player.id) || { wins: 0, gamesWon: 0, gamesLost: 0 };
            individualRankings.push({
              position: maxPos + 1 + idx,
              player: { id: player.id, name: player.name },
              groupStats: stats,
              status: 'pending'
            });
          });

          individualRankings.sort((a, b) => a.position - b.position);
          console.log('[STANDINGS-INDIVIDUAL-GROUPS] Final rankings (from DB):', individualRankings.length);
          setIndividualFinalRankings(individualRankings);
          setKnockoutRankings([]);
          setLoading(false);
          return;
        }

        // Calculate individual final rankings from knockout matches
        const knockoutMatches = matches.filter(m =>
          m.round?.startsWith('mixed_') ||
          m.round?.startsWith('crossed_') ||
          m.round === 'semifinal' ||
          m.round === 'final' ||
          m.round === '3rd_place' ||
          m.round === '5th_place' ||
          m.round === '7th_place' ||
          m.round === '9th_place' ||
          m.round === '11th_place'
        );

        console.log('[STANDINGS-INDIVIDUAL-GROUPS] Knockout matches found:', knockoutMatches.length);

        const playerOrder = new Map<string, number>();
        playersData.forEach((player, index) => {
          playerOrder.set(player.id, index);
        });

        // Helper function to get head-to-head result between two players
        const getHeadToHead = (player1Id: string, player2Id: string): number => {
          // Find matches where these two players played against each other
          const h2hMatches = matches.filter(m => {
            const team1Players = [(m as any).player1_individual_id, (m as any).player2_individual_id].filter(Boolean);
            const team2Players = [(m as any).player3_individual_id, (m as any).player4_individual_id].filter(Boolean);
            return (team1Players.includes(player1Id) && team2Players.includes(player2Id)) ||
                   (team1Players.includes(player2Id) && team2Players.includes(player1Id));
          });

          if (h2hMatches.length === 0) return 0;

          let player1Wins = 0;
          let player2Wins = 0;

          h2hMatches.forEach(match => {
            const team1Players = [(match as any).player1_individual_id, (match as any).player2_individual_id].filter(Boolean);
            const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
            const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
            
            if (team1Games > team2Games) {
              if (team1Players.includes(player1Id)) player1Wins++;
              else player2Wins++;
            } else if (team2Games > team1Games) {
              if (team1Players.includes(player1Id)) player2Wins++;
              else player1Wins++;
            }
          });

          return player1Wins - player2Wins; // positive = player1 wins h2h, negative = player2 wins h2h
        };

        // Sort function with all tiebreakers
        const sortPlayers = (players: { id: string; name: string; stats: { wins: number; draws?: number; gamesWon: number; gamesLost: number } }[]) => {
          return players.sort((a, b) => {
            // 1. Vitórias
            if (b.stats.wins !== a.stats.wins) return b.stats.wins - a.stats.wins;
            
            // 2. Pontos (V=2, E=1, D=0)
            const ptsA = a.stats.wins * 2 + (a.stats.draws || 0);
            const ptsB = b.stats.wins * 2 + (b.stats.draws || 0);
            if (ptsB !== ptsA) return ptsB - ptsA;
            
            // 3. Confronto direto (only for 2 players)
            const h2h = getHeadToHead(a.id, b.id);
            if (h2h !== 0) return -h2h; // negative h2h means b wins, so return positive to put b first
            
            // 4. Diferença de jogos
            const aDiff = a.stats.gamesWon - a.stats.gamesLost;
            const bDiff = b.stats.gamesWon - b.stats.gamesLost;
            if (bDiff !== aDiff) return bDiff - aDiff;
            
            // 5. Maior número de jogos ganhos
            if (b.stats.gamesWon !== a.stats.gamesWon) return b.stats.gamesWon - a.stats.gamesWon;
            
            // 6. Ordem de inscrição
            return (playerOrder.get(a.id) || 0) - (playerOrder.get(b.id) || 0);
          });
        };

        const individualRankings: IndividualFinalRanking[] = [];
        const rankedPlayerIds = new Set<string>();

        if (knockoutMatches.length > 0) {
          // Determine positions from knockout results
          const finalMatch = knockoutMatches.find(m => m.round === 'mixed_final' || m.round === 'final' || m.round === 'crossed_r3_final');
          const thirdPlaceMatch = knockoutMatches.find(m => m.round === 'mixed_3rd_place' || m.round === '3rd_place' || m.round === 'crossed_r3_3rd_place');

          // Process final match (1st and 2nd place)
          if (finalMatch && finalMatch.status === 'completed') {
            const team1Games = (finalMatch.team1_score_set1 || 0) + (finalMatch.team1_score_set2 || 0) + (finalMatch.team1_score_set3 || 0);
            const team2Games = (finalMatch.team2_score_set1 || 0) + (finalMatch.team2_score_set2 || 0) + (finalMatch.team2_score_set3 || 0);
            const team1Won = team1Games > team2Games;

            const winnerIds = team1Won 
              ? [(finalMatch as any).player1_individual_id, (finalMatch as any).player2_individual_id].filter(Boolean)
              : [(finalMatch as any).player3_individual_id, (finalMatch as any).player4_individual_id].filter(Boolean);
            const loserIds = team1Won
              ? [(finalMatch as any).player3_individual_id, (finalMatch as any).player4_individual_id].filter(Boolean)
              : [(finalMatch as any).player1_individual_id, (finalMatch as any).player2_individual_id].filter(Boolean);

            // Sort winners by tiebreakers for 1st and 2nd within winners
            const winnersWithStats = winnerIds.map(id => ({
              id,
              name: playersData.find(p => p.id === id)?.name || '',
              stats: globalPlayerStats.get(id) || { wins: 0, gamesWon: 0, gamesLost: 0 }
            }));
            const sortedWinners = sortPlayers(winnersWithStats);

            sortedWinners.forEach((player, idx) => {
              const playerData = playersData.find(p => p.id === player.id);
              if (playerData) {
                individualRankings.push({
                  position: idx + 1,
                  player: { id: playerData.id, name: playerData.name },
                  groupStats: player.stats,
                  status: 'confirmed'
                });
                rankedPlayerIds.add(player.id);
              }
            });

            // Sort losers by tiebreakers for 3rd and 4th (if no 3rd place match) or just add as finalists
            const losersWithStats = loserIds.map(id => ({
              id,
              name: playersData.find(p => p.id === id)?.name || '',
              stats: globalPlayerStats.get(id) || { wins: 0, gamesWon: 0, gamesLost: 0 }
            }));
            const sortedLosers = sortPlayers(losersWithStats);

            if (!thirdPlaceMatch || thirdPlaceMatch.status !== 'completed') {
              // No 3rd place match, so finalists losers get 3rd based on tiebreakers
              sortedLosers.forEach((player, idx) => {
                const playerData = playersData.find(p => p.id === player.id);
                if (playerData) {
                  individualRankings.push({
                    position: sortedWinners.length + idx + 1,
                    player: { id: playerData.id, name: playerData.name },
                    groupStats: player.stats,
                    status: 'confirmed'
                  });
                  rankedPlayerIds.add(player.id);
                }
              });
            }
          }

          // Process 3rd place match
          if (thirdPlaceMatch && thirdPlaceMatch.status === 'completed') {
            const team1Games = (thirdPlaceMatch.team1_score_set1 || 0) + (thirdPlaceMatch.team1_score_set2 || 0) + (thirdPlaceMatch.team1_score_set3 || 0);
            const team2Games = (thirdPlaceMatch.team2_score_set1 || 0) + (thirdPlaceMatch.team2_score_set2 || 0) + (thirdPlaceMatch.team2_score_set3 || 0);
            const team1Won = team1Games > team2Games;

            const winnerIds = team1Won 
              ? [(thirdPlaceMatch as any).player1_individual_id, (thirdPlaceMatch as any).player2_individual_id].filter(Boolean)
              : [(thirdPlaceMatch as any).player3_individual_id, (thirdPlaceMatch as any).player4_individual_id].filter(Boolean);
            const loserIds = team1Won
              ? [(thirdPlaceMatch as any).player3_individual_id, (thirdPlaceMatch as any).player4_individual_id].filter(Boolean)
              : [(thirdPlaceMatch as any).player1_individual_id, (thirdPlaceMatch as any).player2_individual_id].filter(Boolean);

            // 3rd place winners - sorted by tiebreakers
            const winnersWithStats = winnerIds.filter(id => !rankedPlayerIds.has(id)).map(id => ({
              id,
              name: playersData.find(p => p.id === id)?.name || '',
              stats: globalPlayerStats.get(id) || { wins: 0, gamesWon: 0, gamesLost: 0 }
            }));
            const sortedWinners = sortPlayers(winnersWithStats);

            let nextPos = individualRankings.length + 1;
            sortedWinners.forEach((player) => {
              const playerData = playersData.find(p => p.id === player.id);
              if (playerData) {
                individualRankings.push({
                  position: nextPos++,
                  player: { id: playerData.id, name: playerData.name },
                  groupStats: player.stats,
                  status: 'confirmed'
                });
                rankedPlayerIds.add(player.id);
              }
            });

            // 4th place losers - sorted by tiebreakers  
            const losersWithStats = loserIds.filter(id => !rankedPlayerIds.has(id)).map(id => ({
              id,
              name: playersData.find(p => p.id === id)?.name || '',
              stats: globalPlayerStats.get(id) || { wins: 0, gamesWon: 0, gamesLost: 0 }
            }));
            const sortedLosers = sortPlayers(losersWithStats);

            sortedLosers.forEach((player) => {
              const playerData = playersData.find(p => p.id === player.id);
              if (playerData) {
                individualRankings.push({
                  position: nextPos++,
                  player: { id: playerData.id, name: playerData.name },
                  groupStats: player.stats,
                  status: 'confirmed'
                });
                rankedPlayerIds.add(player.id);
              }
            });
          }

          const placementRounds = ['5th_place', '7th_place', '9th_place', '11th_place'];
          for (const roundName of placementRounds) {
            const placementMatch = knockoutMatches.find(m => m.round === roundName);
            if (placementMatch && placementMatch.status === 'completed') {
              const t1G = (placementMatch.team1_score_set1 || 0) + (placementMatch.team1_score_set2 || 0) + (placementMatch.team1_score_set3 || 0);
              const t2G = (placementMatch.team2_score_set1 || 0) + (placementMatch.team2_score_set2 || 0) + (placementMatch.team2_score_set3 || 0);
              const t1W = t1G > t2G;
              const wIds = t1W
                ? [(placementMatch as any).player1_individual_id, (placementMatch as any).player2_individual_id].filter(Boolean)
                : [(placementMatch as any).player3_individual_id, (placementMatch as any).player4_individual_id].filter(Boolean);
              const lIds = t1W
                ? [(placementMatch as any).player3_individual_id, (placementMatch as any).player4_individual_id].filter(Boolean)
                : [(placementMatch as any).player1_individual_id, (placementMatch as any).player2_individual_id].filter(Boolean);

              let nPos = individualRankings.length + 1;
              const wStats = wIds.filter(id => !rankedPlayerIds.has(id)).map(id => ({
                id, name: playersData.find(p => p.id === id)?.name || '',
                stats: globalPlayerStats.get(id) || { wins: 0, gamesWon: 0, gamesLost: 0 }
              }));
              sortPlayers(wStats).forEach(player => {
                const pd = playersData.find(p => p.id === player.id);
                if (pd) {
                  individualRankings.push({ position: nPos++, player: { id: pd.id, name: pd.name }, groupStats: player.stats, status: 'confirmed' });
                  rankedPlayerIds.add(player.id);
                }
              });
              const lStats = lIds.filter(id => !rankedPlayerIds.has(id)).map(id => ({
                id, name: playersData.find(p => p.id === id)?.name || '',
                stats: globalPlayerStats.get(id) || { wins: 0, gamesWon: 0, gamesLost: 0 }
              }));
              sortPlayers(lStats).forEach(player => {
                const pd = playersData.find(p => p.id === player.id);
                if (pd) {
                  individualRankings.push({ position: nPos++, player: { id: pd.id, name: pd.name }, groupStats: player.stats, status: 'confirmed' });
                  rankedPlayerIds.add(player.id);
                }
              });
            }
          }
        }

        // Add remaining players based on group performance with tiebreakers
        const remainingPlayers = playersData
          .filter(player => !rankedPlayerIds.has(player.id))
          .map(player => ({
            id: player.id,
            name: player.name,
            stats: globalPlayerStats.get(player.id) || { wins: 0, gamesWon: 0, gamesLost: 0 }
          }));

        const sortedRemaining = sortPlayers(remainingPlayers);
        let nextPosition = individualRankings.length + 1;

        sortedRemaining.forEach((player) => {
          const playerData = playersData.find(p => p.id === player.id);
          if (playerData) {
            individualRankings.push({
              position: nextPosition++,
              player: { id: playerData.id, name: playerData.name },
              groupStats: player.stats,
              status: 'confirmed'
            });
          }
        });

        console.log('[STANDINGS-INDIVIDUAL-GROUPS] Final rankings:', individualRankings.length);
        setIndividualFinalRankings(individualRankings);

        setLoading(false);
        return;
      }
    }

    // For Mixed American (Americano Misto), fetch ALL players from BOTH categories
    // Matches have category_id = null, so we don't filter by category
    if (isMixedAmerican) {
      console.log('[STANDINGS-MIXED] Fetching all players for mixed american tournament:', tournamentId);
      const { data: playersData, error: playersError } = await supabase
        .from('players')
        .select('id, name, group_name, category_id, final_position')
        .eq('tournament_id', tournamentId);

      console.log('[STANDINGS-MIXED] Players:', playersData?.length, 'Error:', playersError);

      // Fetch ALL completed matches (category_id is null for mixed matches)
      const { data: matches, error: matchesError } = await supabase
        .from('matches')
        .select('id, round, status, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id')
        .eq('tournament_id', tournamentId)
        .eq('status', 'completed');

      console.log('[STANDINGS-MIXED] Completed matches:', matches?.length, 'Error:', matchesError);

      if (!playersData || !matches) {
        setLoading(false);
        return;
      }

      // Calculate individual player stats
      const playerStatsMap = new Map<string, IndividualPlayerStats>();

      playersData.forEach(player => {
        playerStatsMap.set(player.id, {
          id: player.id,
          name: player.name,
          matchesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          gamesWon: 0,
          gamesLost: 0,
          final_position: player.final_position,
          group_name: player.group_name,
        });
      });

      matches.forEach(match => {
        const player1Id = (match as any).player1_individual_id;
        const player2Id = (match as any).player2_individual_id;
        const player3Id = (match as any).player3_individual_id;
        const player4Id = (match as any).player4_individual_id;

        const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
        const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
        const isDraw = team1Games === team2Games;

        // Team 1 players (player1 and player2)
        [player1Id, player2Id].forEach(pid => {
          if (pid && playerStatsMap.has(pid)) {
            const stats = playerStatsMap.get(pid)!;
            stats.matchesPlayed++;
            stats.gamesWon += team1Games;
            stats.gamesLost += team2Games;
            if (isDraw) stats.draws++;
            else if (team1Games > team2Games) stats.wins++;
            else stats.losses++;
          }
        });

        // Team 2 players (player3 and player4)
        [player3Id, player4Id].forEach(pid => {
          if (pid && playerStatsMap.has(pid)) {
            const stats = playerStatsMap.get(pid)!;
            stats.matchesPlayed++;
            stats.gamesWon += team2Games;
            stats.gamesLost += team1Games;
            if (isDraw) stats.draws++;
            else if (team2Games > team1Games) stats.wins++;
            else stats.losses++;
          }
        });
      });

      const playerStats = Array.from(playerStatsMap.values());

      // Sort by: 1. Wins, 2. Points (V=2, E=1, D=0), 3. Game difference, 4. Games won
      playerStats.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        const ptsA = a.wins * 2 + a.draws;
        const ptsB = b.wins * 2 + b.draws;
        if (ptsB !== ptsA) return ptsB - ptsA;
        const aDiff = a.gamesWon - a.gamesLost;
        const bDiff = b.gamesWon - b.gamesLost;
        if (bDiff !== aDiff) return bDiff - aDiff;
        return b.gamesWon - a.gamesWon;
      });

      console.log('[STANDINGS-MIXED] Setting', playerStats.length, 'players in standings');
      setIndividualPlayers(playerStats);
      setLoading(false);
      return;
    }

    // For individual round robin, fetch individual players instead of teams
    if (isIndividualRoundRobin) {
      console.log('[STANDINGS-INDIVIDUAL] Fetching individual players for tournament:', tournamentId, 'categoryId:', categoryId);
      const { data: playersData, error: playersError } = await supabase
        .from('players')
        .select('id, name, group_name, category_id, final_position')
        .eq('tournament_id', tournamentId);

      console.log('[STANDINGS-INDIVIDUAL] Players data:', playersData?.length, 'Error:', playersError);

      // Filter players by category if a category is selected
      const filteredPlayersData = categoryId
        ? (playersData || []).filter(p => p.category_id === categoryId)
        : (playersData || []);

      console.log('[STANDINGS-INDIVIDUAL] Filtered players for category:', filteredPlayersData.length);

      let matchesQuery = supabase
        .from('matches')
        .select('id, round, status, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id, category_id')
        .eq('tournament_id', tournamentId)
        .eq('status', 'completed');

      if (categoryId) {
        matchesQuery = matchesQuery.eq('category_id', categoryId);
      }

      const { data: matches, error: matchesError } = await matchesQuery;
      console.log('[STANDINGS-INDIVIDUAL] Matches:', matches?.length, 'Error:', matchesError);
      console.log('[STANDINGS-INDIVIDUAL] First match:', matches?.[0]);

      if (!filteredPlayersData || filteredPlayersData.length === 0 || !matches) {
        console.log('[STANDINGS-INDIVIDUAL] Missing data - players:', filteredPlayersData?.length, 'matches:', !!matches);
        if (!matches) {
          setLoading(false);
          return;
        }
      }

      // Calculate individual player stats - ONLY for filtered players (by category)
      const playerStatsMap = new Map<string, IndividualPlayerStats>();

      console.log('[STANDINGS-INDIVIDUAL] Players for stats:', filteredPlayersData.map(p => ({ id: p.id, name: p.name, cat: p.category_id })));

      filteredPlayersData.forEach(player => {
        playerStatsMap.set(player.id, {
          id: player.id,
          name: player.name,
          matchesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          gamesWon: 0,
          gamesLost: 0,
          final_position: player.final_position,
          group_name: player.group_name,
        });
      });

      matches.forEach((match, idx) => {
        const player1Id = (match as any).player1_individual_id;
        const player2Id = (match as any).player2_individual_id;
        const player3Id = (match as any).player3_individual_id;
        const player4Id = (match as any).player4_individual_id;

        const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
        const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
        const isDraw = team1Games === team2Games;

        console.log(`[STANDINGS-INDIVIDUAL] Match ${idx + 1}:`, {
          player1Id, player2Id, player3Id, player4Id,
          team1Games, team2Games, isDraw,
          hasPlayer1: playerStatsMap.has(player1Id),
          hasPlayer2: playerStatsMap.has(player2Id),
          hasPlayer3: playerStatsMap.has(player3Id),
          hasPlayer4: playerStatsMap.has(player4Id)
        });

        // Team 1 players (player1 and player2)
        if (player1Id && playerStatsMap.has(player1Id)) {
          const stats = playerStatsMap.get(player1Id)!;
          stats.matchesPlayed++;
          stats.gamesWon += team1Games;
          stats.gamesLost += team2Games;
          if (isDraw) stats.draws++;
          else if (team1Games > team2Games) stats.wins++;
          else stats.losses++;
        }

        if (player2Id && playerStatsMap.has(player2Id)) {
          const stats = playerStatsMap.get(player2Id)!;
          stats.matchesPlayed++;
          stats.gamesWon += team1Games;
          stats.gamesLost += team2Games;
          if (isDraw) stats.draws++;
          else if (team1Games > team2Games) stats.wins++;
          else stats.losses++;
        }

        // Team 2 players (player3 and player4)
        if (player3Id && playerStatsMap.has(player3Id)) {
          const stats = playerStatsMap.get(player3Id)!;
          stats.matchesPlayed++;
          stats.gamesWon += team2Games;
          stats.gamesLost += team1Games;
          if (isDraw) stats.draws++;
          else if (team2Games > team1Games) stats.wins++;
          else stats.losses++;
        }

        if (player4Id && playerStatsMap.has(player4Id)) {
          const stats = playerStatsMap.get(player4Id)!;
          stats.matchesPlayed++;
          stats.gamesWon += team2Games;
          stats.gamesLost += team1Games;
          if (isDraw) stats.draws++;
          else if (team2Games > team1Games) stats.wins++;
          else stats.losses++;
        }
      });

      const playerStats = Array.from(playerStatsMap.values());

      console.log('[STANDINGS-INDIVIDUAL] Final stats:', playerStats);

      // Sort by: 1. Wins, 2. Points (V=2, E=1, D=0), 3. Game difference, 4. Games won
      playerStats.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        const ptsA = a.wins * 2 + a.draws;
        const ptsB = b.wins * 2 + b.draws;
        if (ptsB !== ptsA) return ptsB - ptsA;
        const aDiff = a.gamesWon - a.gamesLost;
        const bDiff = b.gamesWon - b.gamesLost;
        if (bDiff !== aDiff) return bDiff - aDiff;
        return b.gamesWon - a.gamesWon;
      });

      console.log('[STANDINGS-INDIVIDUAL] Setting', playerStats.length, 'players in standings');
      setIndividualPlayers(playerStats);
      setLoading(false);
      return;
    }

    // Original team-based logic
    // Add a timestamp to prevent caching
    const timestamp = Date.now();
    let teamsQuery = supabase
      .from('teams')
      .select('*, player1:players!teams_player1_id_fkey(*), player2:players!teams_player2_id_fkey(*)')
      .eq('tournament_id', tournamentId);

    if (categoryId) {
      teamsQuery = teamsQuery.eq('category_id', categoryId);
    }

    const { data: teamsData, error: teamsError } = await teamsQuery;

    if (teamsError) {
      console.error('[STANDINGS] Error fetching teams:', teamsError);
    }

    if (!teamsData) {
      setLoading(false);
      return;
    }

    let matchesQuery = supabase
      .from('matches')
      .select('*')
      .eq('tournament_id', tournamentId)
      .eq('status', 'completed');

    if (categoryId) {
      matchesQuery = matchesQuery.eq('category_id', categoryId);
    }

    const { data: matches } = await matchesQuery;

    console.log('[STANDINGS] Found', matches?.length || 0, 'completed matches');

    const calculateTeamStats = (team: any, matchFilter?: (match: any) => boolean) => {
      let wins = 0;
      let draws = 0;
      let losses = 0;
      let matchesPlayed = 0;
      let setsWon = 0;
      let setsLost = 0;
      let gamesWon = 0;
      let gamesLost = 0;

      const relevantMatches = matchFilter
        ? matches?.filter(matchFilter)
        : matches;

      console.log(`[STANDINGS] Calculating stats for team ${team.name} (group: ${team.group_name}), relevant matches:`, relevantMatches?.length || 0);

      relevantMatches?.forEach((match) => {
        if (match.team1_id === team.id || match.team2_id === team.id) {
          matchesPlayed++;

          const isTeam1 = match.team1_id === team.id;

          const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
          const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);

          const team1Won = team1Games > team2Games;
          const team2Won = team2Games > team1Games;
          const isDraw = team1Games === team2Games;

          let team1SetsCount = 0;
          let team2SetsCount = 0;
          if ((match.team1_score_set1 || 0) > (match.team2_score_set1 || 0)) team1SetsCount++;
          else if ((match.team1_score_set1 || 0) < (match.team2_score_set1 || 0)) team2SetsCount++;
          if ((match.team1_score_set2 || 0) > (match.team2_score_set2 || 0)) team1SetsCount++;
          else if ((match.team1_score_set2 || 0) < (match.team2_score_set2 || 0)) team2SetsCount++;
          if ((match.team1_score_set3 || 0) > (match.team2_score_set3 || 0)) team1SetsCount++;
          else if ((match.team1_score_set3 || 0) < (match.team2_score_set3 || 0)) team2SetsCount++;

          console.log(`[STANDINGS]   Match: ${match.team1_id === team.id ? 'THIS TEAM' : match.team1_id} vs ${match.team2_id === team.id ? 'THIS TEAM' : match.team2_id}, scores: ${team1Games}-${team2Games}, sets: ${team1SetsCount}-${team2SetsCount}`);

          if (isDraw) {
            draws++;
          } else if ((isTeam1 && team1Won) || (!isTeam1 && team2Won)) {
            wins++;
          } else {
            losses++;
          }

          if (isTeam1) {
            setsWon += team1SetsCount;
            setsLost += team2SetsCount;
            gamesWon += team1Games;
            gamesLost += team2Games;
          } else {
            setsWon += team2SetsCount;
            setsLost += team1SetsCount;
            gamesWon += team2Games;
            gamesLost += team1Games;
          }
        }
      });

      console.log(`[STANDINGS]   Final stats: W:${wins} D:${draws} L:${losses} MP:${matchesPlayed} Games:${gamesWon}-${gamesLost}`);

      return { wins, draws, losses, matchesPlayed, setsWon, setsLost, gamesWon, gamesLost };
    };

    if (format === 'groups_knockout') {
      const grouped = new Map<string, TeamWithPlayers[]>();

      const teamOrderMap = new Map<string, number>();
      (teamsData as unknown as TeamWithPlayers[]).forEach((team, index) => {
        teamOrderMap.set(team.id, index);
      });

      (teamsData as unknown as TeamWithPlayers[]).forEach(team => {
        if (team.group_name) {
          if (!grouped.has(team.group_name)) {
            grouped.set(team.group_name, []);
          }
          const groupStats = calculateTeamStats(team, (match) => {
            if (match.round !== 'group_stage') return false;

            const team1 = teamsData.find(t => t.id === match.team1_id);
            const team2 = teamsData.find(t => t.id === match.team2_id);

            return team1?.group_name === team.group_name && team2?.group_name === team.group_name;
          });
          grouped.get(team.group_name)!.push({ ...team, ...groupStats });
        }
      });

      const groupStageMatches = matches?.filter(m => m.round === 'group_stage') || [];

      grouped.forEach((groupTeams, groupName) => {
        const teamStatsForSort: TeamStats[] = groupTeams.map(t => ({
          id: t.id,
          name: t.name,
          group_name: groupName,
          wins: t.wins,
          draws: t.draws,
          gamesWon: t.gamesWon,
          gamesLost: t.gamesLost
        }));

        const groupMatchData: MatchData[] = groupStageMatches
          .filter(m => groupTeams.some(t => t.id === m.team1_id) && groupTeams.some(t => t.id === m.team2_id))
          .map(m => ({
            team1_id: m.team1_id,
            team2_id: m.team2_id,
            winner_id: m.winner_id,
            team1_score_set1: m.team1_score_set1,
            team2_score_set1: m.team2_score_set1,
            team1_score_set2: m.team1_score_set2,
            team2_score_set2: m.team2_score_set2,
            team1_score_set3: m.team1_score_set3,
            team2_score_set3: m.team2_score_set3
          }));

        const sortedStats = sortTeamsByTiebreaker(teamStatsForSort, groupMatchData, teamOrderMap);
        const sortedTeams = sortedStats.map(s => groupTeams.find(t => t.id === s.id)!);
        grouped.set(groupName, sortedTeams);
      });

      setGroupedTeams(grouped);

      const knockoutTeams = (teamsData as unknown as TeamWithPlayers[])
        .filter(team => team.knockout_round)
        .map(team => {
          const stats = calculateTeamStats(team);
          return { ...team, ...stats };
        });

      knockoutTeams.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        const ptsA = a.wins * 2 + a.draws;
        const ptsB = b.wins * 2 + b.draws;
        if (ptsB !== ptsA) return ptsB - ptsA;
        const aSetDiff = a.setsWon - a.setsLost;
        const bSetDiff = b.setsWon - b.setsLost;
        if (bSetDiff !== aSetDiff) return bSetDiff - aSetDiff;
        const aGameDiff = a.gamesWon - a.gamesLost;
        const bGameDiff = b.gamesWon - b.gamesLost;
        return bGameDiff - aGameDiff;
      });

      setTeams(knockoutTeams);
    } else {
      const teamsWithStats = (teamsData as unknown as TeamWithPlayers[]).map((team) => {
        const stats = calculateTeamStats(team);
        return { ...team, ...stats };
      });

      const allHaveFinalPosition = teamsWithStats.every(t => t.final_position != null);
      if (allHaveFinalPosition) {
        teamsWithStats.sort((a, b) => (a.final_position || 999) - (b.final_position || 999));
      } else {
        const roundRobinMatches = matches?.filter(m => m.round === 'round_robin' || !m.round || m.round?.startsWith('group_')) ?? matches ?? [];
        const teamStatsForSort: TeamStats[] = teamsWithStats.map(t => ({
          id: t.id,
          name: t.name,
          group_name: t.group_name || 'Geral',
          wins: t.wins,
          draws: t.draws,
          gamesWon: t.gamesWon,
          gamesLost: t.gamesLost,
          created_at: t.created_at
        }));
        const matchDataForSort: MatchData[] = (roundRobinMatches).map(m => ({
          team1_id: m.team1_id,
          team2_id: m.team2_id,
          team1_score_set1: m.team1_score_set1,
          team2_score_set1: m.team2_score_set1,
          team1_score_set2: m.team1_score_set2,
          team2_score_set2: m.team2_score_set2,
          team1_score_set3: m.team1_score_set3,
          team2_score_set3: m.team2_score_set3
        }));
        const teamOrderMap = new Map(teamsWithStats.map((t, i) => [t.id, i]));
        const sortedStats = sortTeamsByTiebreaker(teamStatsForSort, matchDataForSort, teamOrderMap);
        const sortedTeams = sortedStats.map(s => teamsWithStats.find(t => t.id === s.id)!);
        setTeams(sortedTeams);
        setLoading(false);
        return;
      }

      setTeams(teamsWithStats);
    }

    setLoading(false);
  };

  const getMedalIcon = (position: number) => {
    if (position === 1) return <Trophy className="w-5 h-5 text-yellow-500" />;
    if (position === 2) return <Medal className="w-5 h-5 text-gray-400" />;
    if (position === 3) return <Award className="w-5 h-5 text-amber-600" />;
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (format === 'groups_knockout' && groupedTeams.size === 0 && teams.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
        <Trophy className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">{t.standings.noTeams}</h3>
        <p className="text-gray-500">{t.standings.addTeams}</p>
      </div>
    );
  }

  if (format !== 'groups_knockout' && teams.length === 0 && !isIndividualRoundRobin && !isIndividualGroupsKnockout) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
        <Trophy className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">{t.standings.noTeams}</h3>
        <p className="text-gray-500">{t.standings.addTeams}</p>
      </div>
    );
  }

  // Individual groups knockout standings
  if (isIndividualGroupsKnockout) {
    if (groupedTeams.size === 0) {
      return (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Trophy className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{t.standings.noPlayers}</h3>
          <p className="text-gray-500">{t.standings.addPlayers}</p>
        </div>
      );
    }

    const sortedGroups = Array.from(groupedTeams.keys()).sort();

    return (
      <div className="space-y-6">
        {individualFinalRankings.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-yellow-500 to-yellow-600">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <Trophy className="w-6 h-6" />
                Classificacao Individual Final
              </h2>
              <p className="text-yellow-100 text-sm mt-1">
                Ordenado por desempenho na fase de grupos
              </p>
            </div>
            <div className="p-6">
              <div className="grid gap-2">
                {individualFinalRankings.map((ranking) => {
                  const position = ranking.position;
                  const isPending = ranking.status === 'pending';
                  const gameDiff = ranking.groupStats.gamesWon - ranking.groupStats.gamesLost;

                  return (
                    <div
                      key={`pos-${position}-${ranking.player.id}`}
                      className={`flex items-center gap-4 p-3 rounded-lg border-2 ${
                        isPending
                          ? 'bg-blue-50 border-blue-200'
                          : position === 1
                          ? 'bg-yellow-50 border-yellow-400'
                          : position === 2
                          ? 'bg-gray-100 border-gray-400'
                          : position === 3
                          ? 'bg-amber-50 border-amber-500'
                          : position === 4
                          ? 'bg-amber-50/50 border-amber-300'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-[60px]">
                        {!isPending && getMedalIcon(position)}
                        <span className={`text-xl font-bold ${isPending ? 'text-blue-600' : 'text-gray-900'}`}>
                          {isPending ? '?' : `${position}`}º
                        </span>
                      </div>
                      <div className="flex-1">
                        <span className="text-base font-semibold text-gray-900">
                          {ranking.player.name}
                        </span>
                      </div>
                      <div className="text-right text-sm">
                        <span className="text-gray-600">
                          Grupos: {ranking.groupStats.wins}V |{' '}
                          <span className={gameDiff > 0 ? 'text-green-600' : gameDiff < 0 ? 'text-red-600' : 'text-gray-500'}>
                            {gameDiff > 0 ? '+' : ''}{gameDiff}
                          </span>
                        </span>
                      </div>
                      {isPending && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                          A disputar
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {knockoutRankings.length > 0 && individualFinalRankings.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-yellow-500 to-yellow-600">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <Trophy className="w-6 h-6" />
                {t.standings.finalRankings || 'Knockout Rankings'}
              </h2>
            </div>
            <div className="p-6">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {knockoutRankings.map((ranking) => {
                  const position = ranking.position;
                  const isPending = ranking.status === 'pending';
                  return (
                    <div
                      key={`pos-${position}`}
                      className={`flex items-center gap-3 p-4 rounded-lg border-2 ${
                        isPending
                          ? 'bg-blue-50 border-blue-300'
                          : position === 1
                          ? 'bg-yellow-50 border-yellow-400'
                          : position === 2
                          ? 'bg-gray-50 border-gray-400'
                          : position === 3
                          ? 'bg-amber-50 border-amber-600'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {!isPending && getMedalIcon(position)}
                        <span className="text-2xl font-bold text-gray-900">
                          {isPending ? (position === 1 ? '1-2' : '3-4') : `${position}`}º
                        </span>
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-wrap gap-1">
                          {ranking.players.map((player, idx) => (
                            <span key={player.id} className="text-sm font-semibold text-gray-900">
                              {player.name}{idx < ranking.players.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </div>
                        {isPending && (
                          <p className="text-xs text-blue-600 mt-1">
                            {ranking.matchType === 'final' ? 'Finalistas' : 'A disputar 3º/4º'}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-700">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Trophy className="w-6 h-6" />
              {t.standings.groupStageStandings}
            </h2>
          </div>

          <div className="p-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sortedGroups.map(groupName => {
              const groupPlayers = groupedTeams.get(groupName) as any as IndividualPlayerStats[];
              return (
                <div key={groupName} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <h3 className="font-semibold text-gray-900 mb-3">{t.standings.groupStandings} {groupName}</h3>
                  <div className="space-y-2">
                    {groupPlayers.map((player, idx) => {
                      const rank = idx + 1;
                      const isQualified = rank <= qualifiedPerGroup;
                      const gameDiff = player.gamesWon - player.gamesLost;

                      return (
                        <div
                          key={player.id}
                          className={`flex items-center justify-between p-2 rounded ${
                            isQualified
                              ? 'bg-green-100 border border-green-300'
                              : 'bg-white border border-gray-200'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-700 w-5">
                              {rank}
                            </span>
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {player.name}
                              </p>
                              <p className="text-xs text-gray-600">
                                {player.wins}V {player.draws}E {player.losses}D | {player.gamesWon}-{player.gamesLost} <span className={gameDiff > 0 ? 'text-green-600' : gameDiff < 0 ? 'text-red-600' : ''}>{gameDiff > 0 ? '+' : ''}{gameDiff}</span>
                              </p>
                            </div>
                          </div>
                          {isQualified && (
                            <span className="text-xs font-medium text-green-700 bg-green-200 px-2 py-1 rounded">
                              Q
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Mixed American (Americano Misto) standings - all players in one table
  if (isMixedAmerican) {
    if (individualPlayers.length === 0) {
      return (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Trophy className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{t.standings.noPlayers}</h3>
          <p className="text-gray-500">{t.standings.addPlayers}</p>
        </div>
      );
    }

    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-pink-500 to-rose-600">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            Classificação - Americano Misto
          </h2>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="pl-3 pr-1 py-2 text-left text-xs font-medium text-gray-500 w-8">#</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">Jogador</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">J</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">V</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">E</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">D</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">JG</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">JP</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">+/-</th>
              <th className="pl-1 pr-3 py-2 text-center text-xs font-semibold text-gray-600 w-8">Pts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {individualPlayers.map((player, index) => {
              const gameDiff = player.gamesWon - player.gamesLost;
              const pts = player.wins * 2 + player.draws;
              return (
                <tr key={player.id} className={index < 3 ? 'bg-pink-50/30' : ''}>
                  <td className="pl-3 pr-1 py-2">
                    <div className="flex items-center gap-1">
                      {getMedalIcon(index + 1)}
                      <span className="font-bold text-gray-700">{index + 1}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 font-medium text-gray-900">{player.name}</td>
                  <td className="px-1 py-2 text-center text-gray-600">{player.matchesPlayed}</td>
                  <td className="px-1 py-2 text-center font-semibold text-green-600">{player.wins}</td>
                  <td className="px-1 py-2 text-center text-yellow-600">{player.draws}</td>
                  <td className="px-1 py-2 text-center text-red-500">{player.losses}</td>
                  <td className="px-1 py-2 text-center text-xs text-gray-700">{player.gamesWon}</td>
                  <td className="px-1 py-2 text-center text-xs text-gray-700">{player.gamesLost}</td>
                  <td className={`px-1 py-2 text-center text-xs ${gameDiff > 0 ? 'text-green-600' : gameDiff < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    {gameDiff > 0 ? '+' : ''}{gameDiff}
                  </td>
                  <td className="pl-1 pr-3 py-2 text-center font-bold">{pts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
          <p className="text-xs text-gray-500">
            <strong>Critérios:</strong> 1. Vitórias, 2. Pontos (V=2, E=1), 3. Diferença de jogos (+/-), 4. Jogos ganhos
          </p>
        </div>
      </div>
    );
  }

  // Individual round robin standings
  if (isIndividualRoundRobin) {
    if (individualPlayers.length === 0) {
      return (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Trophy className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{t.standings.noPlayers}</h3>
          <p className="text-gray-500">{t.standings.addPlayers}</p>
        </div>
      );
    }

    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            {t.standings.individualTitle}
          </h2>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="pl-3 pr-1 py-2 text-left text-xs font-medium text-gray-500 w-8">#</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">Jogador</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">V</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">E</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">D</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">JG</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">JP</th>
              <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">+/-</th>
              <th className="pl-1 pr-3 py-2 text-center text-xs font-semibold text-gray-600 w-8">Pts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {individualPlayers.map((player, index) => {
              const gameDiff = player.gamesWon - player.gamesLost;
              const pts = player.wins * 2 + player.draws;
              return (
                <tr key={player.id} className={index < 3 ? 'bg-blue-50/30' : ''}>
                  <td className="pl-3 pr-1 py-2">
                    <div className="flex items-center gap-1">
                      {getMedalIcon(index + 1)}
                      <span className="font-bold text-gray-700">{index + 1}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 font-medium text-gray-900">{player.name}</td>
                  <td className="px-1 py-2 text-center font-semibold text-green-600">{player.wins}</td>
                  <td className="px-1 py-2 text-center text-yellow-600">{player.draws}</td>
                  <td className="px-1 py-2 text-center text-red-500">{player.losses}</td>
                  <td className="px-1 py-2 text-center text-xs text-gray-700">{player.gamesWon}</td>
                  <td className="px-1 py-2 text-center text-xs text-gray-700">{player.gamesLost}</td>
                  <td className={`px-1 py-2 text-center text-xs ${gameDiff > 0 ? 'text-green-600' : gameDiff < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    {gameDiff > 0 ? '+' : ''}{gameDiff}
                  </td>
                  <td className="pl-1 pr-3 py-2 text-center font-bold">{pts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
          <p className="text-xs text-gray-500">
            <strong>Critérios:</strong> 1. Vitórias, 2. Pontos (V=2, E=1), 3. Confronto direto, 4. Diferença de jogos (+/-), 5. Jogos ganhos
          </p>
        </div>
      </div>
    );
  }

  if (format === 'groups_knockout') {
    const sortedGroups = Array.from(groupedTeams.keys()).sort();

    return (
      <div className="space-y-4">
        {sortedGroups.map(groupName => {
          const groupTeams = groupedTeams.get(groupName)!;
          return (
            <div key={groupName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-green-600 to-green-700">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Trophy className="w-5 h-5" />
                  Grupo {groupName}
                </h2>
              </div>

              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="pl-3 pr-1 py-2 text-left text-xs font-medium text-gray-500 w-8">#</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">Equipa</th>
                    <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">V</th>
                    <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">E</th>
                    <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">D</th>
                    <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">JG</th>
                    <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">JP</th>
                    <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">+/-</th>
                    <th className="pl-1 pr-3 py-2 text-center text-xs font-semibold text-gray-600 w-8">Pts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {groupTeams.map((team, index) => {
                    const gameDiff = team.gamesWon - team.gamesLost;
                    const pts = team.wins * 2 + team.draws;
                    return (
                      <tr key={team.id} className={index < 2 ? 'bg-green-50/30' : ''}>
                        <td className="pl-3 pr-1 py-2 font-bold text-gray-700">{index + 1}</td>
                        <td className="px-2 py-2">
                          <div className="font-medium text-gray-900 leading-tight">{team.name}</div>
                          <div className="text-xs text-gray-500 leading-tight">{team.player1.name} / {team.player2.name}</div>
                        </td>
                        <td className="px-1 py-2 text-center font-semibold text-green-600">{team.wins}</td>
                        <td className="px-1 py-2 text-center text-yellow-600">{team.draws}</td>
                        <td className="px-1 py-2 text-center text-red-500">{team.losses}</td>
                        <td className="px-1 py-2 text-center text-xs text-gray-700">{team.gamesWon}</td>
                        <td className="px-1 py-2 text-center text-xs text-gray-700">{team.gamesLost}</td>
                        <td className={`px-1 py-2 text-center text-xs ${gameDiff > 0 ? 'text-green-600' : gameDiff < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                          {gameDiff > 0 ? '+' : ''}{gameDiff}
                        </td>
                        <td className="pl-1 pr-3 py-2 text-center font-bold">{pts}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
                <p className="text-xs text-gray-500"><strong>Critérios:</strong> 1. Vitórias, 2. Pontos (V=2, E=1), 3. Confronto direto, 4. Diferença de jogos (+/-), 5. Jogos ganhos</p>
              </div>
            </div>
          );
        })}

        {teams.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Trophy className="w-5 h-5" />
                Fase Eliminatória
              </h2>
            </div>

            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="pl-3 pr-1 py-2 text-left text-xs font-medium text-gray-500 w-8">#</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">Equipa</th>
                  <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">V</th>
                  <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">E</th>
                  <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">D</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {teams.map((team, index) => (
                  <tr key={team.id} className={index < 3 ? 'bg-blue-50/30' : ''}>
                    <td className="pl-3 pr-1 py-2">
                      <div className="flex items-center gap-1">
                        {getMedalIcon(index + 1)}
                        <span className="font-bold text-gray-700">{index + 1}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="font-medium text-gray-900 leading-tight">{team.name}</div>
                      <div className="text-xs text-gray-500 leading-tight">{team.player1.name} / {team.player2.name}</div>
                    </td>
                    <td className="px-1 py-2 text-center font-semibold text-green-600">{team.wins}</td>
                    <td className="px-1 py-2 text-center text-yellow-600">{team.draws}</td>
                    <td className="px-1 py-2 text-center text-red-500">{team.losses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Trophy className="w-5 h-5" />
          Classificação
        </h2>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="pl-3 pr-1 py-2 text-left text-xs font-medium text-gray-500 w-8">#</th>
            <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">Equipa</th>
            <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">V</th>
            <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">E</th>
            <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-7">D</th>
            <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">JG</th>
            <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">JP</th>
            <th className="px-1 py-2 text-center text-xs font-medium text-gray-500 w-9">+/-</th>
            <th className="pl-1 pr-3 py-2 text-center text-xs font-semibold text-gray-600 w-8">Pts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {teams.map((team, index) => {
            const gameDiff = team.gamesWon - team.gamesLost;
            const pts = team.wins * 2 + team.draws;
            return (
              <tr key={team.id} className={index < 3 ? 'bg-blue-50/30' : ''}>
                <td className="pl-3 pr-1 py-2">
                  <div className="flex items-center gap-1">
                    {getMedalIcon(index + 1)}
                    <span className="font-bold text-gray-700">{index + 1}</span>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <div className="font-medium text-gray-900 leading-tight">{team.name}</div>
                  <div className="text-xs text-gray-500 leading-tight">{team.player1.name} / {team.player2.name}</div>
                </td>
                <td className="px-1 py-2 text-center font-semibold text-green-600">{team.wins}</td>
                <td className="px-1 py-2 text-center text-yellow-600">{team.draws}</td>
                <td className="px-1 py-2 text-center text-red-500">{team.losses}</td>
                <td className="px-1 py-2 text-center text-xs text-gray-700">{team.gamesWon}</td>
                <td className="px-1 py-2 text-center text-xs text-gray-700">{team.gamesLost}</td>
                <td className={`px-1 py-2 text-center text-xs ${gameDiff > 0 ? 'text-green-600' : gameDiff < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                  {gameDiff > 0 ? '+' : ''}{gameDiff}
                </td>
                <td className="pl-1 pr-3 py-2 text-center font-bold">{pts}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          <strong>Critérios:</strong> 1. Vitórias, 2. Pontos (V=2, E=1), 3. Confronto direto, 4. Diferença de jogos (+/-), 5. Jogos ganhos
        </p>
      </div>
    </div>
  );
}
