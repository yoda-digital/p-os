import { useState } from 'react';
import { Select } from '../common/select';
import { Textarea } from '../common/textarea';
import { Button } from '../common/button';
import { Badge } from '../common/badge';
import { api } from '../../lib/api';
import { Send, CheckCircle2, Circle, ArrowRight } from 'lucide-react';

const STEERING_CLASSES = [
  { value: 'advisory', label: 'Advisory — Suggestion' },
  { value: 'constraint', label: 'Constraint — Must follow' },
  { value: 'redirect', label: 'Redirect — Change direction' },
  { value: 'pause', label: 'Pause — Halt temporarily' },
  { value: 'hard_stop', label: 'Hard Stop — Terminate now' },
  { value: 'fork', label: 'Fork — Split approach' },
  { value: 'reassign', label: 'Reassign — Change executor' },
];

const steeringStates = ['issued', 'delivered_to_edge', 'delivered_to_executor', 'acknowledged', 'applied'];

interface SteeringPanelProps {
  caseId: string;
  moveId: string;
  attemptId?: string;
}

export function SteeringPanel({ caseId, moveId, attemptId }: SteeringPanelProps) {
  const [steeringClass, setSteeringClass] = useState('advisory');
  const [instruction, setInstruction] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!instruction.trim()) return;
    setSending(true);
    try {
      await api.sendSteering(caseId, moveId, {
        class: steeringClass,
        instruction,
        attempt_id: attemptId,
      });
      setSent(true);
      setInstruction('');
      setTimeout(() => setSent(false), 3000);
    } catch (err) {
      console.error('Steering failed:', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Steer Execution</h4>

      <Select
        label="Steering Type"
        value={steeringClass}
        onChange={(e) => setSteeringClass(e.target.value)}
        options={STEERING_CLASSES}
      />

      <Textarea
        label="Instruction"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="What should the executor do differently?"
      />

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSend} loading={sending} disabled={!instruction.trim()}>
          <Send className="w-3.5 h-3.5" /> Send
        </Button>
        {sent && (
          <span className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Sent
          </span>
        )}
      </div>

      {/* Delivery state visualization */}
      <div className="flex items-center gap-1 text-xs text-slate-400 pt-2">
        {steeringStates.map((state, i) => (
          <span key={state} className="flex items-center gap-1">
            <Circle className="w-3 h-3" />
            <span className="hidden sm:inline">{state.replace(/_/g, ' ')}</span>
            {i < steeringStates.length - 1 && <ArrowRight className="w-3 h-3" />}
          </span>
        ))}
      </div>
    </div>
  );
}
