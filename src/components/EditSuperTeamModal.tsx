import React, { useState, useEffect } from 'react';
import { X, Save, Plus, Trash2, Crown, GripVertical, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';

type SuperTeamPlayer = {
  id: string;
  name: string;
  email?: string | null;
  phone_number?: string | null;
  is_captain: boolean;
  player_order: number;
};

type SuperTeam = {
  id: string;
  tournament_id: string;
  category_id: string | null;
  name: string;
  group_name: string | null;
  super_team_players?: SuperTeamPlayer[];
};

type Category = {
  id: string;
  name: string;
};

type Props = {
  superTeam: SuperTeam;
  tournamentId: string;
  categories: Category[];
  onClose: () => void;
  onSuccess: () => void;
};

export default function EditSuperTeamModal({ superTeam, tournamentId, categories, onClose, onSuccess }: Props) {
  const [name, setName] = useState(superTeam.name);
  const [groupName, setGroupName] = useState(superTeam.group_name || '');
  const [categoryId, setCategoryId] = useState(superTeam.category_id || '');
  const [players, setPlayers] = useState<SuperTeamPlayer[]>(
    [...(superTeam.super_team_players || [])].sort((a, b) => a.player_order - b.player_order)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // New player form
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerEmail, setNewPlayerEmail] = useState('');
  const [newPlayerPhone, setNewPlayerPhone] = useState('');

  const handleSave = async () => {
    if (!name.trim()) {
      setError('O nome da equipa é obrigatório');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Update super team
      const { error: teamError } = await supabase
        .from('super_teams')
        .update({
          name: name.trim(),
          group_name: groupName.trim() || null,
          category_id: categoryId || null,
        })
        .eq('id', superTeam.id);

      if (teamError) throw teamError;

      // Update players - update each player's data
      for (const player of players) {
        const { error: playerError } = await supabase
          .from('super_team_players')
          .update({
            name: player.name,
            email: player.email || null,
            phone_number: player.phone_number || null,
            is_captain: player.is_captain,
            player_order: player.player_order,
          })
          .eq('id', player.id);

        if (playerError) throw playerError;
      }

      onSuccess();
    } catch (err: any) {
      console.error('Error updating super team:', err);
      setError(err.message || 'Erro ao atualizar equipa');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPlayer = async () => {
    if (!newPlayerName.trim()) {
      setError('O nome do jogador é obrigatório');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const newOrder = players.length > 0 ? Math.max(...players.map(p => p.player_order)) + 1 : 1;
      
      const { data, error } = await supabase
        .from('super_team_players')
        .insert({
          super_team_id: superTeam.id,
          name: newPlayerName.trim(),
          email: newPlayerEmail.trim() || null,
          phone_number: newPlayerPhone.trim() || null,
          is_captain: players.length === 0, // First player is captain
          player_order: newOrder,
        })
        .select()
        .single();

      if (error) throw error;

      setPlayers([...players, data]);
      setNewPlayerName('');
      setNewPlayerEmail('');
      setNewPlayerPhone('');
      setShowAddPlayer(false);
    } catch (err: any) {
      console.error('Error adding player:', err);
      setError(err.message || 'Erro ao adicionar jogador');
    } finally {
      setLoading(false);
    }
  };

  const handleRemovePlayer = async (playerId: string) => {
    if (!confirm('Tem a certeza que deseja remover este jogador?')) return;

    setLoading(true);
    setError('');

    try {
      const { error } = await supabase
        .from('super_team_players')
        .delete()
        .eq('id', playerId);

      if (error) throw error;

      setPlayers(players.filter(p => p.id !== playerId));
    } catch (err: any) {
      console.error('Error removing player:', err);
      setError(err.message || 'Erro ao remover jogador');
    } finally {
      setLoading(false);
    }
  };

  const handleSetCaptain = (playerId: string) => {
    setPlayers(players.map(p => ({
      ...p,
      is_captain: p.id === playerId
    })));
  };

  const handlePlayerChange = (playerId: string, field: keyof SuperTeamPlayer, value: string | boolean) => {
    setPlayers(players.map(p => 
      p.id === playerId ? { ...p, [field]: value } : p
    ));
  };

  const movePlayer = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === players.length - 1)) return;
    
    const newPlayers = [...players];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    
    // Swap player_order values
    const tempOrder = newPlayers[index].player_order;
    newPlayers[index].player_order = newPlayers[swapIndex].player_order;
    newPlayers[swapIndex].player_order = tempOrder;
    
    // Swap positions in array
    [newPlayers[index], newPlayers[swapIndex]] = [newPlayers[swapIndex], newPlayers[index]];
    
    setPlayers(newPlayers);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-purple-600 text-white">
          <h2 className="text-xl font-semibold">Editar Super Equipa</h2>
          <button onClick={onClose} className="p-1 hover:bg-purple-700 rounded-lg transition">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-130px)] space-y-6">
          {error && (
            <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Team Info */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nome da Equipa *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                placeholder="Ex: Os Invencíveis"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Grupo
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  placeholder="Ex: A, B, C..."
                />
              </div>

              {categories.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Categoria
                  </label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  >
                    <option value="">Sem categoria</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Players */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Jogadores ({players.length})
              </h3>
              <button
                onClick={() => setShowAddPlayer(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
              >
                <UserPlus className="w-4 h-4" />
                Adicionar Jogador
              </button>
            </div>

            {/* Add Player Form */}
            {showAddPlayer && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-3">
                <h4 className="font-medium text-green-800">Novo Jogador</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    type="text"
                    value={newPlayerName}
                    onChange={(e) => setNewPlayerName(e.target.value)}
                    className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="Nome *"
                  />
                  <input
                    type="email"
                    value={newPlayerEmail}
                    onChange={(e) => setNewPlayerEmail(e.target.value)}
                    className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="Email"
                  />
                  <input
                    type="tel"
                    value={newPlayerPhone}
                    onChange={(e) => setNewPlayerPhone(e.target.value)}
                    className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="Telefone"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAddPlayer}
                    disabled={loading}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                  >
                    Adicionar
                  </button>
                  <button
                    onClick={() => {
                      setShowAddPlayer(false);
                      setNewPlayerName('');
                      setNewPlayerEmail('');
                      setNewPlayerPhone('');
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Players List */}
            <div className="space-y-2">
              {players.length === 0 ? (
                <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
                  <p>Nenhum jogador adicionado</p>
                </div>
              ) : (
                players.map((player, index) => (
                  <div
                    key={player.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      player.is_captain ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    {/* Order controls */}
                    <div className="flex flex-col">
                      <button
                        onClick={() => movePlayer(index, 'up')}
                        disabled={index === 0}
                        className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => movePlayer(index, 'down')}
                        disabled={index === players.length - 1}
                        className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </div>

                    {/* Order number */}
                    <div className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">
                      {index + 1}
                    </div>

                    {/* Player info */}
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={player.name}
                        onChange={(e) => handlePlayerChange(player.id, 'name', e.target.value)}
                        className="px-2 py-1 border rounded text-sm focus:ring-1 focus:ring-purple-500"
                        placeholder="Nome"
                      />
                      <input
                        type="email"
                        value={player.email || ''}
                        onChange={(e) => handlePlayerChange(player.id, 'email', e.target.value)}
                        className="px-2 py-1 border rounded text-sm focus:ring-1 focus:ring-purple-500"
                        placeholder="Email"
                      />
                      <input
                        type="tel"
                        value={player.phone_number || ''}
                        onChange={(e) => handlePlayerChange(player.id, 'phone_number', e.target.value)}
                        className="px-2 py-1 border rounded text-sm focus:ring-1 focus:ring-purple-500"
                        placeholder="Telefone"
                      />
                    </div>

                    {/* Captain button */}
                    <button
                      onClick={() => handleSetCaptain(player.id)}
                      className={`p-2 rounded-lg transition ${
                        player.is_captain
                          ? 'bg-yellow-400 text-yellow-900'
                          : 'bg-gray-200 text-gray-500 hover:bg-yellow-200'
                      }`}
                      title={player.is_captain ? 'Capitão' : 'Definir como capitão'}
                    >
                      <Crown className="w-4 h-4" />
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={() => handleRemovePlayer(player.id)}
                      className="p-2 text-red-500 hover:bg-red-100 rounded-lg transition"
                      title="Remover jogador"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {loading ? 'A guardar...' : 'Guardar Alterações'}
          </button>
        </div>
      </div>
    </div>
  );
}
