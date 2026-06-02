import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/authContext';
import {
  Upload,
  FileText,
  Phone,
  Check,
  X,
  AlertTriangle,
  Users,
  Trash2,
  Loader2,
} from 'lucide-react';

type ImportContactsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
};

type ParsedContact = {
  id: string;
  name: string;
  phone: string;
  email: string;
  phoneValid: boolean;
};

type ImportResult = {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type Step = 'input' | 'preview' | 'importing' | 'results';
type Tab = 'paste' | 'csv';

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.length >= 9 && !cleaned.startsWith('+')) {
    cleaned = '+351' + cleaned;
  }
  return cleaned;
}

function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return /^\+\d{10,15}$/.test(normalized);
}

function generateNameFromPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  const last4 = normalized.slice(-4);
  return `Contacto ${last4}`;
}

const CSV_NAME_HEADERS = ['nome', 'name', 'jogador', 'player', 'contacto', 'contact'];
const CSV_PHONE_HEADERS = ['telefone', 'phone', 'telemovel', 'telemóvel', 'phone_number', 'numero', 'número', 'cel', 'celular', 'mobile'];
const CSV_EMAIL_HEADERS = ['email', 'e-mail', 'correio', 'mail'];

function detectColumn(header: string, candidates: string[]): boolean {
  const h = header.toLowerCase().trim();
  return candidates.some((c) => h === c || h.includes(c));
}

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',' || ch === ';') {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current.trim());
    return result;
  });
}

