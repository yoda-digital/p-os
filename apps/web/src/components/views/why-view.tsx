import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type WhyExplanation } from '../../lib/api';
import { Button } from '../common/button';
import { Textarea } from '../common/textarea';
import { Badge } from '../common/badge';
import { HelpCircle, Search, ChevronRight, Clock, User, Link2 } from 'lucide-react';

type QuestionType =
  | 'blocked' | 'not_ready' | 'active' | 'done' | 'failed'
  | 'this_agent' | 'this_model' | 'this_task' | 'changed' | 'requires_me';

const QUESTION_TYPES: QuestionType[] = [
  'blocked', 'not_ready', 'active', 'done', 'failed',
  'this_agent', 'this_model', 'this_task', 'changed', 'requires_me',
];

export function WhyView() {
  const { t, i18n } = useTranslation('why');
  const { caseId } = useParams<{ caseId: string }>();
  const [question, setQuestion] = useState('');
  const [selectedType, setSelectedType] = useState<QuestionType | null>(null);
  const [moveId, setMoveId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WhyExplanation | null>(null);
  const [error, setError] = useState('');

  const handleAsk = async () => {
    if (!question.trim() || !caseId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.explainWhy(caseId, question, moveId || undefined);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error_fallback'));
    } finally {
      setLoading(false);
    }
  };

  const handlePreset = (type: QuestionType) => {
    setSelectedType(type);
    setQuestion(t(`presets.${type}`));
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <HelpCircle className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('title')}</h2>
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        {t('intro')}
      </p>

      {/* 10 preset question type buttons */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">{t('question_types')}</h3>
        <div className="flex flex-wrap gap-2">
          {QUESTION_TYPES.map(type => (
            <button
              key={type}
              onClick={() => handlePreset(type)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                selectedType === type
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-600 dark:text-emerald-400'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {t(`presets.${type}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Move ID input */}
      <div className="mb-4">
        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1">{t('move_id_label')}</label>
        <input
          type="text"
          value={moveId}
          onChange={(e) => setMoveId(e.target.value)}
          placeholder={t('move_id_placeholder')}
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
        />
      </div>

      {/* Question input */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('input_placeholder')}
            className="min-h-[60px]"
          />
        </div>
        <Button onClick={handleAsk} loading={loading} disabled={!question.trim()} className="self-end">
          <Search className="w-4 h-4" /> {t('ask')}
        </Button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 p-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{result.question}</h3>
            {result.question_type && (
              <Badge variant="info">{t(`presets.${result.question_type}`, { defaultValue: result.question_type })}</Badge>
            )}
          </div>

          {/* Deterministic indicator */}
          {result.deterministic !== undefined && (
            <div className="mb-4">
              <Badge variant={result.deterministic ? 'success' : 'warning'}>
                {result.deterministic ? t('result.deterministic') : t('result.heuristic')}
              </Badge>
            </div>
          )}

          {/* Causal Chain Visualization */}
          {result.causal_chain.length > 0 && (
            <div className="mb-6">
              <h4 className="text-xs font-semibold uppercase text-slate-500 tracking-wider mb-3">{t('result.causal_chain')}</h4>
              <div className="space-y-1">
                {result.causal_chain.map((node, i) => (
                  <div key={`${node.id}-${i}`}>
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 shadow ${
                          i === 0 ? 'bg-emerald-500' : 'bg-slate-400'
                        }`} />
                        {i < result.causal_chain.length - 1 && <div className="w-0.5 h-8 bg-slate-200 dark:bg-slate-700" />}
                      </div>
                      <div className="flex-1 pb-2 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="info">{node.type}</Badge>
                          <span className="text-xs text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(node.timestamp).toLocaleString(i18n.language)}
                          </span>
                          {node.actor_id && (
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {node.actor_id.slice(0, 8)}...
                            </span>
                          )}
                          {node.caused_by && (
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <Link2 className="w-3 h-3" />
                              {t('result.caused_by')}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{node.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Explanation */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <h4 className="text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">{t('result.explanation')}</h4>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{result.explanation}</p>
          </div>
        </div>
      )}
    </div>
  );
}
