import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatEuDate, parseEuDate } from '../lib/clubLeagueScheduler';

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'] as const;
const MONTHS_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

type Props = {
  /** Display value dd/MM/yyyy (or ISO) */
  value: string;
  onChange: (euDate: string, isoDate: string) => void;
  label?: string;
  hint?: string;
  optional?: boolean;
};

function isoFromParts(y: number, m0: number, day: number): string {
  const mm = String(m0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function parseViewMonth(iso: string | null): { y: number; m0: number } {
  if (iso) {
    const [y, m] = iso.split('-').map(Number);
    if (y && m) return { y, m0: m - 1 };
  }
  const now = new Date();
  return { y: now.getFullYear(), m0: now.getMonth() };
}

function weekdayLabelForIso(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return WEEKDAY_SHORT[d.getDay()];
}

export default function MiniMonthDatePicker({
  value,
  onChange,
  label,
  hint,
  optional,
}: Props) {
  const iso = parseEuDate(value);
  const [open, setOpen] = useState(false);
  const [{ y, m0 }, setView] = useState(() => parseViewMonth(iso || null));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && iso) setView(parseViewMonth(iso));
  }, [open, iso]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(y, m0, 1, 12);
    // Monday-first: Mon=0 … Sun=6
    const jsDow = first.getDay(); // 0=Sun
    const mondayOffset = jsDow === 0 ? 6 : jsDow - 1;
    const daysInMonth = new Date(y, m0 + 1, 0).getDate();
    const out: Array<{ day: number; iso: string; inMonth: boolean } | null> = [];
    for (let i = 0; i < mondayOffset; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ day: d, iso: isoFromParts(y, m0, d), inMonth: true });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [y, m0]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const displayWeekday = iso ? weekdayLabelForIso(iso) : '';

  const pick = (dayIso: string) => {
    onChange(formatEuDate(dayIso), dayIso);
    setOpen(false);
  };

  const shiftMonth = (delta: number) => {
    setView(prev => {
      const d = new Date(prev.y, prev.m0 + delta, 1);
      return { y: d.getFullYear(), m0: d.getMonth() };
    });
  };

  return (
    <div ref={rootRef} className="relative">
      {label && (
        <label className="block text-[10px] text-gray-500 mb-0.5">
          {label}
          {optional ? ' (opcional)' : ''}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 border rounded-lg px-2 py-1.5 text-sm text-left hover:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
          open ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-gray-300'
        }`}
      >
        <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="flex-1 truncate">
          {iso ? (
            <>
              <span className="font-semibold text-emerald-800">{displayWeekday}</span>
              <span className="text-gray-500"> · </span>
              <span>{formatEuDate(iso)}</span>
            </>
          ) : (
            <span className="text-gray-400">{optional ? 'Sem data' : 'Escolher dia…'}</span>
          )}
        </span>
      </button>
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}

      {open && (
        <div className="absolute z-20 mt-1 left-0 right-0 sm:right-auto sm:w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="p-1 rounded-lg hover:bg-gray-100"
              aria-label="Mês anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <p className="text-sm font-semibold text-gray-900">
              {MONTHS_PT[m0]} {y}
            </p>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="p-1 rounded-lg hover:bg-gray-100"
              aria-label="Mês seguinte"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map(w => (
              <div
                key={w}
                className={`text-center text-[10px] font-semibold py-1 ${
                  w === 'Sex' || w === 'Sáb' || w === 'Dom'
                    ? 'text-emerald-700'
                    : 'text-gray-500'
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((cell, i) => {
              if (!cell) {
                return <div key={`e-${i}`} className="h-8" />;
              }
              const dow = new Date(cell.iso + 'T12:00:00').getDay();
              const isWeekend = dow === 0 || dow === 5 || dow === 6; // Dom, Sex, Sáb
              const selected = cell.iso === iso;
              const isToday = cell.iso === todayIso;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => pick(cell.iso)}
                  className={`h-8 rounded-lg text-xs font-medium transition-colors ${
                    selected
                      ? 'bg-emerald-600 text-white'
                      : isToday
                        ? 'ring-1 ring-emerald-400 text-emerald-900'
                        : isWeekend
                          ? 'text-emerald-800 hover:bg-emerald-50'
                          : 'text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              className="text-[11px] text-emerald-700 hover:underline"
              onClick={() => pick(todayIso)}
            >
              Hoje
            </button>
            {optional && (
              <button
                type="button"
                className="text-[11px] text-gray-500 hover:underline"
                onClick={() => {
                  onChange('', '');
                  setOpen(false);
                }}
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
