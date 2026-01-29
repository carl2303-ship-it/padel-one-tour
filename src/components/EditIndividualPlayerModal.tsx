import { useState, useEffect } from 'react';
import { supabase, TournamentCategory } from '../lib/supabase';
import { X, Trash2 } from 'lucide-react';
import { useI18n } from '../lib/i18nContext';

type IndividualPlayer = {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  skill_level: string | null;
  category_id: string | null;
  group_name: string | null;
  seed: number | null;
};

type EditIndividualPlayerModalProps = {
  player: IndividualPlayer;
  tournamentId: string;
  onClose: () => void;
  onSuccess: () => void;
};


export default function EditIndividualPlayerModal({ player, tournamentId, onClose, onSuccess }: EditIndividualPlayerModalProps) {
  const { t } = useI18n();
  const [categories, setCategories] = useState<TournamentCategory[]>([]);
  const [name, setName] = useState(player.name);
  const [email, setEmail] = useState(player.email || '');
  const [phoneNumber, setPhoneNumber] = useState(player.phone_number || '');
  const [categoryId, setCategoryId] = useState<string>(player.category_id || '');
  const [seed, setSeed] = useState<number | ''>(player.seed ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('tournament_categories')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('name');

    if (data) {
      setCategories(data);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!name.trim()) {
      setError('Nome e obrigatorio');
      setLoading(false);
      return;
    }

    try {
      const { error: updateError } = await supabase
        .from('players')
        .update({
          name: name.trim(),
          email: email.trim() || null,
          phone_number: phoneNumber.trim() || null,
          category_id: categoryId || null,
          seed: seed === '' ? null : seed,
        })
        .eq('id', player.id);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
      } else {
        onSuccess();
      }
    } catch (err) {
      console.error('[EDIT-PLAYER] Exception:', err);
      setError('Ocorreu um erro inesperado');
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Tem a certeza que quer eliminar este jogador? Esta acao nao pode ser revertida.')) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { error: deleteError } = await supabase
        .from('players')
        .delete()
        .eq('id', player.id);

      if (deleteError) {
        setError(deleteError.message);
        setLoading(false);
      } else {
        onSuccess();
      }
    } catch (err) {
      setError('Ocorreu um erro inesperado');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Editar Jogador</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nome *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Nome do jogador"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="email@exemplo.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Telefone</label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="+351 912 345 678"
            />
          </div>

          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Categoria</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Sem Categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Seed (opcional)</label>
            <input
              type="number"
              min="1"
              max="120"
              value={seed}
              onChange={(e) => setSeed(e.target.value === '' ? '' : parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="1-120"
            />
            <p className="text-sm text-gray-500 mt-1">
              Cabeca de serie para posicionamento no quadro
            </p>
          </div>

          {player.group_name && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Grupo</label>
              <div className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700">
                Grupo {player.group_name}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                O grupo e atribuido automaticamente pelo sistema
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t border-gray-200 mt-6">
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading}
              className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium disabled:opacity-50 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Eliminar
            </button>
            <div className="flex-1 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                {t.button.cancel}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
              >
                {loading ? t.button.saving : t.button.saveChanges}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
