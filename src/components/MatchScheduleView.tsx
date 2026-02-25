import { useState, useRef } from 'react';
import { Match, Team, Player, IndividualPlayer, TournamentCategory } from '../lib/supabase';
import { ArrowUpDown, Printer, Calendar, Users, Clock, Edit2 } from 'lucide-react';
import { useI18n } from '../lib/i18nContext';
import EditMatchScheduleModal from './EditMatchScheduleModal';

type TeamWithPlayers = Team & {
  player1: Player;
  player2: Player;
};

type MatchWithTeams = Match & {
  team1: TeamWithPlayers | null;
  team2: TeamWithPlayers | null;
};

type SortOption = 'time' | 'court' | 'group';

type MatchScheduleViewProps = {
  matches: MatchWithTeams[];
  isIndividualRoundRobin: boolean;
  individualPlayers: IndividualPlayer[];
  onMatchClick: (matchId: string) => void;
  categories?: TournamentCategory[];
  showCategoryLabels?: boolean;
  printTitle?: string;
  onScheduleUpdate?: () => void;
};

export default function MatchScheduleView({
  matches,
  isIndividualRoundRobin,
  individualPlayers,
  onMatchClick,
  categories = [],
  showCategoryLabels = false,
  printTitle,
  onScheduleUpdate,
}: MatchScheduleViewProps) {
  const { t } = useI18n();
  const [sortBy, setSortBy] = useState<SortOption>('time');
  const printAreaRef = useRef<HTMLDivElement>(null);
  const [editingMatch, setEditingMatch] = useState<{ id: string; scheduledTime: string; court: string } | null>(null);

  const getCategoryColor = (categoryId: string): string => {
    const categoryColors: { [key: string]: string } = {};
    const colors = [
      '#3B82F6',
      '#10B981',
      '#F59E0B',
      '#EF4444',
      '#8B5CF6',
      '#EC4899',
      '#14B8A6',
      '#F97316',
      '#6366F1',
      '#84CC16'
    ];

    categories.forEach((cat, idx) => {
      categoryColors[cat.id] = colors[idx % colors.length];
    });

    return categoryColors[categoryId] || '#6B7280';
  };

  const getPlayerName = (playerId: string | null): string => {
    if (!playerId) return 'TBD';
    const player = individualPlayers.find(p => p.id === playerId);
    return player?.name || 'TBD';
  };

  const getMatchScore = (match: MatchWithTeams): string => {
    if (match.status !== 'completed') return '-';
    const team1Total = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
    const team2Total = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
    return `${team1Total} - ${team2Total}`;
  };

  const sortMatches = (matchesToSort: MatchWithTeams[]): MatchWithTeams[] => {
    const sorted = [...matchesToSort];

    switch (sortBy) {
      case 'time':
        return sorted.sort((a, b) =>
          new Date(a.scheduled_time || 0).getTime() - new Date(b.scheduled_time || 0).getTime()
        );
      case 'court':
        return sorted.sort((a, b) => {
          const courtA = parseInt(a.court || '0');
          const courtB = parseInt(b.court || '0');
          if (courtA !== courtB) return courtA - courtB;
          return new Date(a.scheduled_time || 0).getTime() - new Date(b.scheduled_time || 0).getTime();
        });
      case 'group':
        return sorted.sort((a, b) => {
          const getGroupName = (match: MatchWithTeams) => {
            if (match.team1?.group_name) return match.team1.group_name;
            if (match.round.startsWith('group_')) return match.round.replace('group_', '');
            return 'No Group';
          };
          const groupA = getGroupName(a);
          const groupB = getGroupName(b);
          if (groupA !== groupB) return groupA.localeCompare(groupB);
          return a.match_number - b.match_number;
        });
      default:
        return sorted;
    }
  };

  const groupMatchesByCourt = (matchesToGroup: MatchWithTeams[]) => {
    const grouped = new Map<string, MatchWithTeams[]>();
    matchesToGroup.forEach(match => {
      const court = match.court || 'No Court';
      if (!grouped.has(court)) {
        grouped.set(court, []);
      }
      grouped.get(court)!.push(match);
    });

    const sortedCourts = Array.from(grouped.keys()).sort((a, b) => {
      if (a === 'No Court') return 1;
      if (b === 'No Court') return -1;
      return parseInt(a) - parseInt(b);
    });

    return sortedCourts.map(court => ({
      court,
      matches: grouped.get(court)!.sort((a, b) =>
        new Date(a.scheduled_time || 0).getTime() - new Date(b.scheduled_time || 0).getTime()
      )
    }));
  };

  const groupMatchesByGroup = (matchesToGroup: MatchWithTeams[]) => {
    const grouped = new Map<string, MatchWithTeams[]>();
    matchesToGroup.forEach(match => {
      let groupName = 'No Group';
      if (match.team1?.group_name) {
        groupName = `Group ${match.team1.group_name}`;
      } else if (match.round.startsWith('group_')) {
        groupName = `Group ${match.round.replace('group_', '')}`;
      }
      if (!grouped.has(groupName)) {
        grouped.set(groupName, []);
      }
      grouped.get(groupName)!.push(match);
    });

    const sortedGroups = Array.from(grouped.keys()).sort((a, b) => {
      const matchesA = grouped.get(a)!;
      const matchesB = grouped.get(b)!;
      const firstTimeA = matchesA.reduce((min, m) => {
        if (!m.scheduled_time) return min;
        return min ? (m.scheduled_time < min ? m.scheduled_time : min) : m.scheduled_time;
      }, null as string | null);
      const firstTimeB = matchesB.reduce((min, m) => {
        if (!m.scheduled_time) return min;
        return min ? (m.scheduled_time < min ? m.scheduled_time : min) : m.scheduled_time;
      }, null as string | null);
      if (!firstTimeA && !firstTimeB) return a.localeCompare(b);
      if (!firstTimeA) return 1;
      if (!firstTimeB) return -1;
      return firstTimeA.localeCompare(firstTimeB);
    });
    return sortedGroups.map(groupName => ({
      group: groupName,
      matches: grouped.get(groupName)!.sort((a, b) => {
        if (a.scheduled_time && b.scheduled_time) {
          return a.scheduled_time.localeCompare(b.scheduled_time);
        }
        return a.match_number - b.match_number;
      })
    }));
  };

  const groupMatchesByDay = (matchesToGroup: MatchWithTeams[]) => {
    const grouped = new Map<string, MatchWithTeams[]>();
    matchesToGroup.forEach(match => {
      if (!match.scheduled_time) {
        const key = 'Not Scheduled';
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(match);
        return;
      }

      const date = new Date(match.scheduled_time);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      const dayKey = `${day}-${month}-${year}`;

      if (!grouped.has(dayKey)) {
        grouped.set(dayKey, []);
      }
      grouped.get(dayKey)!.push(match);
    });

    const sortedDays = Array.from(grouped.keys()).sort((a, b) => {
      if (a === 'Not Scheduled') return 1;
      if (b === 'Not Scheduled') return -1;
      const dateA = grouped.get(a)![0].scheduled_time;
      const dateB = grouped.get(b)![0].scheduled_time;
      return new Date(dateA || 0).getTime() - new Date(dateB || 0).getTime();
    });

    return sortedDays.map(day => ({
      day,
      matches: grouped.get(day)!.sort((a, b) =>
        new Date(a.scheduled_time || 0).getTime() - new Date(b.scheduled_time || 0).getTime()
      )
    }));
  };

  const groupMatchesByPhase = (matchesToGroup: MatchWithTeams[]) => {
    const groupStage: MatchWithTeams[] = [];
    const knockoutStage: MatchWithTeams[] = [];

    matchesToGroup.forEach(match => {
      // Check if this is a group stage match
      const isGroupStage = match.round.startsWith('group_') || match.team1?.group_name;

      if (isGroupStage) {
        groupStage.push(match);
      } else {
        knockoutStage.push(match);
      }
    });

    return { groupStage, knockoutStage };
  };

  const getKnockoutRoundLabel = (round: string): string => {
    const roundLabels: { [key: string]: string } = {
      'final': t.bracket?.final || 'Final',
      'semi_final': t.bracket?.semiFinal || 'Semi-Final',
      'semifinal': t.bracket?.semiFinal || 'Semi-Final',
      'quarterfinal': t.bracket?.quarterFinal || 'Quarter-Final',
      'quarter_final': t.bracket?.quarterFinal || 'Quarter-Final',
      'consolation': 'Consolation',
      'round_16': t.bracket?.round16 || 'Round of 16',
      'round_32': t.bracket?.round32 || 'Round of 32',
      '1st_semifinal': 'Semi-Final (1-4)',
      '3rd_place': '3rd/4th Place',
      '5th_semifinal': 'Semi-Final (5-8)',
      '5th_place': '5th/6th Place',
      '7th_place': '7th/8th Place',
      '9th_semifinal': 'Semi-Final (9-12)',
      '9th_place': '9th/10th Place',
      '11th_place': '11th/12th Place',
      '13th_semifinal': 'Semi-Final (13-16)',
      '13th_place': '13th/14th Place',
      '15th_place': '15th/16th Place',
      '17th_semifinal': 'Semi-Final (17-20)',
      '17th_place': '17th/18th Place',
      '19th_place': '19th/20th Place',
      '21st_semifinal': 'Semi-Final (21-24)',
      '21st_place': '21st/22nd Place',
      '23rd_place': '23rd/24th Place',
      // Playoffs Cruzados
      'crossed_r1_j1': 'Playoff J1',
      'crossed_r1_j2': 'Playoff J2',
      'crossed_r1_j3': 'Playoff J3',
      'crossed_r2_j4': 'Meia-Final 1',
      'crossed_r2_j5': 'Meia-Final 2',
      'crossed_r2_j6': '5°/6° Lugar',
      'crossed_r3_j7': 'FINAL',
      'crossed_r3_j8': '3°/4° Lugar',
    };
    return roundLabels[round] || round;
  };

  const handlePrint = () => {
    const printContent = printAreaRef.current;
    if (!printContent) {
      alert('Print content not found');
      return;
    }
    const title = printTitle || t.match.schedule;

    // Remove any existing print iframe
    const existingIframe = document.getElementById('print-iframe');
    if (existingIframe) {
      existingIframe.remove();
    }

    // Create iframe for printing
    const iframe = document.createElement('iframe');
    iframe.id = 'print-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentWindow?.document;
    if (!iframeDoc) {
      alert('Failed to create print preview');
      return;
    }

    iframeDoc.open();
    iframeDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              padding: 25px;
              font-size: 11px;
              line-height: 1.5;
              color: #1f2937;
              background: white;
            }
            h1 {
              font-size: 28px;
              font-weight: 700;
              margin-bottom: 8px;
              color: #111827;
              letter-spacing: -0.5px;
            }
            .subtitle {
              font-size: 13px;
              color: #6b7280;
              margin-bottom: 25px;
              padding-bottom: 15px;
              border-bottom: 2px solid #e5e7eb;
            }
            .space-y-6 {
              display: flex;
              flex-direction: column;
              gap: 20px;
            }
            .bg-white {
              background: white;
              border: 1.5px solid #d1d5db;
              border-radius: 8px;
              padding: 15px;
              page-break-inside: avoid;
            }
            h4 {
              font-size: 18px;
              font-weight: 700;
              margin-bottom: 12px;
              padding-bottom: 8px;
              border-bottom: 2px solid #9ca3af;
              color: #111827;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .space-y-2 {
              display: flex;
              flex-direction: column;
              gap: 10px;
            }
            .bg-gray-50 {
              background: #f9fafb;
              border: 1px solid #e5e7eb;
              border-radius: 6px;
              padding: 12px;
            }
            button {
              border-left-width: 4px !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .flex {
              display: flex;
            }
            .justify-between {
              justify-content: space-between;
            }
            .items-center {
              align-items: center;
            }
            .items-start {
              align-items: flex-start;
            }
            .gap-3 {
              gap: 12px;
            }
            .gap-2 {
              gap: 8px;
            }
            .text-sm {
              font-size: 11px;
            }
            .font-semibold {
              font-weight: 600;
            }
            .font-medium {
              font-weight: 500;
            }
            .text-gray-900 {
              color: #111827;
            }
            .text-gray-700 {
              color: #374151;
            }
            .text-gray-600 {
              color: #4b5563;
            }
            .text-gray-500 {
              color: #6b7280;
            }
            .bg-blue-50 {
              background: #eff6ff;
              padding: 6px 10px;
              border-radius: 4px;
              border: 1px solid #dbeafe;
            }
            .text-blue-700 {
              color: #1d4ed8;
              font-weight: 600;
            }
            .bg-purple-50 {
              background: #faf5ff;
              padding: 6px 10px;
              border-radius: 4px;
              border: 1px solid #e9d5ff;
            }
            .text-purple-700 {
              color: #7e22ce;
              font-weight: 600;
            }
            .bg-green-100 {
              background: #d1fae5;
              padding: 3px 8px;
              border-radius: 3px;
              font-size: 10px;
              font-weight: 600;
            }
            .text-green-800 {
              color: #065f46;
            }
            .bg-blue-100 {
              background: #dbeafe;
              padding: 3px 8px;
              border-radius: 3px;
              font-size: 10px;
              font-weight: 600;
            }
            .text-blue-800 {
              color: #1e40af;
            }
            .mt-2 {
              margin-top: 8px;
            }
            .text-xs {
              font-size: 10px;
            }
            .hidden {
              display: none;
            }
            .print\\:block {
              display: block !important;
            }
            .print-only {
              display: block !important;
            }
            .mb-6 {
              margin-bottom: 24px;
            }
            .mb-2 {
              margin-bottom: 8px;
            }
            .mb-4 {
              margin-bottom: 16px;
            }
            .mb-1 {
              margin-bottom: 4px;
            }
            .mb-8 {
              margin-bottom: 32px;
            }
            h3 {
              font-size: 20px;
              font-weight: 700;
              color: #111827;
              margin-bottom: 16px;
              display: block !important;
            }
            .text-xl {
              font-size: 18px;
            }
            .print\\:hidden {
              display: none !important;
            }
            button {
              all: unset;
              display: block;
              width: 100%;
              cursor: default;
            }
            .w-full {
              width: 100%;
            }
            .border {
              border-width: 1px;
            }
            .border-gray-200 {
              border-color: #e5e7eb;
            }
            .border-gray-300 {
              border-color: #d1d5db;
            }
            .rounded-lg, .rounded {
              border-radius: 6px;
            }
            .rounded-xl {
              border-radius: 12px;
            }
            .p-3 {
              padding: 12px;
            }
            .p-4 {
              padding: 16px;
            }
            .p-2 {
              padding: 8px;
            }
            .text-left {
              text-align: left;
            }
            .text-center {
              text-align: center;
            }
            .text-right {
              text-align: right;
            }
            .print\\:break-inside-avoid {
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .grid {
              display: grid;
            }
            .grid-cols-3 {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
            .my-2 {
              margin-top: 8px;
              margin-bottom: 8px;
            }
            .my-1 {
              margin-top: 4px;
              margin-bottom: 4px;
            }
            .space-y-1 > * + * {
              margin-top: 4px;
            }
            .ml-2 {
              margin-left: 8px;
            }
            .ml-1 {
              margin-left: 4px;
            }
            .px-2 {
              padding-left: 8px;
              padding-right: 8px;
            }
            .px-1\\.5 {
              padding-left: 6px;
              padding-right: 6px;
            }
            .py-0\\.5 {
              padding-top: 2px;
              padding-bottom: 2px;
            }
            .text-base {
              font-size: 14px;
            }
            .font-bold {
              font-weight: 700;
            }
            .text-gray-400 {
              color: #9ca3af;
            }
            .bg-gray-100 {
              background: #f3f4f6;
            }
            .text-gray-800 {
              color: #1f2937;
            }
            .w-3 {
              width: 12px;
            }
            .h-3 {
              height: 12px;
            }
            .print\\:w-3 {
              width: 12px;
            }
            .print\\:h-3 {
              height: 12px;
            }
            .print\\:text-xl {
              font-size: 20px !important;
            }
            .print\\:border-b {
              border-bottom-width: 1px !important;
            }
            .print\\:border-gray-400 {
              border-bottom-color: #9ca3af !important;
            }
            .print\\:pb-2 {
              padding-bottom: 8px !important;
            }
            .print\\:mb-6 {
              margin-bottom: 24px !important;
            }
            .print\\:mb-2 {
              margin-bottom: 8px !important;
            }
            .print\\:mb-1 {
              margin-bottom: 4px !important;
            }
            .print\\:mt-1 {
              margin-top: 4px !important;
            }
            .print\\:pt-1 {
              padding-top: 4px !important;
            }
            .print\\:border-t {
              border-top-width: 1px !important;
            }
            .print\\:font-semibold {
              font-weight: 600 !important;
            }
            .print\\:font-bold {
              font-weight: 700 !important;
            }
            svg {
              display: none !important;
            }
            @page {
              size: A4;
              margin: 15mm;
            }
            @media print {
              body {
                padding: 0;
              }
            }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);
    iframeDoc.close();

    // Wait for content to load then print
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();

      // Remove iframe after printing
      setTimeout(() => {
        iframe.remove();
      }, 100);
    }, 250);
  };

  const sortedMatches = sortMatches(matches);

  const getGroupLabel = (match: MatchWithTeams): string => {
    if (match.team1?.group_name) return `Group ${match.team1.group_name}`;
    if (match.round.startsWith('group_') && match.round !== 'group_stage') {
      return `Group ${match.round.replace('group_', '')}`;
    }
    return '';
  };

  const getCategoryLabel = (match: MatchWithTeams): string => {
    if (!showCategoryLabels || categories.length === 0) return '';
    const category = categories.find(c => c.id === match.category_id);
    return category?.name || '';
  };

  const getRoundLabel = (match: MatchWithTeams): string | null => {
    const round = match.round;
    // Check if it's a knockout round
    if (round.startsWith('group_') || round === 'round_robin') return null;
    
    const roundLabels: { [key: string]: string } = {
      'final': 'Final',
      'semi_final': 'Meia-Final',
      'semifinal': 'Meia-Final',
      'quarterfinal': 'Quartos',
      'quarter_final': 'Quartos',
      'consolation': 'Consolação',
      'round_16': 'Oitavos',
      'round_32': '1/16 Final',
      '1st_semifinal': 'Meia-Final (1-4)',
      '3rd_place': '3°/4° Lugar',
      '5th_semifinal': 'Meia-Final (5-8)',
      '5th_place': '5°/6° Lugar',
      '7th_place': '7°/8° Lugar',
      // Playoffs Cruzados - Ronda 1
      'crossed_r1_j1': 'Playoff J1',
      'crossed_r1_j2': 'Playoff J2',
      'crossed_r1_j3': 'Playoff J3',
      // Playoffs Cruzados - Ronda 2 (Meias-finais + 5º/6º)
      'crossed_r2_j4': 'Meia-Final 1',
      'crossed_r2_j5': 'Meia-Final 2',
      'crossed_r2_j6': '5°/6° Lugar',
      // Playoffs Cruzados - Ronda 3 (Finais)
      'crossed_r3_j7': 'FINAL',
      'crossed_r3_j8': '3°/4° Lugar',
      // Nomes antigos (compatibilidade)
      'crossed_r2_semifinal1': 'Meia-Final 1',
      'crossed_r2_semifinal2': 'Meia-Final 2',
      'crossed_r2_5th_place': '5°/6° Lugar',
      'crossed_r3_final': 'FINAL',
      'crossed_r3_3rd_place': '3°/4° Lugar',
    };
    return roundLabels[round] || null;
  };

  const renderMatch = (match: MatchWithTeams, showCourt: boolean = true, showGroup: boolean = true) => {
    const groupLabel = getGroupLabel(match);
    const categoryLabel = getCategoryLabel(match);
    const categoryColor = match.category_id ? getCategoryColor(match.category_id) : '#6B7280';
    const roundLabel = getRoundLabel(match);
    
    // Create lighter background color from category color
    const bgColor = match.category_id ? `${categoryColor}15` : '#f9fafb';

    return (
      <div key={match.id} className="relative">
        <div
          onClick={() => onMatchClick(match.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onMatchClick(match.id); }}
          className="w-full border-2 rounded-lg p-3 hover:shadow-lg transition-shadow text-left print:break-inside-avoid print:border print:border-gray-300 print:rounded print:p-2 print:mb-2 relative cursor-pointer"
          style={{ 
            borderColor: categoryColor,
            backgroundColor: bgColor
          }}
        >
          {/* Header: Match number + Status + Edit button */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-gray-700">
              Jogo #{match.match_number}
              {roundLabel && (
                <span className="ml-2 px-2 py-0.5 bg-orange-100 text-orange-800 rounded font-semibold">
                  {roundLabel}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  match.status === 'completed'
                    ? 'bg-green-100 text-green-800'
                    : match.status === 'in_progress'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-white/80 text-gray-700'
                }`}
              >
                {match.status === 'completed' ? 'Terminado' : match.status === 'in_progress' ? 'A decorrer' : 'Agendado'}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingMatch({
                    id: match.id,
                    scheduledTime: match.scheduled_time || '',
                    court: match.court || '1'
                  });
                }}
                className="print:hidden p-1.5 hover:bg-blue-100 rounded-lg transition-colors text-blue-600"
                title="Editar horário"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          </div>

        {/* Teams and Score */}
        <div className="grid grid-cols-3 gap-2 items-center my-3">
          <div className="text-right">
            {isIndividualRoundRobin ? (
              <div className="space-y-0.5">
                <p className="font-semibold text-sm text-gray-900">
                  {getPlayerName((match as any).player1_individual_id)}
                </p>
                <p className="font-semibold text-sm text-gray-900">
                  {getPlayerName((match as any).player2_individual_id)}
                </p>
              </div>
            ) : match.team1 ? (
              <div>
                <p className="font-bold text-gray-900">
                  {match.team1.name}
                </p>
                {match.team1.player1 && match.team1.player2 && (
                  <p className="text-xs text-gray-600">
                    {match.team1.player1.name} / {match.team1.player2.name}
                  </p>
                )}
              </div>
            ) : (
              <p className="font-semibold text-gray-500">TBD</p>
            )}
          </div>
          
          {/* Score - bigger and centered */}
          <div className="text-center">
            {match.status === 'completed' ? (
              <span className="text-2xl font-black text-gray-900">
                {getMatchScore(match)}
              </span>
            ) : (
              <span className="text-xl font-bold text-gray-400">VS</span>
            )}
          </div>
          
          <div className="text-left">
            {isIndividualRoundRobin ? (
              <div className="space-y-0.5">
                <p className="font-semibold text-sm text-gray-900">
                  {getPlayerName((match as any).player3_individual_id)}
                </p>
                <p className="font-semibold text-sm text-gray-900">
                  {getPlayerName((match as any).player4_individual_id)}
                </p>
              </div>
            ) : match.team2 ? (
              <div>
                <p className="font-bold text-gray-900">
                  {match.team2.name}
                </p>
                {match.team2.player1 && match.team2.player2 && (
                  <p className="text-xs text-gray-600">
                    {match.team2.player1.name} / {match.team2.player2.name}
                  </p>
                )}
              </div>
            ) : (
              <p className="font-semibold text-gray-500">TBD</p>
            )}
          </div>
        </div>

        {/* Footer: Date, Time, Court, Category, Group - all on same line */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 pt-2 border-t border-gray-200/50">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {match.scheduled_time ? new Date(match.scheduled_time).toLocaleString('pt-PT', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            }) : 'Não agendado'}
          </span>
          {showCourt && match.court && (
            <span className="font-semibold bg-white/60 px-2 py-0.5 rounded">Campo {match.court}</span>
          )}
          {showGroup && groupLabel && (
            <span className="font-semibold bg-blue-100 text-blue-800 px-2 py-0.5 rounded">{groupLabel}</span>
          )}
          {categoryLabel && (
            <span className="font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: `${categoryColor}30`, color: categoryColor }}>{categoryLabel}</span>
          )}
        </div>
      </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-5 h-5 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">{t.match.sortBy}:</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSortBy('time')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                sortBy === 'time'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Calendar className="w-4 h-4 inline mr-1" />
              {t.match.sortByTime}
            </button>
            <button
              onClick={() => setSortBy('court')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                sortBy === 'court'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Users className="w-4 h-4 inline mr-1" />
              {t.match.court}
            </button>
            <button
              onClick={() => setSortBy('group')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                sortBy === 'group'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t.match.sortByGroup}
            </button>
          </div>
        </div>

        <button
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
        >
          <Printer className="w-4 h-4" />
          {t.match.printSchedule}
        </button>
      </div>

      <div ref={printAreaRef}>
        <div className="hidden print:block print-only mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{printTitle || t.match.schedule}</h1>
          <p className="text-sm text-gray-600">
            {matches.length} {t.match.matchesCount}
          </p>
        </div>

        {(() => {
          const { groupStage, knockoutStage } = groupMatchesByPhase(sortedMatches);
          const hasGroupStage = groupStage.length > 0;
          const hasKnockoutStage = knockoutStage.length > 0;
          const showPhaseTitles = hasGroupStage && hasKnockoutStage;

          return (
            <>
              {hasGroupStage && (
                <div className="mb-8">
                  {showPhaseTitles && (
                    <h3 className="text-xl font-bold text-gray-900 mb-4">Group Stage</h3>
                  )}
                  {sortBy === 'court' ? (
                    <div className="space-y-6">
                      {groupMatchesByCourt(groupStage).map(({ court, matches: courtMatches }) => (
                        <div key={court} className="bg-white rounded-xl border border-gray-200 p-4 print:break-inside-avoid print:border-2 print:border-gray-800 print:mb-6">
                          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2 print:text-xl print:border-b print:border-gray-400 print:pb-2">
                            <Users className="w-5 h-5 text-blue-600 print:hidden" />
                            Court {court}
                            <span className="text-sm font-normal text-gray-500">({courtMatches.length} {t.match.matchesCount})</span>
                          </h4>
                          <div className="space-y-2">
                            {courtMatches.map(match => renderMatch(match, true, true))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : sortBy === 'group' ? (
                    <div className="space-y-6">
                      {groupMatchesByGroup(groupStage).map(({ group, matches: groupMatches }) => (
                        <div key={group} className="bg-white rounded-xl border border-gray-200 p-4 print:break-inside-avoid print:border-2 print:border-gray-800 print:mb-6">
                          <h4 className="text-lg font-semibold text-gray-900 mb-4 print:text-xl print:border-b print:border-gray-400 print:pb-2">
                            {group}
                            <span className="text-sm font-normal text-gray-500 ml-2">({groupMatches.length} {t.match.matchesCount})</span>
                          </h4>
                          <div className="space-y-2">
                            {groupMatches.map(match => renderMatch(match, true, false))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {groupMatchesByDay(groupStage).map(({ day, matches: dayMatches }) => (
                        <div key={day} className="bg-white rounded-xl border border-gray-200 p-4 print:break-inside-avoid print:border-2 print:border-gray-800 print:mb-6">
                          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2 print:text-xl print:border-b print:border-gray-400 print:pb-2">
                            <Calendar className="w-5 h-5 text-blue-600 print:hidden" />
                            {day}
                            <span className="text-sm font-normal text-gray-500">({dayMatches.length} {t.match.matchesCount})</span>
                          </h4>
                          <div className="space-y-2">
                            {dayMatches.map(match => renderMatch(match, true, true))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {hasKnockoutStage && (
                <div className="mb-8">
                  {showPhaseTitles && (
                    <h3 className="text-xl font-bold text-gray-900 mb-4">Knockout Stage</h3>
                  )}
                  {sortBy === 'court' ? (
                    <div className="space-y-6">
                      {groupMatchesByCourt(knockoutStage).map(({ court, matches: courtMatches }) => (
                        <div key={court} className="bg-white rounded-xl border border-gray-200 p-4 print:break-inside-avoid print:border-2 print:border-gray-800 print:mb-6">
                          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2 print:text-xl print:border-b print:border-gray-400 print:pb-2">
                            <Users className="w-5 h-5 text-blue-600 print:hidden" />
                            Court {court}
                            <span className="text-sm font-normal text-gray-500">({courtMatches.length} {t.match.matchesCount})</span>
                          </h4>
                          <div className="space-y-2">
                            {courtMatches.map(match => renderMatch(match, true, true))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : sortBy === 'time' ? (
                    <div className="space-y-6">
                      {groupMatchesByDay(knockoutStage).map(({ day, matches: dayMatches }) => (
                        <div key={day} className="bg-white rounded-xl border border-gray-200 p-4 print:break-inside-avoid print:border-2 print:border-gray-800 print:mb-6">
                          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2 print:text-xl print:border-b print:border-gray-400 print:pb-2">
                            <Calendar className="w-5 h-5 text-blue-600 print:hidden" />
                            {day}
                            <span className="text-sm font-normal text-gray-500">({dayMatches.length} {t.match.matchesCount})</span>
                          </h4>
                          <div className="space-y-2">
                            {dayMatches.map(match => renderMatch(match, true, true))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {[
                        '1st_semifinal', 'semifinal', 'final', '3rd_place',
                        '5th_semifinal', '5th_place', '7th_place',
                        '9th_semifinal', '9th_place', '11th_place',
                        '13th_semifinal', '13th_place', '15th_place',
                        '17th_semifinal', '17th_place', '19th_place',
                        '21st_semifinal', '21st_place', '23rd_place',
                        'semi_final', 'quarter_final', 'round_16', 'round_32'
                      ].map(round => {
                        const roundMatches = knockoutStage.filter(m => m.round === round);
                        if (roundMatches.length === 0) return null;
                        return (
                          <div key={round} className="bg-white rounded-xl border border-gray-200 p-4 print:break-inside-avoid print:border-2 print:border-gray-800 print:mb-6">
                            <h4 className="text-lg font-semibold text-gray-900 mb-4 print:text-xl print:border-b print:border-gray-400 print:pb-2">
                              {getKnockoutRoundLabel(round)}
                              <span className="text-sm font-normal text-gray-500 ml-2">({roundMatches.length} {t.match.matchesCount})</span>
                            </h4>
                            <div className="space-y-2">
                              {roundMatches.map(match => renderMatch(match, true, false))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!hasGroupStage && !hasKnockoutStage && (
                <>
                  {sortBy === 'court' ? (
                    <div className="space-y-6">
                      {groupMatchesByCourt(sortedMatches).map(({ court, matches: courtMatches }) => (
                        <div key={court} className="bg-white rounded-xl border border-gray-200 p-4 print:break-inside-avoid print:border-2 print:border-gray-800 print:mb-6">
                          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2 print:text-xl print:border-b print:border-gray-400 print:pb-2">
                            <Users className="w-5 h-5 text-blue-600 print:hidden" />
                            Court {court}
                            <span className="text-sm font-normal text-gray-500">({courtMatches.length} {t.match.matchesCount})</span>
                          </h4>
                          <div className="space-y-2">
                            {courtMatches.map(match => renderMatch(match, true, true))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : sortBy === 'time' ? (
                    <div className="space-y-6">
                      {groupMatchesByDay(sortedMatches).map(({ day, matches: dayMatches }) => (
                        <div key={day} className="bg-white rounded-xl border border-gray-200 p-4 print:break-inside-avoid print:border-2 print:border-gray-800 print:mb-6">
                          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2 print:text-xl print:border-b print:border-gray-400 print:pb-2">
                            <Calendar className="w-5 h-5 text-blue-600 print:hidden" />
                            {day}
                            <span className="text-sm font-normal text-gray-500">({dayMatches.length} {t.match.matchesCount})</span>
                          </h4>
                          <div className="space-y-2">
                            {dayMatches.map(match => renderMatch(match, true, true))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sortedMatches.map(match => renderMatch(match, true, true))}
                    </div>
                  )}
                </>
              )}
            </>
          );
        })()}
      </div>

      {/* Edit Match Schedule Modal */}
      {editingMatch && (
        <EditMatchScheduleModal
          matchId={editingMatch.id}
          currentScheduledTime={editingMatch.scheduledTime}
          currentCourt={editingMatch.court}
          onClose={() => setEditingMatch(null)}
          onSuccess={() => {
            if (onScheduleUpdate) {
              onScheduleUpdate();
            }
          }}
        />
      )}
    </div>
  );
}
