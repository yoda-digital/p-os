import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEvidence, useAttachEvidence } from '../../hooks/use-evidence';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { Dialog } from '../common/dialog';
import { Input } from '../common/input';
import { Select } from '../common/select';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { FileCheck, Plus, Shield, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';

const validityVariant: Record<string, string> = {
  valid: 'success', stale: 'warning', invalid: 'danger', disputed: 'orange', unknown: 'neutral',
};
const relationIcons: Record<string, typeof Shield> = {
  supports: Shield, contradicts: XCircle, verifies: FileCheck, invalidates: AlertTriangle,
};

const RELATION_VALUES = [
  'supports', 'contradicts', 'verifies', 'invalidates',
  'establishes_provenance', 'establishes_authority', 'establishes_compliance',
] as const;

const FILTER_VALUES = ['all', 'valid', 'stale', 'invalid', 'disputed', 'unknown'] as const;

export function EvidenceView() {
  const { t, i18n } = useTranslation('evidence');
  const { t: tCommon } = useTranslation('common');
  const RELATIONS = RELATION_VALUES.map((value) => ({ value, label: t(`relation.${value}`) }));
  const { caseId } = useParams<{ caseId: string }>();
  const { data: evidence, isLoading } = useEvidence(caseId);
  const attachEvidence = useAttachEvidence(caseId!);
  const [filter, setFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [newRelation, setNewRelation] = useState('supports');
  const [newSubjectId, setNewSubjectId] = useState('');
  const [newConfidence, setNewConfidence] = useState('1.0');

  if (isLoading) return <FullPageSpinner />;

  const filtered = filter === 'all' ? evidence : evidence?.filter(e => e.validity === filter);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await attachEvidence.mutateAsync({
      subject_refs: newSubjectId ? [{ id: newSubjectId, type: 'move' }] : [],
      relation: newRelation,
      confidence: parseFloat(newConfidence),
    });
    setCreateOpen(false);
    setNewSubjectId('');
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileCheck className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('title')}</h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> {t('attach')}
        </Button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-6">
        {FILTER_VALUES.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full ${filter === f ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
          >
            {t(`filters.${f}`)}
          </button>
        ))}
      </div>

      {(!filtered || filtered.length === 0) ? (
        <EmptyState
          icon={<FileCheck className="w-12 h-12" />}
          title={t('empty.title')}
          description={t('empty.description')}
          action={{ label: t('empty.action'), onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((ev) => {
            const Icon = relationIcons[ev.relation] || HelpCircle;
            return (
              <div key={ev.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t(`relation.${ev.relation}`, { defaultValue: ev.relation })}</span>
                  </div>
                  <Badge variant={validityVariant[ev.validity] as any}>{t(`filters.${ev.validity}`, { defaultValue: ev.validity })}</Badge>
                </div>
                <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <p>{t('card.confidence', { value: (ev.confidence * 100).toFixed(0) })}</p>
                  {ev.subject_refs.length > 0 && (
                    <p>{t('card.subjects', { value: ev.subject_refs.map(s => `${s.type}:${s.id.slice(0, 8)}`).join(', ') })}</p>
                  )}
                  {ev.fresh_until && <p>{t('card.fresh_until', { value: new Date(ev.fresh_until).toLocaleDateString(i18n.language) })}</p>}
                  <p>{t('card.observed', { value: ev.observed_at ? new Date(ev.observed_at).toLocaleDateString(i18n.language) : t('card.not_available') })}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('create.title')}>
        <form onSubmit={handleCreate} className="space-y-4">
          <Select label={t('create.relation_label')} value={newRelation} onChange={(e) => setNewRelation(e.target.value)} options={RELATIONS} />
          <Input label={t('create.subject_label')} value={newSubjectId} onChange={(e) => setNewSubjectId(e.target.value)} placeholder={t('create.subject_placeholder')} />
          <Input label={t('create.confidence_label')} type="number" step="0.1" min="0" max="1" value={newConfidence} onChange={(e) => setNewConfidence(e.target.value)} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>{tCommon('actions.cancel')}</Button>
            <Button type="submit" loading={attachEvidence.isPending}>{tCommon('actions.attach')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
