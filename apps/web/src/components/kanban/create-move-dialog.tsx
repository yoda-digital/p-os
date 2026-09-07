import { useState } from 'react';
import { Dialog } from '../common/dialog';
import { Input } from '../common/input';
import { Textarea } from '../common/textarea';
import { Select } from '../common/select';
import { Button } from '../common/button';
import { useCreateMove } from '../../hooks/use-moves';

const MOVE_CLASSES = [
  { value: 'ACT', label: 'Act — Execute a task' },
  { value: 'OBSERVE', label: 'Observe — Gather information' },
  { value: 'ASK', label: 'Ask — Request information' },
  { value: 'WAIT', label: 'Wait — Await external event' },
  { value: 'DECIDE', label: 'Decide — Make a decision' },
  { value: 'COMMUNICATE', label: 'Communicate — Send information' },
  { value: 'VERIFY', label: 'Verify — Check correctness' },
  { value: 'DELEGATE', label: 'Delegate — Assign to another' },
  { value: 'ESCALATE', label: 'Escalate — Raise urgency' },
  { value: 'APPROVE', label: 'Approve — Grant permission' },
  { value: 'REJECT', label: 'Reject — Deny request' },
  { value: 'STOP', label: 'Stop — Halt execution' },
];

const PRIORITIES = [
  { value: 'critical', label: '🔴 Critical' },
  { value: 'high', label: '🟠 High' },
  { value: 'medium', label: '🟡 Medium' },
  { value: 'low', label: '🟢 Low' },
];

const RISKS = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

interface CreateMoveDialogProps {
  open: boolean;
  onClose: () => void;
  caseId: string;
}

export function CreateMoveDialog({ open, onClose, caseId }: CreateMoveDialogProps) {
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
    <Dialog open={open} onClose={onClose} title="Create Move" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to happen?"
          required
          autoFocus
        />

        <div className="grid grid-cols-2 gap-4">
          <Select label="Type" value={moveClass} onChange={(e) => setMoveClass(e.target.value)} options={MOVE_CLASSES} />
          <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} options={PRIORITIES} />
        </div>

        <Textarea
          label="Objective"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="Describe the objective..."
        />

        <div className="grid grid-cols-2 gap-4">
          <Select label="Risk" value={risk} onChange={(e) => setRisk(e.target.value)} options={RISKS} />
          <Input
            label="Deadline"
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </div>

        <Textarea
          label="Constraints (one per line)"
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          placeholder="Do not modify public API&#10;Must pass all tests"
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={createMove.isPending}>Create Move</Button>
        </div>
      </form>
    </Dialog>
  );
}