export default function ImportContactsModal({
  isOpen,
  onClose,
  onImported,
}: ImportContactsModalProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('input');
  const [tab, setTab] = useState<Tab>('paste');
  const [pasteText, setPasteText] = useState('');
  const [contacts, setContacts] = useState<ParsedContact[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const resetState = () => {
    setStep('input');
    setTab('paste');
    setPasteText('');
    setContacts([]);
    setResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const parsePasteInput = () => {
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setError('Nenhum contacto encontrado. Cole pelo menos um número por linha.');
      return;
    }

    const parsed: ParsedContact[] = lines.map((line, i) => {
      const separatorMatch = line.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      let name = '';
      let phone = '';

      if (separatorMatch) {
        const left = separatorMatch[1].trim();
        const right = separatorMatch[2].trim();
        const leftIsPhone = /^[\d\s+\-()]{7,}$/.test(left);
        const rightIsPhone = /^[\d\s+\-()]{7,}$/.test(right);

        if (rightIsPhone && !leftIsPhone) {
          name = left;
          phone = right;
        } else if (leftIsPhone && !rightIsPhone) {
          name = right;
          phone = left;
        } else {
          name = left;
          phone = right;
        }
      } else {
        phone = line;
      }

      phone = normalizePhone(phone);
      if (!name) {
        name = generateNameFromPhone(phone);
      }

      return {
        id: `paste-${i}`,
        name,
        phone,
        email: '',
        phoneValid: isValidPhone(phone),
      };
    });

    setContacts(parsed);
    setError('');
    setStep('preview');
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text?.trim()) {
        setError('O ficheiro está vazio.');
        return;
      }

      const rows = parseCSV(text);
      if (rows.length < 2) {
        setError('O ficheiro CSV precisa de pelo menos um cabeçalho e uma linha de dados.');
        return;
      }

      const headers = rows[0];
      let nameIdx = -1;
      let phoneIdx = -1;
      let emailIdx = -1;

      headers.forEach((h, i) => {
        if (nameIdx === -1 && detectColumn(h, CSV_NAME_HEADERS)) nameIdx = i;
        if (phoneIdx === -1 && detectColumn(h, CSV_PHONE_HEADERS)) phoneIdx = i;
        if (emailIdx === -1 && detectColumn(h, CSV_EMAIL_HEADERS)) emailIdx = i;
      });

      if (nameIdx === -1 && phoneIdx === -1) {
        setError(
          'Não foi possível detetar colunas de nome ou telefone. Use cabeçalhos como "Nome", "Telefone" ou "Email".'
        );
        return;
      }

      const parsed: ParsedContact[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rawName = nameIdx >= 0 ? row[nameIdx]?.trim() || '' : '';
        const rawPhone = phoneIdx >= 0 ? row[phoneIdx]?.trim() || '' : '';
        const rawEmail = emailIdx >= 0 ? row[emailIdx]?.trim() || '' : '';

        if (!rawName && !rawPhone) continue;

        const phone = rawPhone ? normalizePhone(rawPhone) : '';
        const name = rawName || (phone ? generateNameFromPhone(phone) : `Contacto ${i}`);

        parsed.push({
          id: `csv-${i}`,
          name,
          phone,
          email: rawEmail,
          phoneValid: phone ? isValidPhone(phone) : true,
        });
      }

      if (parsed.length === 0) {
        setError('Nenhum contacto válido encontrado no ficheiro.');
        return;
      }

      setContacts(parsed);
      setError('');
      setStep('preview');
    };
    reader.readAsText(file);
  };

  const removeContact = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  };

  const handleImport = async () => {
    if (!user?.id) {
      setError('É necessário estar autenticado para importar contactos.');
      return;
    }

    if (contacts.length === 0) {
      setError('Nenhum contacto para importar.');
      return;
    }

    setStep('importing');
    setError('');

    const importResult: ImportResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    const BATCH_SIZE = 50;
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      const rows = batch.map((c) => ({
        organizer_id: user.id,
        name: c.name.trim(),
        phone_number: c.phone || null,
        email: c.email || null,
      }));

      const { data, error: upsertError } = await supabase
        .from('organizer_players')
        .upsert(rows, {
          onConflict: 'organizer_id,name',
          ignoreDuplicates: false,
        })
        .select('id');

      if (upsertError) {
        importResult.errors.push(upsertError.message);
        importResult.skipped += batch.length;
      } else {
        importResult.imported += data?.length ?? batch.length;
      }
    }

    setResult(importResult);
    setStep('results');

    if (importResult.imported > 0 || importResult.updated > 0) {
      onImported();
    }
  };

  const validCount = contacts.filter((c) => c.phoneValid || !c.phone).length;
  const invalidCount = contacts.filter((c) => c.phone && !c.phoneValid).length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">Importar Contactos</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Step: Input */}
          {step === 'input' && (
            <>
              {/* Tabs */}
              <div className="flex gap-2 mb-6">
                <button
                  type="button"
                  onClick={() => setTab('paste')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors ${
                    tab === 'paste'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Phone className="w-4 h-4" />
                  Colar Lista
                </button>
                <button
                  type="button"
                  onClick={() => setTab('csv')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors ${
                    tab === 'csv'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  Ficheiro CSV
                </button>
              </div>

              {tab === 'paste' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Cole os contactos (um por linha)
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Formatos aceites: apenas número, ou "Nome - Número". Ex: João Silva - 912345678
                    </p>
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={10}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm"
                      placeholder={`912345678\nMaria Santos - 963456789\n+351 934 567 890\nPedro Costa - +351912345678`}
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={parsePasteInput}
                      disabled={!pasteText.trim()}
                      className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Pré-visualizar
                    </button>
                  </div>
                </div>
              )}

              {tab === 'csv' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Carregar ficheiro CSV
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      O ficheiro deve ter colunas como "Nome", "Telefone", "Email" (PT ou EN). Separador: vírgula ou ponto e vírgula.
                    </p>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                    >
                      <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                      <p className="text-sm text-gray-600 font-medium">
                        Clique para selecionar um ficheiro CSV
                      </p>
                      <p className="text-xs text-gray-400 mt-1">.csv</p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleCSVUpload}
                      className="hidden"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-full px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </>
          )}

          {/* Step: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">{contacts.length}</span> contacto(s) encontrado(s)
                  </p>
                  {invalidCount > 0 && (
                    <p className="text-xs text-amber-600 mt-0.5">
                      {invalidCount} com telefone inválido (serão importados na mesma)
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStep('input');
                    setContacts([]);
                  }}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  Voltar
                </button>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[40vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-gray-600 font-medium">Nome</th>
                        <th className="text-left px-4 py-2.5 text-gray-600 font-medium">Telefone</th>
                        <th className="text-left px-4 py-2.5 text-gray-600 font-medium">Email</th>
                        <th className="w-10 px-2 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {contacts.map((c) => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-900">{c.name}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              {c.phone ? (
                                <>
                                  {c.phoneValid ? (
                                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                                  ) : (
                                    <X className="w-4 h-4 text-red-500 flex-shrink-0" />
                                  )}
                                  <span className={c.phoneValid ? 'text-gray-900' : 'text-red-600'}>
                                    {c.phone}
                                  </span>
                                </>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-gray-700">
                            {c.email || <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-2 py-2.5">
                            <button
                              type="button"
                              onClick={() => removeContact(c.id)}
                              className="p-1 hover:bg-red-50 rounded transition-colors text-gray-400 hover:text-red-500"
                              title="Remover"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {contacts.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <p>Todos os contactos foram removidos.</p>
                  <button
                    type="button"
                    onClick={() => setStep('input')}
                    className="text-blue-600 hover:text-blue-800 font-medium mt-2"
                  >
                    Voltar ao início
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('input');
                      setContacts([]);
                    }}
                    className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleImport}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Importar {contacts.length} Contacto(s)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step: Importing */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
              <p className="text-gray-600 font-medium">A importar contactos...</p>
            </div>
          )}

          {/* Step: Results */}
          {step === 'results' && result && (
            <div className="space-y-6">
              <div className="text-center py-4">
                {result.errors.length === 0 ? (
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 mb-3">
                    <Check className="w-7 h-7 text-green-600" />
                  </div>
                ) : (
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 mb-3">
                    <AlertTriangle className="w-7 h-7 text-amber-600" />
                  </div>
                )}
                <h3 className="text-lg font-semibold text-gray-900">
                  Importação Concluída
                </h3>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-green-700">{result.imported}</p>
                  <p className="text-sm text-green-600">Importados / Atualizados</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-blue-700">{result.updated}</p>
                  <p className="text-sm text-blue-600">Atualizados</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-gray-700">{result.skipped}</p>
                  <p className="text-sm text-gray-500">Ignorados</p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-red-800 mb-2">Erros:</p>
                  <ul className="text-sm text-red-700 space-y-1">
                    {result.errors.map((err, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <X className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        {err}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                onClick={handleClose}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
