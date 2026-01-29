import { useState, useEffect } from 'react';
import { X, Users, Shuffle, Save, GripVertical } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Player {
  id: string;
  name: string;
  group_name?: string;
  category_id?: string;
  seed?: number;
}

interface Team {
  id: string;
  player1_name: string;
  player2_name: string;
  group_name?: string;
  category_id?: string;
}

interface Category {
  id: string;
  name: string;
  number_of_groups?: number;
}

interface ManualGroupAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  tournamentId: string;
  isIndividual: boolean;
  players: Player[];
  teams: Team[];
  categories: Category[];
  numberOfGroups: number;
  onSave: () => void;
}

const GROUP_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function ManualGroupAssignmentModal({
  isOpen,
  onClose,
  tournamentId,
  isIndividual,
  players,
  teams,
  categories,
  numberOfGroups,
  onSave,
}: ManualGroupAssignmentModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  const participants = isIndividual ? players : teams;
  const filteredParticipants = selectedCategory === 'all'
    ? participants
    : participants.filter((p: any) => p.category_id === selectedCategory);

  const categoryNumberOfGroups = selectedCategory !== 'all'
    ? categories.find(c => c.id === selectedCategory)?.number_of_groups || numberOfGroups
    : numberOfGroups;

  const groupNames = GROUP_NAMES.slice(0, categoryNumberOfGroups);

  useEffect(() => {
    const initialAssignments = new Map<string, string>();
    filteredParticipants.forEach((p: any) => {
      if (p.group_name) {
        initialAssignments.set(p.id, p.group_name);
      }
    });
    setAssignments(initialAssignments);
  }, [filteredParticipants, selectedCategory]);

  const getParticipantName = (p: any) => {
    if (isIndividual) {
      return p.name;
    }
    return `${p.player1_name} / ${p.player2_name}`;
  };

  const getParticipantsInGroup = (groupName: string) => {
    return filteredParticipants.filter((p: any) => assignments.get(p.id) === groupName);
  };

  const getUnassignedParticipants = () => {
    return filteredParticipants.filter((p: any) => !assignments.get(p.id));
  };

  const handleAssign = (participantId: string, groupName: string) => {
    setAssignments(prev => {
      const newAssignments = new Map(prev);
      if (groupName === '') {
        newAssignments.delete(participantId);
      } else {
        newAssignments.set(participantId, groupName);
      }
      return newAssignments;
    });
  };

  const handleRandomAssign = () => {
    const unassigned = getUnassignedParticipants();
    if (unassigned.length === 0) {
      const confirmReassign = confirm('All participants are already assigned. Reassign everyone randomly?');
      if (!confirmReassign) return;

      const shuffled = [...filteredParticipants].sort(() => Math.random() - 0.5);
      const newAssignments = new Map<string, string>();
      shuffled.forEach((p: any, index) => {
        const groupIndex = index % categoryNumberOfGroups;
        newAssignments.set(p.id, groupNames[groupIndex]);
      });
      setAssignments(newAssignments);
    } else {
      const shuffled = [...unassigned].sort(() => Math.random() - 0.5);
      const newAssignments = new Map(assignments);

      const groupCounts = new Map<string, number>();
      groupNames.forEach(g => {
        groupCounts.set(g, getParticipantsInGroup(g).length);
      });

      shuffled.forEach((p: any) => {
        let minGroup = groupNames[0];
        let minCount = groupCounts.get(minGroup) || 0;

        groupNames.forEach(g => {
          const count = groupCounts.get(g) || 0;
          if (count < minCount) {
            minCount = count;
            minGroup = g;
          }
        });

        newAssignments.set(p.id, minGroup);
        groupCounts.set(minGroup, (groupCounts.get(minGroup) || 0) + 1);
      });

      setAssignments(newAssignments);
    }
  };

  const handleDragStart = (e: React.DragEvent, participantId: string) => {
    setDraggedItem(participantId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, groupName: string) => {
    e.preventDefault();
    if (draggedItem) {
      handleAssign(draggedItem, groupName);
      setDraggedItem(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = Array.from(assignments.entries()).map(([id, group_name]) => ({
        id,
        group_name,
      }));

      const unassignedIds = filteredParticipants
        .filter((p: any) => !assignments.has(p.id))
        .map((p: any) => p.id);

      if (isIndividual) {
        for (const update of updates) {
          await supabase
            .from('players')
            .update({ group_name: update.group_name })
            .eq('id', update.id);
        }

        if (unassignedIds.length > 0) {
          await supabase
            .from('players')
            .update({ group_name: null })
            .in('id', unassignedIds);
        }
      } else {
        for (const update of updates) {
          await supabase
            .from('teams')
            .update({ group_name: update.group_name })
            .eq('id', update.id);
        }

        if (unassignedIds.length > 0) {
          await supabase
            .from('teams')
            .update({ group_name: null })
            .in('id', unassignedIds);
        }
      }

      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving group assignments:', error);
      alert('Failed to save group assignments');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const unassigned = getUnassignedParticipants();
  const minPerGroup = isIndividual ? 4 : 2;
  const allGroupsValid = groupNames.every(g => getParticipantsInGroup(g).length >= minPerGroup);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Distribuir {isIndividual ? 'Jogadores' : 'Equipas'} por Grupos
              </h2>
              <p className="text-sm text-gray-500">
                Arrasta ou seleciona o grupo para cada {isIndividual ? 'jogador' : 'equipa'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 border-b bg-gray-50 flex flex-wrap items-center gap-4">
          {categories.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Categoria:</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">Todas</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleRandomAssign}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
          >
            <Shuffle className="w-4 h-4" />
            Distribuir Aleatorio
          </button>

          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-gray-500">
              {assignments.size} de {filteredParticipants.length} atribuidos
            </span>
            {!allGroupsValid && (
              <span className="text-orange-600 font-medium">
                (min. {minPerGroup} por grupo)
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div
              className="border-2 border-dashed border-gray-300 rounded-xl p-4 bg-gray-50 min-h-[200px]"
              onDragOver={handleDragOver}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedItem) {
                  handleAssign(draggedItem, '');
                  setDraggedItem(null);
                }
              }}
            >
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-xs">
                  {unassigned.length}
                </span>
                Sem Grupo
              </h3>
              <div className="flex flex-wrap gap-2">
                {unassigned.map((p: any) => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, p.id)}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg cursor-move hover:shadow-md transition-shadow group"
                  >
                    <GripVertical className="w-4 h-4 text-gray-400 group-hover:text-gray-600" />
                    <span className="text-sm font-medium text-gray-900">
                      {getParticipantName(p)}
                    </span>
                    <select
                      value=""
                      onChange={(e) => handleAssign(p.id, e.target.value)}
                      className="ml-2 px-2 py-1 text-xs border border-gray-200 rounded bg-gray-50 hover:bg-white focus:ring-2 focus:ring-blue-500"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="">Selecionar...</option>
                      {groupNames.map(g => (
                        <option key={g} value={g}>Grupo {g}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {unassigned.length === 0 && (
                  <p className="text-sm text-gray-400 italic">
                    Todos os {isIndividual ? 'jogadores' : 'equipas'} foram atribuidos
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {groupNames.map(groupName => {
                const groupParticipants = getParticipantsInGroup(groupName);
                const isValid = groupParticipants.length >= minPerGroup;

                return (
                  <div
                    key={groupName}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, groupName)}
                    className={`border-2 rounded-xl p-3 min-h-[150px] transition-colors ${
                      draggedItem ? 'border-blue-400 bg-blue-50' :
                      isValid ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'
                    }`}
                  >
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs text-white ${
                        isValid ? 'bg-green-500' : 'bg-orange-500'
                      }`}>
                        {groupParticipants.length}
                      </span>
                      <span className={isValid ? 'text-green-700' : 'text-orange-700'}>
                        Grupo {groupName}
                      </span>
                    </h3>
                    <div className="space-y-1">
                      {groupParticipants.map((p: any, idx) => (
                        <div
                          key={p.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, p.id)}
                          className="flex items-center gap-2 px-2 py-1.5 bg-white border border-gray-200 rounded-lg cursor-move hover:shadow-md transition-shadow text-sm group"
                        >
                          <GripVertical className="w-3 h-3 text-gray-400 group-hover:text-gray-600" />
                          <span className="text-gray-400 text-xs w-4">{idx + 1}.</span>
                          <span className="flex-1 font-medium text-gray-900 truncate">
                            {getParticipantName(p)}
                          </span>
                          <button
                            onClick={() => handleAssign(p.id, '')}
                            className="p-1 hover:bg-red-100 rounded text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {groupParticipants.length === 0 && (
                        <p className="text-xs text-gray-400 italic text-center py-4">
                          Arrasta para aqui
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-4 border-t bg-gray-50 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {!allGroupsValid && unassigned.length === 0 && (
              <span className="text-orange-600">
                Alguns grupos tem menos de {minPerGroup} {isIndividual ? 'jogadores' : 'equipas'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || unassigned.length > 0}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {saving ? 'A guardar...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
