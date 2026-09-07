import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type WhyExplanation } from '../../lib/api';
import { Button } from '../common/button';
import { Textarea } from '../common/textarea';
import { Badge } from '../common/badge';
import { HelpCircle, ArrowDown, Search } from 'lucide-react';

export function WhyView() {
  const { caseId } = useParams<{ caseId: string }>();
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WhyExplanation | null>(null);
  const [error, setError] = useState('');

  const handleAsk = async () => {
    if (!question.trim() || !caseId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.explainWhy(caseId, question);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get explanation');
    } finally {
      setLoading(false);
    }
  };

  const presetQuestions = [
    'WHY is this move blocked?',
    'WHY is this move not ready?',
    'WHY does this require my attention?',
    'WHY is evidence stale?',
    'WHY was this decision deferred?',
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <HelpCircle className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">WHY Explorer</h2>
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Ask why any state exists. The system traces the causal chain through process history.
      </p>

      {/* Preset questions */}
      <div className="flex flex-wrap gap-2 mb-4">
        {presetQuestions.map(q => (
          <button
            key={q}
            onClick={() => setQuestion(q)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Question input */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="WHY is [move/state/decision] in [condition]?"
            className="min-h-[60px]"
          />
        </div>
        <Button onClick={handleAsk} loading={loading} disabled={!question.trim()} className="self-end">
          <Search className="w-4 h-4" /> Ask
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
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">{result.question}</h3>

          {/* Causal Chain */}
          {result.causal_chain.length > 0 && (
            <div className="mb-6">
              <h4 className="text-xs font-semibold uppercase text-slate-500 tracking-wider mb-3">Causal Chain</h4>
              <div className="space-y-2">
                {result.causal_chain.map((node, i) => (
                  <div key={node.id}>
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900 shadow" />
                        {i < result.causal_chain.length - 1 && <div className="w-0.5 h-8 bg-slate-200 dark:bg-slate-700" />}
                      </div>
                      <div className="flex-1 pb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="info">{node.type}</Badge>
                          <span className="text-xs text-slate-400">{new Date(node.timestamp).toLocaleString()}</span>
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
            <h4 className="text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">Explanation</h4>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{result.explanation}</p>
          </div>
        </div>
      )}
    </div>
  );
}
