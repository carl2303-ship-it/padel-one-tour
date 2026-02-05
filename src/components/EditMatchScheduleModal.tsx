import { useState, useEffect } from 'react';
import { X, Calendar, Clock, MapPin } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface EditMatchScheduleModalProps {
  matchId: string;
  currentScheduledTime: string;
  currentCourt: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditMatchScheduleModal({
  matchId,
  currentScheduledTime,
  currentCourt,
  onClose,
  onSuccess,
}: EditMatchScheduleModalProps) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [court, setCourt] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Parse current scheduled time
    if (currentScheduledTime) {
      const dt = new Date(currentScheduledTime);
      const dateStr = dt.toISOString().split('T')[0];
      const hours = String(dt.getHours()).padStart(2, '0');
      const minutes = String(dt.getMinutes()).padStart(2, '0');
      setDate(dateStr);
      setTime(`${hours}:${minutes}`);
    }
    setCourt(currentCourt || '1');
  }, [currentScheduledTime, currentCourt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!date || !time) {
      alert('Por favor preencha a data e hora');
      return;
    }

    setLoading(true);
    try {
      // Combine date and time
      const scheduledTime = new Date(`${date}T${time}:00`);
      
      const { error } = await supabase
        .from('matches')
        .update({
          scheduled_time: scheduledTime.toISOString(),
          court: court,
        })
        .eq('id', matchId);

      if (error) throw error;

      alert('Horário atualizado com sucesso!');
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error updating match schedule:', error);
      alert('Erro ao atualizar horário');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-bold text-gray-900">Editar Horário do Jogo</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Date */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <Calendar className="w-4 h-4" />
              Data
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Time */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <Clock className="w-4 h-4" />
              Hora
            </label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Court */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <MapPin className="w-4 h-4" />
              Campo
            </label>
            <input
              type="text"
              value={court}
              onChange={(e) => setCourt(e.target.value)}
              placeholder="Ex: 1, 2, A, B..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? 'A guardar...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
