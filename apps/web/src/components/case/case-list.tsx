import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCases } from '../../hooks/use-case';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { CreateCaseDialog } from './create-case-dialog';
import { FolderOpen, Plus, Clock } from 'lucide-react';

const lifecycleVariant: Record<string, string> = {
  open: 'success',
  dormant: 'warning',
  closed: 'neutral',
  archived: 'neutral',
  void: 'danger',
};

const filters = ['all', 'open', 'dormant', 'closed', 'archived'] as const;

export function CaseList() {
  const { data: cases, isLoading } = useCases();
  const [filter, setFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();

  if (isLoading) return <FullPageSpinner />;

  const filtered = filter === 'all' ? cases : cases?.filter(c => c.lifecycle === filter);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Cases</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage your processes and situations</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> New Case
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors capitalize ${
              filter === f
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {(!filtered || filtered.length === 0) ? (
        <EmptyState
          icon={<FolderOpen className="w-12 h-12" />}
          title="No cases found"
          description={filter === 'all' ? 'Create your first case to get started' : `No ${filter} cases`}
          action={filter === 'all' ? { label: 'Create Case', onClick: () => setCreateOpen(true) } : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/cases/${c.id}/kanban`)}
              className="text-left bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 hover:border-emerald-300 dark:hover:border-emerald-600 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white group-hover:text-emerald-600 line-clamp-1">
                  {c.title}
                </h3>
                <Badge variant={lifecycleVariant[c.lifecycle] as any}>{c.lifecycle}</Badge>
              </div>
              {c.description && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">{c.description}</p>
              )}
              <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
                {c.type !== 'general' && <Badge variant="info">{c.type}</Badge>}
              </div>
            </button>
          ))}
        </div>
      )}

      <CreateCaseDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
