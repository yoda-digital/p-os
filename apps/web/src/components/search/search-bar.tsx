import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Search, X, FileText, GitBranch, Scale, Shield, Box, MessageSquare, Target, BookOpen } from 'lucide-react';
import { api } from '../../lib/api';
import { Badge } from '../common/badge';

interface SearchResult {
  id: string;
  type: string;
  title: string;
  description: string | null;
  case_id: string | null;
  relevance: number;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  case: <FileText className="w-3.5 h-3.5" />,
  move: <GitBranch className="w-3.5 h-3.5" />,
  decision: <Scale className="w-3.5 h-3.5" />,
  evidence: <Shield className="w-3.5 h-3.5" />,
  entity: <Box className="w-3.5 h-3.5" />,
  assertion: <MessageSquare className="w-3.5 h-3.5" />,
  intent: <Target className="w-3.5 h-3.5" />,
  rule: <BookOpen className="w-3.5 h-3.5" />,
};

export function SearchBar() {
  const { t } = useTranslation('search');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doSearch = useCallback(async (q: string, type: string) => {
    if (!q.trim() && !type) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (type) params.set('type', type);
      params.set('limit', '15');
      const res = await api.search(params.toString());
      setResults((res as SearchResponse).results ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (val: string) => {
    setQuery(val);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val, typeFilter), 250);
  };

  const handleTypeFilter = (type: string) => {
    const next = typeFilter === type ? '' : type;
    setTypeFilter(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSearch(query, next);
  };

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setQuery('');
    if (result.type === 'case') {
      navigate(`/cases/${result.id}/kanban`);
    } else if (result.case_id) {
      navigate(`/cases/${result.case_id}/kanban`);
    }
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const types = ['case', 'move', 'decision', 'evidence', 'entity', 'intent', 'rule'];

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-1.5">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={t('placeholder')}
          className="bg-transparent text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 outline-none w-48 lg:w-64"
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <kbd className="hidden sm:inline-flex text-[10px] text-slate-400 border border-slate-300 dark:border-slate-600 rounded px-1 py-0.5 leading-none">
          {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}K
        </kbd>
      </div>

      {/* Dropdown */}
      {open && (query.trim() || typeFilter) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 min-w-[320px] max-h-[400px] overflow-hidden">
          {/* Type filters */}
          <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            {types.map(tp => (
              <button
                key={tp}
                onClick={() => handleTypeFilter(tp)}
                className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md border transition-colors ${
                  typeFilter === tp
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-600 dark:text-emerald-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {TYPE_ICONS[tp]}
                {t(`types.${tp}`)}
              </button>
            ))}
          </div>

          {/* Results */}
          <div className="max-h-[320px] overflow-y-auto scrollbar-thin">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">{t('searching')}</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">{t('no_results')}</div>
            ) : (
              results.map((r) => (
                <button
                  key={`${r.type}-${r.id}`}
                  onClick={() => handleSelect(r)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-start gap-3"
                >
                  <div className="mt-0.5 text-slate-400">{TYPE_ICONS[r.type] ?? <Box className="w-3.5 h-3.5" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{r.title}</span>
                      <Badge variant="neutral">{t(`types.${r.type}`)}</Badge>
                    </div>
                    {r.description && (
                      <p className="text-xs text-slate-400 truncate mt-0.5">{r.description}</p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
