import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../common/dialog';
import { Input } from '../common/input';
import { Textarea } from '../common/textarea';
import { Select } from '../common/select';
import { Button } from '../common/button';
import { useCreateCase } from '../../hooks/use-case';

const CASE_TYPE_VALUES = [
  'general', 'software', 'procurement', 'investigation',
  'research', 'negotiation', 'incident', 'logistics',
] as const;

interface CreateCaseDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateCaseDialog({ open, onClose }: CreateCaseDialogProps) {
  const { t } = useTranslation('cases');
  const { t: tCommon } = useTranslation('common');
  const CASE_TYPES = CASE_TYPE_VALUES.map((value) => ({ value, label: t(`types.${value}`) }));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('general');
  const [intentStatement, setIntentStatement] = useState('');
  const navigate = useNavigate();
  const createCase = useCreateCase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await createCase.mutateAsync({
      title,
      description: description || undefined,
      type,
      intent_statement: intentStatement || undefined,
    });
    setTitle('');
    setDescription('');
    setType('general');
    setIntentStatement('');
    onClose();
    navigate(`/cases/${result.id}/kanban`);
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('create.title')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t('create.title_label')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('create.title_placeholder')}
          required
          autoFocus
        />
        <Textarea
          label={t('create.description_label')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('create.description_placeholder')}
        />
        <Select label={t('create.type_label')} value={type} onChange={(e) => setType(e.target.value)} options={CASE_TYPES} />
        <Textarea
          label={t('create.intent_label')}
          value={intentStatement}
          onChange={(e) => setIntentStatement(e.target.value)}
          placeholder={t('create.intent_placeholder')}
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>{tCommon('actions.cancel')}</Button>
          <Button type="submit" loading={createCase.isPending}>{t('create.submit')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
