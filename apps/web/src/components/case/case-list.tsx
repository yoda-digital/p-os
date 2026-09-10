import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCases, useDeleteCase } from '../../hooks/use-case';
import { Badge } from '../common/badge';
import { Button } from '../common/button';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { CreateCaseDialog } from './create-case-dialog';
import { FolderOpen, Plus, Clock, Trash2 } from 'lucide-react';

const lifecycleVariant: Record<string, string> = {
  open: 'success',
  dormant: 'warning',
  closed: 'neutral',
  archived: 'neutral',
  void: 'danger',
};

const filters = ['all', 'open', 'dormant', 'closed', 'archived'] as const;

export function CaseList() {
  const { t, i18n } = useTranslation('cases');
  const { t: tCommon } = useTranslation('common');
  const { data: cases, isLoading } = useCases();
  const { mutate: deleteCase, isPending: isDeleting } = useDeleteCase();
  const [filter, setFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const navigate = useNavigate();

  const handleDelete = (e: React.MouseEvent, caseId: string, title: string) => {
    e.stopPropagation();
    setDeleteConfirm({ id: caseId, title });
  };

  const confirmDelete = () => {
    if (deleteConfirm) {
      deleteCase(deleteConfirm.id, {
        onSuccess: () => setDeleteConfirm(null),
      });
    }
  };

  if (isLoading) return <FullPageSpinner />;

  const filtered = filter === 'all' ? cases : cases?.filter(c => c.lifecycle === filter);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('list.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('list.subtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> {t('list.new_case')}
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
            {t(`list.filters.${f}`)}
          </button>
        ))}
      </div>

      {(!filtered || filtered.length === 0) ? (
        <EmptyState
          icon={<FolderOpen className="w-12 h-12" />}
          title={t('list.empty.title')}
          description={filter === 'all' ? t('list.empty.description_all') : t('list.empty.description_filtered', { filter })}
          action={filter === 'all' ? { label: t('list.empty.action'), onClick: () => setCreateOpen(true) } : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="relative bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-600 hover:shadow-md transition-all group"
            >
              <button
                onClick={() => navigate(`/cases/${c.id}/kanban`)}
                className="text-left p-5 w-full"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white group-hover:text-emerald-600 line-clamp-1 pr-8">
                    {c.title}
                  </h3>
                  <Badge variant={lifecycleVariant[c.lifecycle] as any}>{tCommon(`status.${c.lifecycle}`, { defaultValue: c.lifecycle })}</Badge>
                </div>
                {c.description && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">{c.description}</p>
                )}
                <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(c.created_at).toLocaleDateString(i18n.language)}
                  </span>
                  {c.type !== 'general' && <Badge variant="info">{t(`types.${c.type}`, { defaultValue: c.type })}</Badge>}
                </div>
              </button>
              <button
                onClick={(e) => handleDelete(e, c.id, c.title)}
                className="absolute top-3 right-3 p-2 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30"
                title={t('list.delete_case', { defaultValue: 'Delete case' })}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-900 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              {t('list.confirm_delete.title', { defaultValue: 'Delete Case?' })}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              {t('list.confirm_delete.message', {
                defaultValue: 'Are you sure you want to delete "{{title}}"? This action cannot be undone.',
                title: deleteConfirm.title
              })}
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                variant="secondary"
                onClick={() => setDeleteConfirm(null)}
                disabled={isDeleting}
              >
                {tCommon('cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                variant="danger"
                onClick={confirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? t('list.deleting', { defaultValue: 'Deleting...' }) : t('list.delete', { defaultValue: 'Delete' })}
              </Button>
            </div>
          </div>
        </div>
      )}

      <CreateCaseDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
