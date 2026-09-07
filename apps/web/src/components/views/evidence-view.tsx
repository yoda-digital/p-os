import { useState } from 'react';
import { useParams } from 'react-router-dom';
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

const RELATIONS = [
  { value: 'supports', label: 'Supports' },
  { value: 'contradicts', label: 'Contradicts' },
  { value: 'verifies', label: 'Verifies' },
  { value: 'invalidates', label: 'Invalidates' },
  { value: 'establishes_provenance', label: 'Establishes Provenance' },
  { value: 'establishes_authority', label: 'Establishes Authority' },
  { value: 'establishes_compliance', label: 'Establishes Compliance' },
];

export function EvidenceView() {
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
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Evidence</h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> Attach Evidence
        </Button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-6">
        {['all', 'valid', 'stale', 'invalid', 'disputed', 'unknown'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full capitalize ${filter === f ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
          >
            {f}
          </button>
        ))}
      </div>

      {(!filtered || filtered.length === 0) ? (
        <EmptyState
          icon={<FileCheck className="w-12 h-12" />}
          title="No evidence"
          description="Attach evidence to support or verify process state"
          action={{ label: 'Attach Evidence', onClick: () => setCreateOpen(true) }}
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
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 capitalize">{ev.relation}</span>
                  </div>
                  <Badge variant={validityVariant[ev.validity] as any}>{ev.validity}</Badge>
                </div>
                <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <p>Confidence: {(ev.confidence * 100).toFixed(0)}%</p>
                  {ev.subject_refs.length > 0 && (
                    <p>Subjects: {ev.subject_refs.map(s => `${s.type}:${s.id.slice(0, 8)}`).join(', ')}</p>
                  )}
                  {ev.fresh_until && <p>Fresh until: {new Date(ev.fresh_until).toLocaleDateString()}</p>}
                  <p>Observed: {ev.observed_at ? new Date(ev.observed_at).toLocaleDateString() : 'N/A'}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Attach Evidence">
        <form onSubmit={handleCreate} className="space-y-4">
          <Select label="Relation" value={newRelation} onChange={(e) => setNewRelation(e.target.value)} options={RELATIONS} />
          <Input label="Subject ID (Move/Entity)" value={newSubjectId} onChange={(e) => setNewSubjectId(e.target.value)} placeholder="UUID of the subject" />
          <Input label="Confidence (0-1)" type="number" step="0.1" min="0" max="1" value={newConfidence} onChange={(e) => setNewConfidence(e.target.value)} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" loading={attachEvidence.isPending}>Attach</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
