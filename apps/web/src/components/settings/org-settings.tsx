import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type OrgUnit } from '../../lib/api';
import { Button } from '../common/button';
import { Input } from '../common/input';
import { Textarea } from '../common/textarea';
import { Select } from '../common/select';
import { Dialog } from '../common/dialog';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { Building2, Plus, Pencil, Users } from 'lucide-react';

function buildTree(units: OrgUnit[], parentId: string | null = null): OrgUnit[] {
  return units.filter((u) => (u.parent_id ?? null) === parentId);
}

function UnitNode({ unit, all, depth, onEdit }: { unit: OrgUnit; all: OrgUnit[]; depth: number; onEdit: (u: OrgUnit) => void }) {
  const children = buildTree(all, unit.id);
  return (
    <div>
      <div
        className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
        style={{ marginLeft: depth * 20 }}
      >
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-900 dark:text-white">{unit.name}</span>
          {unit.description && <span className="text-xs text-slate-400">— {unit.description}</span>}
          <Badge variant="neutral"><Users className="w-3 h-3 mr-0.5" />{unit.member_count}</Badge>
        </div>
        <button onClick={() => onEdit(unit)} className="text-slate-400 hover:text-emerald-600">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
      {children.map((c) => <UnitNode key={c.id} unit={c} all={all} depth={depth + 1} onEdit={onEdit} />)}
    </div>
  );
}

export function OrgSettings() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const qc = useQueryClient();
  const { data: units, isLoading } = useQuery({ queryKey: ['org-units'], queryFn: api.listOrgUnits });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OrgUnit | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState('');

  const save = useMutation({
    mutationFn: () => {
      if (editing) return api.updateOrgUnit(editing.id, { name, description: description || undefined, parent_id: parentId || null });
      return api.createOrgUnit({ name, description: description || undefined, parent_id: parentId || undefined });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-units'] });
      setDialogOpen(false);
      setEditing(null);
      setName(''); setDescription(''); setParentId('');
    },
  });

  const openCreate = () => { setEditing(null); setName(''); setDescription(''); setParentId(''); setDialogOpen(true); };
  const openEdit = (u: OrgUnit) => { setEditing(u); setName(u.name); setDescription(u.description ?? ''); setParentId(u.parent_id ?? ''); setDialogOpen(true); };

  if (isLoading) return <FullPageSpinner />;
  const roots = buildTree(units ?? [], null);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('org.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('org.subtitle')}</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> {t('org.new_unit')}</Button>
      </div>

      {roots.length === 0 ? (
        <EmptyState icon={<Building2 className="w-12 h-12" />} title={t('org.empty.title')} description={t('org.empty.description')} action={{ label: t('org.new_unit'), onClick: openCreate }} />
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
          {roots.map((u) => <UnitNode key={u.id} unit={u} all={units ?? []} depth={0} onEdit={openEdit} />)}
        </div>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? t('org.edit_unit') : t('org.new_unit')}>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
          <Input label={t('org.unit_name')} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <Textarea label={t('org.unit_description')} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Select
            label={t('org.parent_unit')}
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            options={[{ value: '', label: t('org.no_parent') }, ...(units ?? []).filter((u) => u.id !== editing?.id).map((u) => ({ value: u.id, label: u.name }))]}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>{tCommon('actions.cancel')}</Button>
            <Button type="submit" loading={save.isPending}>{tCommon('actions.save')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
