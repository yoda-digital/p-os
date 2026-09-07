import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../common/dialog';
import { Input } from '../common/input';
import { Textarea } from '../common/textarea';
import { Select } from '../common/select';
import { Button } from '../common/button';
import { useCreateMove } from '../../hooks/use-moves';

const MOVE_CLASS_VALUES = [
  'ACT', 'OBSERVE', 'ASK', 'WAIT', 'DECIDE', 'COMMUNICATE',
  'VERIFY', 'DELEGATE', 'ESCALATE', 'APPROVE', 'REJECT', 'STOP',
] as const;

const PRIORITY_ICONS: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const PRIORITY_VALUES = ['critical', 'high', 'medium', 'low'] as const;
const RISK_VALUES = ['none', 'low', 'medium', 'high', 'critical'] as const;

interface CreateMoveDialogProps {
  open: boolean;
  onClose: () => void;
  caseId: string;
}

export function CreateMoveDialog({ open, onClose, caseId }: CreateMoveDialogProps) {
  const { t } = useTranslation('kanban');
  const { t: tCommon } = useTranslation('common');

  const MOVE_CLASSES = MOVE_CLASS_VALUES.map((value) => ({ value, label: t(`class_full.${value}`) }));
  const PRIORITIES = PRIORITY_VALUES.map((value) => ({ value, label: `${PRIORITY_ICONS[value]} ${tCommon(`priority.${value}`)}` }));
  const RISKS = RISK_VALUES.map((value) => ({ value, label: t(`risk.${value}`) }));

  const [title, setTitle] = useState('');
  const [moveClass, setMoveClass] = useState('ACT');
  const [objective, setObjective] = useState('');
  const [priority, setPriority] = useState('medium');
  const [risk, setRisk] = useState('none');
  const [deadline, setDeadline] = useState('');
  const [constraints, setConstraints] = useState('');

  const createMove = useCreateMove(caseId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createMove.mutateAsync({
      title,
      class: moveClass,
      objective: objective || undefined,
      priority,
      risk,
      deadline: deadline || undefined,
      constraints: constraints ? constraints.split('\n').filter(Boolean) : undefined,
    });
    setTitle('');
    setMoveClass('ACT');
    setObjective('');
    setPriority('medium');
    setRisk('none');
    setDeadline('');
    setConstraints('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('create_move.title')} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t('create_move.title_label')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('create_move.title_placeholder')}
          required
          autoFocus
        />

        <div className="grid grid-cols-2 gap-4">
          <Select label={t('create_move.type_label')} value={moveClass} onChange={(e) => setMoveClass(e.target.value)} options={MOVE_CLASSES} />
          <Select label={t('create_move.priority_label')} value={priority} onChange={(e) => setPriority(e.target.value)} options={PRIORITIES} />
        </div>

        <Textarea
          label={t('create_move.objective_label')}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder={t('create_move.objective_placeholder')}
        />

        <div className="grid grid-cols-2 gap-4">
          <Select label={t('create_move.risk_label')} value={risk} onChange={(e) => setRisk(e.target.value)} options={RISKS} />
          <Input
            label={t('create_move.deadline_label')}
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </div>

        <Textarea
          label={t('create_move.constraints_label')}
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          placeholder={t('create_move.constraints_placeholder')}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>{tCommon('actions.cancel')}</Button>
          <Button type="submit" loading={createMove.isPending}>{t('create_move.submit')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
