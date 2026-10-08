import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, ImagePlus, Loader2, Save, X } from 'lucide-react';
import type { Tournament, TournamentCategory } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import { useCustomLogo } from '../lib/useCustomLogo';
import {
  buildRegistrationUrl,
  buildWhatsAppCaption,
  dataUrlToFile,
  downloadDataUrl,
  generateTournamentPoster,
} from '../lib/tournamentPoster';
import { formatTournamentDate } from '../lib/instagramPack';

type Props = {
  tournament: Tournament;
  categories: TournamentCategory[];
  clubName?: string | null;
  clubLogoUrl?: string | null;
  onClose: () => void;
  onApplied?: (imageUrl: string) => void;
};

export default function TournamentPosterModal({
  tournament,
  categories,
  clubName = null,
  clubLogoUrl = null,
  onClose,
  onApplied,
}: Props) {
  const { logoUrl: organizerLogo } = useCustomLogo(tournament.user_id);
  const [preview, setPreview] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const effectiveLogo = clubLogoUrl || organizerLogo;
  const effectiveClub =
    clubName?.trim() ||
    (tournament as { club_name?: string | null }).club_name ||
    'Padel One';

  const registrationUrl = buildRegistrationUrl(tournament.id);
  const dateLabel = formatTournamentDate(tournament);

  const categoryInputs = useMemo(
    () =>
      categories.map((c) => ({
        name: c.name,
        accepted_levels: c.accepted_levels,
        min_level: c.min_level,
        max_level: c.max_level,
      })),
    [categories]
  );

  const waCaption = buildWhatsAppCaption({
    tournamentName: tournament.name,
    clubName: effectiveClub,
    registrationUrl,
    dateLabel,
  });

  const regenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const dataUrl = await generateTournamentPoster({
        tournamentName: tournament.name,
        clubName: effectiveClub,
        logoUrl: effectiveLogo,
        startDate: tournament.start_date,
        endDate: tournament.end_date,
        startTime:
          (tournament as { daily_start_time?: string | null }).daily_start_time ||
          (tournament as { start_time?: string | null }).start_time ||
          null,
        endTime:
          (tournament as { daily_end_time?: string | null }).daily_end_time ||
          (tournament as { end_time?: string | null }).end_time ||
          null,
        categories: categoryInputs,
        gender: (tournament as { gender?: string | null }).gender || null,
        memberPrice: (tournament as { member_price?: number | null }).member_price ?? null,
        nonMemberPrice: (tournament as { non_member_price?: number | null }).non_member_price ?? null,
        description: tournament.description || null,
        registrationUrl,
      });
      setPreview(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar cartaz');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    void regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.id, effectiveLogo, effectiveClub, categories.length]);

  const handleDownload = () => {
    if (!preview) return;
    const safe = tournament.name.replace(/[^\w\-]+/g, '_').slice(0, 40);
    downloadDataUrl(preview, `cartaz_${safe}.png`);
  };

  const handleCopyWa = async () => {
    try {
      await navigator.clipboard.writeText(waCaption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Não foi possível copiar. Copia o link manualmente.');
    }
  };

  const handleApply = async () => {
    if (!preview) return;
    setSaving(true);
    setError('');
    try {
      const file = dataUrlToFile(preview, `poster-${tournament.id}-${Date.now()}.png`);
      const path = `${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('tournament-images')
        .upload(path, file, { contentType: 'image/png', upsert: true });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('tournament-images').getPublicUrl(path);

      const { error: updateError } = await supabase
        .from('tournaments')
        .update({ image_url: publicUrl })
        .eq('id', tournament.id);
      if (updateError) throw updateError;

      onApplied?.(publicUrl);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao guardar cartaz');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between p-4 border-b sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Cartaz do torneio</h2>
            <p className="text-xs text-gray-500 mt-1">
              App Padel1 + WhatsApp (QR + texto com link clicável)
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-xl">{error}</div>
          )}

          <div className="rounded-xl overflow-hidden border bg-gray-50 min-h-[280px] flex items-center justify-center">
            {generating || !preview ? (
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            ) : (
              <img src={preview} alt="Cartaz" className="w-full h-auto" />
            )}
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-900 space-y-1">
            <p>
              No WhatsApp a <strong>imagem não é clicável</strong>. O cartaz tem QR code; ao partilhar,
              cola também a mensagem com o link.
            </p>
            <p className="font-mono break-all text-[11px] text-amber-800">{registrationUrl}</p>
          </div>

          <p className="text-xs text-gray-500">
            Clube: <strong>{effectiveClub}</strong>
            {tournament.description
              ? ' · Usa a descrição das definições (formato, prémios, incluído)'
              : ''}
          </p>
        </div>

        <div className="flex flex-col gap-2 p-4 border-t sticky bottom-0 bg-white">
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => void regenerate()}
              disabled={generating}
              className="flex-1 px-4 py-2.5 rounded-xl border font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              Regenerar
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!preview || generating}
              className="flex-1 px-4 py-2.5 rounded-xl border font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Descarregar PNG
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => void handleCopyWa()}
              className="flex-1 px-4 py-2.5 rounded-xl border font-medium flex items-center justify-center gap-2"
            >
              <Copy className="w-4 h-4" />
              {copied ? 'Mensagem WA copiada!' : 'Copiar texto + link (WA)'}
            </button>
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={!preview || generating || saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Usar no torneio
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
