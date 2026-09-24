import { useMemo, useState } from 'react';
import { X, GripVertical, ChevronUp, ChevronDown, Save, RotateCcw, Loader2 } from 'lucide-react';
import { applyManualSeedOrder, type SeedParticipant } from '../lib/seedOrder';
import { recalculateSeedsByLevel } from '../lib/levelSeeding';

type SeedOrderModalProps = {
  tournamentId: string;
  isIndividual: boolean;
  participants: SeedParticipant[];
  categoryLabel?: string | null;
  seedMode?: 'level' | 'manual' | null;
  onClose: () => void;
  onSuccess: (mode?: 'level' | 'manual') => void;
};

export default function SeedOrderModal({
  tournamentId,
  isIndividual,
  participants,
  categoryLabel,
  seedMode,
  onClose,
  onSuccess,
}: SeedOrderModalProps) {
  const initial = useMemo(
    () =>
      [...participants].sort((a, b) => {
        const sa = a.seed ?? 9999;
        const sb = b.seed ?? 9999;
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name);
      }),
    [participants]
  );

  const [ordered, setOrdered] = useState<SeedParticipant[]>(initial);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [recalcing, setRecalcing] = useState(false);
  const [error, setError] = useState('');

  const move = (from: number, to: number) => {
    if (to < 0 || to >= ordered.length) return;
    setOrdered((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const { error: saveError } = await applyManualSeedOrder({
        tournamentId,
        isIndividual,
        orderedIds: ordered.map((p) => p.id),
      });
      if (saveError) {
        setError(saveError);
        return;
      }
      onSuccess('manual');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleRecalcByLevel = async () => {
    if (
      !confirm(
        'Recalcular cabeças de série pelo nível dos jogadores? A ordem manual atual será substituída.'
      )
    ) {
      return;
    }
    setRecalcing(true);
    setError('');
    try {
      await recalculateSeedsByLevel(tournamentId, null, { force: true });
      onSuccess('level');
      onClose();
    } catch (err) {
      console.error(err);
      setError('Não foi possível recalcular por nível.');
    } finally {
      setRecalcing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Cabeças de série</h2>
            <p className="text-xs text-slate-500">
              {categoryLabel ? `${categoryLabel} · ` : ''}
              {isIndividual ? 'Jogadores' : 'Equipas'}
              {seedMode === 'manual' ? ' · ordem manual' : ' · automática por nível'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 text-sm text-slate-600 border-b border-slate-100 bg-slate-50">
          Arrasta ou usa as setas para definir CS1, CS2, …. Ao guardar, a ordem automática por nível fica desligada.
        </div>

        <div className="overflow-y-auto flex-1 px-3 py-3 space-y-1.5">
          {ordered.length === 0 ? (
            <p className="text-center text-slate-500 py-10 text-sm">Sem participantes nesta categoria.</p>
          ) : (
            ordered.map((p, index) => (
              <div
                key={p.id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex == null || dragIndex === index) return;
                  move(dragIndex, index);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border bg-white ${
                  dragIndex === index ? 'border-blue-400 bg-blue-50' : 'border-slate-200'
                }`}
              >
                <GripVertical className="w-4 h-4 text-slate-400 shrink-0 cursor-grab" />
                <span className="w-12 shrink-0 text-sm font-black text-blue-700">CS{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900 truncate">{p.name}</div>
                  {p.subtitle && (
                    <div className="text-xs text-slate-500 truncate">{p.subtitle}</div>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0}
                    className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
                    aria-label="Subir"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, index + 1)}
                    disabled={index === ordered.length - 1}
                    className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
                    aria-label="Descer"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {error && (
          <div className="mx-5 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="border-t border-slate-200 px-5 py-4 flex flex-col sm:flex-row gap-2 sm:justify-between bg-slate-50">
          <button
            type="button"
            onClick={handleRecalcByLevel}
            disabled={recalcing || saving}
            className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-200 transition disabled:opacity-60"
          >
            {recalcing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Recalcular por nível
          </button>
          <div className="flex gap-2 sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-slate-700 hover:bg-slate-200 transition text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || ordered.length === 0}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition text-sm font-semibold disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar ordem
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
