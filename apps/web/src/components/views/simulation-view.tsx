import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSimulations } from '../../hooks/use-timeline';
import { api, type CreateSimulationInput } from '../../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { Dialog } from '../common/dialog';
import { Input } from '../common/input';
import { Textarea } from '../common/textarea';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { FlaskConical, Plus, GitFork, Clock } from 'lucide-react';

export function SimulationView() {
  const { t, i18n } = useTranslation('simulation');
  const { t: tCommon } = useTranslation('common');
  const { caseId } = useParams<{ caseId: string }>();
  const { data: simulations, isLoading } = useSimulations(caseId);
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [changes, setChanges] = useState('');
  const [creating, setCreating] = useState(false);

  if (isLoading) return <FullPageSpinner />;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseId) return;
    setCreating(true);
    try {
      await api.createSimulation(caseId, {
        title,
        description: description || undefined,
        hypothetical_changes: changes.split('\n').filter(Boolean).map(c => ({ description: c })),
      });
      qc.invalidateQueries({ queryKey: ['simulations', caseId] });
      setTitle('');
      setDescription('');
      setChanges('');
      setCreateOpen(false);
    } finally {
      setCreating(false);
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
          {simulations.map(sim => (
            <div key={sim.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <GitFork className="w-4 h-4 text-purple-500" />
                  <h3 className="text-base font-medium text-slate-900 dark:text-white">{sim.title}</h3>
                </div>
                <Badge variant="purple">{t('card.badge')}</Badge>
              </div>
              {sim.description && <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{sim.description}</p>}
              {Array.isArray(sim.hypothetical_changes) && sim.hypothetical_changes.length > 0 && (
                <div className="mb-3">
                  <h4 className="text-xs font-semibold text-slate-500 mb-1">{t('card.changes_title')}</h4>
                  <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    {sim.hypothetical_changes.map((c: any, i: number) => (
                      <li key={i}>{typeof c === 'string' ? c : c.description || JSON.stringify(c)}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(sim.created_at).toLocaleString(i18n.language)}</span>
                <Button size="sm" variant="secondary">{t('card.adopt')}</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('create.title')}>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label={t('create.title_label')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('create.title_placeholder')} required autoFocus />
          <Textarea label={t('create.description_label')} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('create.description_placeholder')} />
          <Textarea label={t('create.changes_label')} value={changes} onChange={(e) => setChanges(e.target.value)} placeholder={t('create.changes_placeholder')} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>{tCommon('actions.cancel')}</Button>
            <Button type="submit" loading={creating}>{t('create.submit')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
