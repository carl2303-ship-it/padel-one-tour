import { useEffect, useMemo, useState } from 'react';
import { X, Download, ImagePlus, Instagram, Loader2 } from 'lucide-react';
import type { Tournament, TournamentCategory, Player } from '../lib/supabase';
import { useCustomLogo } from '../lib/useCustomLogo';
import {
  buildRankingEntries,
  detectCategoryBand,
  detectPackGender,
  downloadAllImages,
  downloadDataUrl,
  fileToDataUrl,
  generateInstagramPack,
  resolvePackTheme,
  type GeneratedPackImage,
  type PackBand,
  type PackGender,
  type TeamLike,
} from '../lib/instagramPack';

type InstagramPackModalProps = {
  tournament: Tournament;
  categories: TournamentCategory[];
  teams: TeamLike[];
  players: Player[];
  defaultCategoryId?: string | null;
  onClose: () => void;
};

export default function InstagramPackModal({
  tournament,
  categories,
  teams,
  players,
  defaultCategoryId = null,
  onClose,
}: InstagramPackModalProps) {
  const { logoUrl } = useCustomLogo(tournament.user_id);
  const [categoryId, setCategoryId] = useState<string | null>(
    defaultCategoryId && defaultCategoryId !== 'no-category'
      ? defaultCategoryId
      : categories[0]?.id || null
  );
  const [genderOverride, setGenderOverride] = useState<PackGender | 'auto'>('auto');
  const [bandOverride, setBandOverride] = useState<PackBand | 'auto'>('auto');
  const [groupPhoto, setGroupPhoto] = useState<string | null>(null);
  const [winnersPhoto, setWinnersPhoto] = useState<string | null>(null);
  const [images, setImages] = useState<GeneratedPackImage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<{ incomplete: boolean; withPositions: number; total: number } | null>(null);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) || null,
    [categories, categoryId]
  );

  const detectedGender = useMemo(
    () => detectPackGender(selectedCategory, tournament),
    [selectedCategory, tournament]
  );

  const detectedBand = useMemo(
    () => detectCategoryBand(selectedCategory),
    [selectedCategory]
  );

  const activeTheme = useMemo(
    () =>
      resolvePackTheme({
        category: selectedCategory,
        tournament,
        genderOverride: genderOverride === 'auto' ? null : genderOverride,
        bandOverride: bandOverride === 'auto' ? null : bandOverride,
      }),
    [selectedCategory, tournament, genderOverride, bandOverride]
  );

  const previewRanking = useMemo(
    () =>
      buildRankingEntries({
        tournament,
        categoryId,
        teams,
        players,
      }),
    [tournament, categoryId, teams, players]
  );

  useEffect(() => {
    setImages([]);
    setStats(null);
    setError('');
  }, [categoryId, groupPhoto, winnersPhoto, genderOverride, bandOverride]);

  const handlePhoto = async (
    file: File | undefined,
    setter: (value: string | null) => void
  ) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Seleciona um ficheiro de imagem.');
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setter(dataUrl);
      setError('');
    } catch {
      setError('Não foi possível ler a imagem.');
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const result = await generateInstagramPack({
        tournament,
        category: selectedCategory,
        categoryId,
        teams,
        players,
        logoUrl,
        groupPhotoSrc: groupPhoto,
        winnersPhotoSrc: winnersPhoto,
        genderOverride: genderOverride === 'auto' ? null : genderOverride,
        bandOverride: bandOverride === 'auto' ? null : bandOverride,
      });
      setImages(result.images);
      setStats({
        incomplete: result.incomplete,
        withPositions: result.withPositions,
        total: result.total,
      });
    } catch (err) {
      console.error(err);
      setError('Erro ao gerar o pack. Tenta novamente.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadAll = async () => {
    if (images.length === 0) return;
    setDownloading(true);
    try {
      await downloadAllImages(images);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Instagram className="w-5 h-5 text-pink-600" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">Pack Instagram</h2>
              <p className="text-xs text-slate-500">PNG 1080×1350 prontos a publicar</p>
            </div>
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

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Categoria</label>
              <select
                value={categoryId || ''}
                onChange={(e) => setCategoryId(e.target.value || null)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Template / género</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { value: 'auto' as const, label: `Auto (${labelGender(detectedGender)})` },
                  { value: 'male' as const, label: 'Masculino' },
                  { value: 'female' as const, label: 'Feminino' },
                  { value: 'mixed' as const, label: 'Misto' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setGenderOverride(opt.value)}
                  className={`px-3 py-2.5 rounded-lg text-sm font-semibold border transition ${
                    genderOverride === opt.value
                      ? 'border-pink-600 bg-pink-50 text-pink-800'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Faixa de níveis</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { value: 'auto' as const, label: `Auto (${detectedBand})` },
                  { value: '1-2' as const, label: '1–2' },
                  { value: '2-4' as const, label: '2–4' },
                  { value: '4-6' as const, label: '4–6' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setBandOverride(opt.value)}
                  className={`px-3 py-2.5 rounded-lg text-sm font-semibold border transition ${
                    bandOverride === opt.value
                      ? 'border-orange-500 bg-orange-50 text-orange-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div
              className="mt-3 rounded-xl overflow-hidden border border-slate-200"
              style={{
                background: `linear-gradient(135deg, ${activeTheme.top}, ${activeTheme.mid} 45%, ${activeTheme.bottom})`,
              }}
            >
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-white font-bold text-sm drop-shadow">{activeTheme.label}</div>
                  <div className="text-white/80 text-xs drop-shadow">
                    {selectedCategory?.name || 'Sem categoria'}
                    {selectedCategory?.min_level != null || selectedCategory?.max_level != null
                      ? ` · rating ${selectedCategory.min_level ?? '?'}–${selectedCategory.max_level ?? '?'}`
                      : ''}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {[activeTheme.top, activeTheme.mid, activeTheme.accent, activeTheme.bottom].map((c) => (
                    <span
                      key={c}
                      className="w-6 h-6 rounded-full border border-white/40 shadow-sm"
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {(previewRanking.withPositions === 0 || previewRanking.incomplete) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {previewRanking.withPositions === 0
                ? 'Ainda não há posições finais nesta categoria. Finaliza o torneio primeiro para preencher o pódio e a classificação.'
                : `Só ${previewRanking.withPositions} de ${previewRanking.total} têm posição final. O pack usa as posições já gravadas.`}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <PhotoUpload
              label="Foto de grupo"
              preview={groupPhoto}
              onPick={(file) => handlePhoto(file, setGroupPhoto)}
              onClear={() => setGroupPhoto(null)}
            />
            <PhotoUpload
              label="Foto dos vencedores"
              preview={winnersPhoto}
              onPick={(file) => handlePhoto(file, setWinnersPhoto)}
              onClear={() => setWinnersPhoto(null)}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {images.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  Preview ({images.length} imagens)
                </h3>
                {stats && (
                  <span className="text-xs text-slate-500">
                    {stats.withPositions}/{stats.total} com posição
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {images.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => downloadDataUrl(img.dataUrl, img.filename)}
                    className="group text-left"
                    title={`Descarregar ${img.label}`}
                  >
                    <div className="aspect-[1080/1350] rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                      <img src={img.dataUrl} alt={img.label} className="w-full h-full object-cover" />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      <span className="text-xs font-medium text-slate-700 truncate">{img.label}</span>
                      <Download className="w-3.5 h-3.5 text-slate-400 group-hover:text-pink-600 shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-5 py-4 flex flex-col sm:flex-row gap-2 sm:justify-end bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-slate-700 hover:bg-slate-200 transition text-sm font-medium"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-pink-600 text-white hover:bg-pink-700 transition text-sm font-semibold disabled:opacity-60"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Instagram className="w-4 h-4" />}
            {generating ? 'A gerar...' : images.length ? 'Gerar novamente' : 'Gerar pack'}
          </button>
          {images.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadAll}
              disabled={downloading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition text-sm font-semibold disabled:opacity-60"
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {downloading ? 'A descarregar...' : 'Descarregar tudo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function labelGender(g: PackGender): string {
  if (g === 'male') return 'Masculino';
  if (g === 'female') return 'Feminino';
  return 'Misto';
}

function PhotoUpload({
  label,
  preview,
  onPick,
  onClear,
}: {
  label: string;
  preview: string | null;
  onPick: (file: File | undefined) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
      <div className="text-sm font-medium text-slate-700 mb-2">{label}</div>
      {preview ? (
        <div className="relative">
          <img src={preview} alt={label} className="w-full h-36 object-cover rounded-lg" />
          <button
            type="button"
            onClick={onClear}
            className="absolute top-2 right-2 px-2 py-1 text-xs rounded-md bg-black/70 text-white"
          >
            Remover
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center h-36 rounded-lg cursor-pointer hover:bg-slate-100 transition">
          <ImagePlus className="w-7 h-7 text-slate-400 mb-1" />
          <span className="text-xs text-slate-500">Carregar foto</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
        </label>
      )}
    </div>
  );
}
