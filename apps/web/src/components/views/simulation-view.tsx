import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSimulations } from '../../hooks/use-timeline';
import { api } from '../../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { Dialog } from '../common/dialog';
import { Input } from '../common/input';
import { Textarea } from '../common/textarea';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import {
  FlaskConical, Plus, GitFork, Clock, ArrowLeftRight, Check, X,
  Plus as PlusIcon, Minus, PenLine,
} from 'lucide-react';

interface SimComparison {
  simulation_id: string;
  differences: Array<{
    type: 'added' | 'removed' | 'modified';
    entity_type: string;
    entity_id: string;
    field?: string;
    canonical: unknown;
    simulated: unknown;
  }>;
}

export function SimulationView() {
  const { t, i18n } = useTranslation('simulation');
  const { t: tCommon } = useTranslation('common');
  const { caseId } = useParams<{ caseId: string }>();
  const { data: simulations, isLoading } = useSimulations(caseId);
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  // Comparison state
  const [comparingId, setComparingId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<SimComparison | null>(null);
  const [comparing, setComparing] = useState(false);

  // Apply hypothetical events
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [eventType, setEventType] = useState('MoveCreated');
  const [eventData, setEventData] = useState('');

  // Adoption state
  const [adopting, setAdopting] = useState(false);

  if (isLoading) return <FullPageSpinner />;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseId) return;
    setCreating(true);
    try {
      await api.createSimulation(caseId, {
        title,
        description: description || undefined,
        hypothetical_changes: [],
      });
      qc.invalidateQueries({ queryKey: ['simulations', caseId] });
      setTitle('');
      setDescription('');
      setCreateOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const handleCompare = async (simId: string) => {
    setComparingId(simId);
    setComparing(true);
    try {
      const res = await api.compareSimulation(simId);
      setComparison(res as unknown as SimComparison);
    } catch {
      setComparison(null);
    } finally {
      setComparing(false);
    }
  };

  const handleApplyEvent = async (simId: string) => {
    if (!eventData.trim()) return;
    try {
      const data = JSON.parse(eventData);
      await api.applySimulationEvents(simId, [{ type: eventType, data }]);
      qc.invalidateQueries({ queryKey: ['simulations', caseId] });
      setEventData('');
      setApplyingId(null);
    } catch (err) {
      // Invalid JSON or API error
    }
  };

  const handleAdopt = async (simId: string) => {
    setAdopting(true);
    try {
      await api.adoptSimulation(simId, true);
      qc.invalidateQueries({ queryKey: ['simulations', caseId] });
    } finally {
      setAdopting(false);
    }
  };

  const presets = [
    t('presets.deadline'),
    t('presets.unavailable'),
    t('presets.strategy_b'),
    t('presets.budget'),
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('title')}</h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> {t('new_simulation')}
        </Button>
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        {t('intro')}
      </p>

      {/* Presets */}
      <div className="flex flex-wrap gap-2 mb-6">
        {presets.map(p => (
          <button
            key={p}
            onClick={() => { setTitle(p); setCreateOpen(true); }}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>

      {(!simulations || simulations.length === 0) ? (
        <EmptyState
          icon={<FlaskConical className="w-12 h-12" />}
          title={t('empty.title')}
          description={t('empty.description')}
          action={{ label: t('empty.action'), onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="space-y-4">
          {simulations.map((sim: any) => (
            <div key={sim.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <GitFork className="w-4 h-4 text-purple-500" />
                  <h3 className="text-base font-medium text-slate-900 dark:text-white">{sim.title}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={sim.status === 'adopted' ? 'success' : 'purple'}>
                    {sim.status === 'adopted' ? t('card.adopted') : t('card.badge')}
                  </Badge>
                </div>
              </div>

              {sim.description && <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{sim.description}</p>}

              {/* Hypothetical changes summary */}
              {Array.isArray(sim.hypothetical_changes) && sim.hypothetical_changes.length > 0 && (
                <div className="mb-3">
                  <h4 className="text-xs font-semibold text-slate-500 mb-1">{t('card.changes_title')}</h4>
                  <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    {sim.hypothetical_changes.slice(0, 5).map((c: any, i: number) => (
                      <li key={i}>{typeof c === 'string' ? c : c.type ?? c.description ?? JSON.stringify(c)}</li>
                    ))}
                    {sim.hypothetical_changes.length > 5 && (
                      <li className="text-slate-400">...{sim.hypothetical_changes.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-3">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(sim.created_at).toLocaleString(i18n.language)}</span>
                {sim.status !== 'adopted' && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setApplyingId(applyingId === sim.id ? null : sim.id)}>
                      <Plus className="w-3 h-3" /> {t('card.add_event')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => handleCompare(sim.id)} loading={comparing && comparingId === sim.id}>
                      <ArrowLeftRight className="w-3 h-3" /> {t('card.compare')}
                    </Button>
                    <Button size="sm" onClick={() => handleAdopt(sim.id)} loading={adopting}>
                      <Check className="w-3 h-3" /> {t('card.adopt')}
                    </Button>
                  </>
                )}
              </div>

              {/* Apply event panel */}
              {applyingId === sim.id && sim.status !== 'adopted' && (
                <div className="mt-4 bg-slate-50 dark:bg-slate-800 rounded-lg p-3 space-y-2">
                  <Input
                    label={t('apply.type_label')}
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                    placeholder="MoveCreated"
                  />
                  <Textarea
                    label={t('apply.data_label')}
                    value={eventData}
                    onChange={(e) => setEventData(e.target.value)}
                    placeholder='{"id": "...", "title": "New hypothetical move"}'
                    className="min-h-[60px] font-mono text-xs"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleApplyEvent(sim.id)}>{t('apply.submit')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setApplyingId(null)}>{tCommon('actions.cancel')}</Button>
                  </div>
                </div>
              )}

              {/* Comparison panel */}
              {comparingId === sim.id && comparison && (
                <div className="mt-4 bg-purple-50 dark:bg-purple-900/10 rounded-lg p-3">
                  <h4 className="text-xs font-semibold text-purple-700 dark:text-purple-300 mb-2">
                    {t('compare.title', { count: comparison.differences.length })}
                  </h4>
                  {comparison.differences.length === 0 ? (
                    <p className="text-sm text-slate-400">{t('compare.no_diff')}</p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {comparison.differences.map((diff, i) => (
                        <div key={i} className="bg-white dark:bg-slate-900 rounded border border-purple-200 dark:border-purple-800 p-2 text-xs">
                          <div className="flex items-center gap-2 mb-1">
                            {diff.type === 'added' && <PlusIcon className="w-3 h-3 text-emerald-500" />}
                            {diff.type === 'removed' && <Minus className="w-3 h-3 text-red-500" />}
                            {diff.type === 'modified' && <PenLine className="w-3 h-3 text-amber-500" />}
                            <Badge variant={diff.type === 'added' ? 'success' : diff.type === 'removed' ? 'danger' : 'warning'}>{diff.type}</Badge>
                            <span className="text-slate-500">{diff.entity_type}</span>
                            <span className="text-slate-400 font-mono">{diff.entity_id.slice(0, 8)}...</span>
                            {diff.field && <span className="text-slate-500">.{diff.field}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('create.title')}>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label={t('create.title_label')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('create.title_placeholder')} required autoFocus />
          <Textarea label={t('create.description_label')} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('create.description_placeholder')} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>{tCommon('actions.cancel')}</Button>
            <Button type="submit" loading={creating}>{t('create.submit')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
