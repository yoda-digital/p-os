import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Policy, type AttributeCondition } from '../../lib/api';
import { Button } from '../common/button';
import { Input } from '../common/input';
import { Textarea } from '../common/textarea';
import { Select } from '../common/select';
import { Dialog } from '../common/dialog';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';
import { EmptyState } from '../common/empty-state';
import { ShieldCheck, Plus, Trash2, Pencil } from 'lucide-react';

const OPERATORS = ['eq', 'ne', 'in', 'not_in', 'contains', 'gte', 'lte', 'exists', 'matches'] as const;

interface ConditionDraft { attribute: string; operator: string; value: string }

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  try { return JSON.parse(trimmed); } catch { return trimmed; }
}

function toDraft(conditions: AttributeCondition[]): ConditionDraft[] {
  return conditions.map((c) => ({ attribute: c.attribute, operator: c.operator, value: typeof c.value === 'string' ? c.value : JSON.stringify(c.value) }));
}

function ConditionRows({ label, rows, onChange }: { label: string; rows: ConditionDraft[]; onChange: (rows: ConditionDraft[]) => void }) {
  const update = (i: number, patch: Partial<ConditionDraft>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
        <button type="button" onClick={() => onChange([...rows, { attribute: '', operator: 'eq', value: '' }])} className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2 items-start">
          <Input value={r.attribute} onChange={(e) => update(i, { attribute: e.target.value })} placeholder="actor.roles" className="flex-1" />
          <select
            value={r.operator}
            onChange={(e) => update(i, { operator: e.target.value })}
            className="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          >
            {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
          </select>
          <Input value={r.value} onChange={(e) => update(i, { value: e.target.value })} placeholder="value" className="flex-1" />
          <button type="button" onClick={() => remove(i)} className="p-2 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
}

const emptyForm = { name: '', description: '', effect: 'allow' as 'allow' | 'deny', priority: 0, actions: '', subject: [] as ConditionDraft[], resource: [] as ConditionDraft[] };

export function AdminPolicies() {
  const { t } = useTranslation('admin');
  const { t: tCommon } = useTranslation('common');
  const qc = useQueryClient();
  const { data: policies, isLoading } = useQuery({ queryKey: ['admin', 'policies'], queryFn: api.listPolicies });

  const [editing, setEditing] = useState<Policy | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        effect: form.effect,
        priority: Number(form.priority) || 0,
        scope: 'system' as const,
        actions: form.actions.split(',').map((a) => a.trim()).filter(Boolean),
        subject: form.subject.filter((r) => r.attribute).map((r) => ({ attribute: r.attribute, operator: r.operator, value: parseValue(r.value) })),
        resource: form.resource.filter((r) => r.attribute).map((r) => ({ attribute: r.attribute, operator: r.operator, value: parseValue(r.value) })),
      };
      if (editing) return api.updatePolicy(editing.id, payload);
      return api.createPolicy(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'policies'] });
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePolicy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'policies'] }),
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (p: Policy) => {
    setEditing(p);
    setForm({ name: p.name, description: p.description ?? '', effect: p.effect, priority: p.priority, actions: p.actions.join(', '), subject: toDraft(p.subject), resource: toDraft(p.resource) });
    setDialogOpen(true);
  };

  if (isLoading) return <FullPageSpinner />;
  const systemPolicies = (policies ?? []).filter((p) => p.scope === 'system');

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('policies.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('policies.subtitle')}</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> {t('policies.new')}</Button>
      </div>

      {systemPolicies.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="w-12 h-12" />} title={t('policies.empty.title')} description={t('policies.empty.description')} action={{ label: t('policies.new'), onClick: openCreate }} />
      ) : (
        <div className="space-y-3">
          {systemPolicies.sort((a, b) => b.priority - a.priority).map((p) => (
            <div key={p.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{p.name}</h3>
                    <Badge variant={p.effect === 'allow' ? 'success' : 'danger'}>{p.effect}</Badge>
                    {!p.active && <Badge variant="neutral">{t('policies.inactive')}</Badge>}
                    <Badge variant="info">{t('policies.priority')}: {p.priority}</Badge>
                  </div>
                  {p.description && <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{p.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    {p.actions.map((a) => <Badge key={a} variant="neutral">{a}</Badge>)}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(p.id)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? t('policies.edit') : t('policies.new')} wide>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
          <Input label={t('policies.name')} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required autoFocus />
          <Textarea label={t('policies.description')} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <div className="grid grid-cols-2 gap-4">
            <Select label={t('policies.effect')} value={form.effect} onChange={(e) => setForm((f) => ({ ...f, effect: e.target.value as 'allow' | 'deny' }))} options={[{ value: 'allow', label: t('policies.allow') }, { value: 'deny', label: t('policies.deny') }]} />
            <Input label={t('policies.priority')} type="number" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))} />
          </div>
          <Input label={t('policies.actions')} value={form.actions} onChange={(e) => setForm((f) => ({ ...f, actions: e.target.value }))} placeholder="case.create, move.activate, *" />
          <ConditionRows label={t('policies.subject')} rows={form.subject} onChange={(rows) => setForm((f) => ({ ...f, subject: rows }))} />
          <ConditionRows label={t('policies.resource')} rows={form.resource} onChange={(rows) => setForm((f) => ({ ...f, resource: rows }))} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>{tCommon('actions.cancel')}</Button>
            <Button type="submit" loading={save.isPending}>{tCommon('actions.save')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
