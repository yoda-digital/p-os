import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from '../common/dialog';
import { Input } from '../common/input';
import { Textarea } from '../common/textarea';
import { Select } from '../common/select';
import { Button } from '../common/button';
import { useCreateCase } from '../../hooks/use-case';

const CASE_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'software', label: 'Software Development' },
  { value: 'procurement', label: 'Procurement / Tender' },
  { value: 'investigation', label: 'Investigation' },
  { value: 'research', label: 'Research' },
  { value: 'negotiation', label: 'Negotiation / Sales' },
  { value: 'incident', label: 'Incident Response' },
  { value: 'logistics', label: 'Physical Logistics' },
];

interface CreateCaseDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateCaseDialog({ open, onClose }: CreateCaseDialogProps) {
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
    <Dialog open={open} onClose={onClose} title="Create Case">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What is this case about?"
          required
          autoFocus
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the situation..."
        />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value)} options={CASE_TYPES} />
        <Textarea
          label="Primary Intent"
          value={intentStatement}
          onChange={(e) => setIntentStatement(e.target.value)}
          placeholder="What is this case trying to achieve?"
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={createCase.isPending}>Create Case</Button>
        </div>
      </form>
    </Dialog>
  );
}
