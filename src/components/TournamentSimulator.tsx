import { useState, useEffect } from 'react';
import { useI18n } from '../lib/i18nContext';
import { X, Calculator, Clock, Users, Trophy, Calendar } from 'lucide-react';
import TimeInput24h from './TimeInput24h';

type TournamentSimulatorProps = {
  onClose: () => void;
};

type TournamentFormat = 
  | 'individual_groups_knockout'
  | 'round_robin_individual'
  | 'groups_knockout'
  | 'single_elimination'
  | 'round_robin_teams'
  | 'super_teams'
  | 'crossed_playoffs'
  | 'mixed_gender'
  | 'mixed_american';

interface FormatResult {
  format: TournamentFormat;
  formatName: string;
  maxMatches: number;
  maxTeams: number;
  maxTeamsPerCategory: number;
  maxMatchDurationMinutes: number;
}

export default function TournamentSimulator({ onClose }: TournamentSimulatorProps) {
  const { t } = useI18n();
  const [formData, setFormData] = useState({
    startDate: '',
    endDate: '',
    dailyStartTime: '09:00',
    dailyEndTime: '21:00',
    numberOfCourts: 2,
    numberOfCategories: 1,
    matchDurationMinutes: 30,
  });

  const [results, setResults] = useState<FormatResult[]>([]);

  useEffect(() => {
    if (formData.startDate && formData.endDate) {
      calculateAllFormats();
    } else {
      setResults([]);
    }
  }, [formData]);

  const calculateAllFormats = () => {
    if (!formData.startDate || !formData.endDate) {
      setResults([]);
      return;
    }

    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const [startHour, startMinute] = formData.dailyStartTime.split(':').map(Number);
    const [endHour, endMinute] = formData.dailyEndTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    const hoursPerDay = (endMinutes - startMinutes) / 60;

    if (hoursPerDay <= 0) {
      setResults([]);
      return;
    }

    // Calcular tempo total disponível em minutos
    const totalMinutesAvailable = totalDays * hoursPerDay * 60 * formData.numberOfCourts;
    
    // Para cada formato, calcular o máximo
    const formats: Array<{ format: TournamentFormat; name: string }> = [
      { format: 'individual_groups_knockout', name: 'Grupos + Fases Finais (Individual)' },
      { format: 'round_robin_individual', name: 'Americano Individual' },
      { format: 'groups_knockout', name: 'Grupos + Fases Finais (Equipas)' },
      { format: 'single_elimination', name: 'Eliminação Simples' },
      { format: 'round_robin_teams', name: 'Americano Equipas' },
      { format: 'super_teams', name: 'Super Equipas' },
      { format: 'crossed_playoffs', name: 'Playoffs Cruzados' },
      { format: 'mixed_gender', name: 'Misto Género' },
      { format: 'mixed_american', name: 'Americano Misto' },
    ];

    const calculatedResults: FormatResult[] = formats.map(({ format, name }) => {
      return calculateFormat(format, name, totalMinutesAvailable, totalDays, hoursPerDay);
    });

    setResults(calculatedResults);
  };

  const calculateFormat = (
    format: TournamentFormat,
    formatName: string,
    totalMinutesAvailable: number,
    totalDays: number,
    hoursPerDay: number
  ): FormatResult => {
    const matchDuration = formData.matchDurationMinutes;
    const matchesPerCourtPerDay = Math.floor((hoursPerDay * 60) / matchDuration);
    const totalMatchesPerDay = matchesPerCourtPerDay * formData.numberOfCourts;
    const maxMatchesTotal = totalMatchesPerDay * totalDays;
    const maxMatchesPerCategory = Math.floor(maxMatchesTotal / formData.numberOfCategories);

    let maxTeamsForFormat = 0;
    let maxTeamsPerCategoryForFormat = 0;

    if (
      format === 'groups_knockout' ||
      format === 'individual_groups_knockout' ||
      format === 'crossed_playoffs' ||
      format === 'mixed_gender' ||
      format === 'mixed_american'
    ) {
      // Para formatos com grupos, tentar diferentes configurações
      for (let numGroups = 2; numGroups <= 8; numGroups++) {
        for (let teamsPerGroup = 3; teamsPerGroup <= 8; teamsPerGroup++) {
          // Jogos de grupos: numGroups * (teamsPerGroup * (teamsPerGroup - 1)) / 2
          const groupMatches = numGroups * (teamsPerGroup * (teamsPerGroup - 1)) / 2;
          
          // Calcular jogos de knockout (estimativa conservadora)
          const qualifiedPerGroup = 2; // Assumir 2 qualificados por grupo
          const totalQualified = numGroups * qualifiedPerGroup;
          let knockoutMatches = 0;
          
          if (totalQualified >= 16) {
            knockoutMatches = 15; // Oitavos
          } else if (totalQualified >= 8) {
            knockoutMatches = 7; // Quartos
          } else if (totalQualified >= 4) {
            knockoutMatches = 3; // Meias
          } else if (totalQualified >= 2) {
            knockoutMatches = 1; // Final
          }
          
          const totalMatchesNeeded = (groupMatches + knockoutMatches) * formData.numberOfCategories;
          
          if (totalMatchesNeeded <= maxMatchesTotal) {
            const totalTeams = numGroups * teamsPerGroup;
            if (totalTeams > maxTeamsForFormat) {
              maxTeamsForFormat = totalTeams;
              maxTeamsPerCategoryForFormat = totalTeams;
            }
          }
        }
      }
    } else if (format === 'round_robin_individual' || format === 'round_robin_teams') {
      // Round robin: N * (N-1) / 2 jogos
      // Resolver: N * (N-1) / 2 * numberOfCategories <= maxMatchesTotal
      // N^2 - N - (2 * maxMatchesPerCategory) <= 0
      const maxN = Math.floor((1 + Math.sqrt(1 + 8 * maxMatchesPerCategory)) / 2);
      maxTeamsForFormat = maxN;
      maxTeamsPerCategoryForFormat = maxN;
    } else if (format === 'single_elimination') {
      // Eliminação simples: N-1 jogos
      maxTeamsForFormat = maxMatchesPerCategory + 1;
      maxTeamsPerCategoryForFormat = maxMatchesPerCategory + 1;
    } else if (format === 'super_teams') {
      // Super teams: estimativa de 2 jogos por equipa
      maxTeamsForFormat = Math.floor(maxMatchesPerCategory / 2);
      maxTeamsPerCategoryForFormat = Math.floor(maxMatchesPerCategory / 2);
    }

    return {
      format,
      formatName,
      maxMatches: maxMatchesTotal,
      maxTeams: maxTeamsForFormat * formData.numberOfCategories,
      maxTeamsPerCategory: maxTeamsPerCategoryForFormat,
      maxMatchDurationMinutes: matchDuration,
    };
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Calculator className="w-6 h-6" />
            Simulador de Torneio
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Formulário de Entrada */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Parâmetros do Torneio</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Data de Início *
                </label>
                <input
                  type="date"
                  required
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Data de Fim *
                </label>
                <input
                  type="date"
                  required
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Hora de Início Diária *
                </label>
                <TimeInput24h
                  value={formData.dailyStartTime}
                  onChange={(value) => setFormData({ ...formData, dailyStartTime: value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Hora de Fim Diária *
                </label>
                <TimeInput24h
                  value={formData.dailyEndTime}
                  onChange={(value) => setFormData({ ...formData, dailyEndTime: value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Número de Campos *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formData.numberOfCourts}
                  onChange={(e) => setFormData({ ...formData, numberOfCourts: parseInt(e.target.value) || 1 })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Número de Categorias *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formData.numberOfCategories}
                  onChange={(e) => setFormData({ ...formData, numberOfCategories: parseInt(e.target.value) || 1 })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Duração de Cada Jogo (minutos) *
                </label>
                <select
                  value={formData.matchDurationMinutes}
                  onChange={(e) => setFormData({ ...formData, matchDurationMinutes: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {Array.from({ length: 13 }, (_, i) => i + 8).map((min) => (
                    <option key={min} value={min}>{min} minutos</option>
                  ))}
                  {Array.from({ length: 20 }, (_, i) => 25 + i * 5).map((min) => (
                    <option key={min} value={min}>{min} minutos</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Resultados por Formato */}
          {results.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Trophy className="w-6 h-6" />
                Resultados por Formato
              </h3>
              
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-100 border-b-2 border-gray-300">
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Formato</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Máx. Jogos</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Máx. Equipas/Jogadores</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Máx. por Categoria</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Duração Jogo (min)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result, index) => (
                      <tr
                        key={result.format}
                        className={`border-b border-gray-200 ${
                          index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                        } hover:bg-blue-50 transition-colors`}
                      >
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {result.formatName}
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-bold text-blue-600">
                          {result.maxMatches}
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-bold text-green-600">
                          {result.maxTeams}
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-bold text-purple-600">
                          {result.maxTeamsPerCategory}
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-bold text-orange-600">
                          {result.maxMatchDurationMinutes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {results.length === 0 && formData.startDate && formData.endDate && (
            <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
              <Calculator className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">Preencha todos os campos para ver os resultados</p>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
