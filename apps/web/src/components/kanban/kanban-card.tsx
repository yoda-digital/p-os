import { useDraggable } from '@dnd-kit/core';
import { Badge } from '../common/badge';
import {
  Play, Pause, CheckCircle2, AlertTriangle, Clock,
  Eye, MessageSquare, Hand, GitFork, Shield, ArrowUp,
  ArrowDown, Minus, Loader2, Link2,
} from 'lucide-react';
import type { KanbanCard as KanbanCardType } from '../../lib/api';

const classColors: Record<string, { variant: string; label: string }> = {
  ACT: { variant: 'info', label: 'Act' },
  OBSERVE: { variant: 'purple', label: 'Observe' },
  ASK: { variant: 'orange', label: 'Ask' },
  WAIT: { variant: 'warning', label: 'Wait' },
  DECIDE: { variant: 'danger', label: 'Decide' },
  COMMUNICATE: { variant: 'info', label: 'Communicate' },
  VERIFY: { variant: 'purple', label: 'Verify' },
  DELEGATE: { variant: 'neutral', label: 'Delegate' },
  ESCALATE: { variant: 'danger', label: 'Escalate' },
  APPROVE: { variant: 'success', label: 'Approve' },
  REJECT: { variant: 'danger', label: 'Reject' },
  STOP: { variant: 'danger', label: 'Stop' },
};

const priorityIcons: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
};

const riskVariant: Record<string, string> = {
  critical: 'danger',
  high: 'orange',
  medium: 'warning',
  low: 'success',
  none: 'neutral',
};

const executionIcons: Record<string, typeof Play> = {
  running: Loader2,
  paused: Pause,
  finished: CheckCircle2,
  not_started: Minus,
  queued: Clock,
  starting: Play,
};

interface KanbanCardProps {
  card: KanbanCardType;
  onClick?: () => void;
  isDragging?: boolean;
}

export function KanbanCard({ card, onClick, isDragging }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: card.move_id,
  });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const classInfo = classColors[card.class] || classColors.ACT;
  const execution = (card as any).execution ?? (card as any).execution_state ?? 'not_started';
  const ExecIcon = executionIcons[execution] || Minus;
  const isOverdue = card.deadline && new Date(card.deadline) < new Date();
  const isAtRisk = isOverdue || (card as any).temporal === 'at_risk';
  const evidenceCount = typeof (card as any).evidence_count === 'number' ? (card as any).evidence_count : ((card as any).evidence_progress?.total ?? 0);
  const depsArray = Array.isArray(card.dependencies) ? card.dependencies : [];
  const blockedByCount = typeof (card as any).dependencies?.blocked_by === 'number' ? (card as any).dependencies.blocked_by : depsArray.length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`
        bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700
        p-3 cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-600
        transition-all shadow-sm hover:shadow-md
        ${isDragging ? 'opacity-50 rotate-2 shadow-xl scale-105' : ''}
      `}
    >
      {/* Top row: priority + class badge */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-xs">{priorityIcons[card.priority] || '⚪'}</span>
        <Badge variant={classInfo.variant as any}>{classInfo.label}</Badge>
        {card.risk !== 'none' && (
          <Badge variant={riskVariant[card.risk] as any} dot>
            <AlertTriangle className="w-3 h-3" /> {card.risk}
          </Badge>
        )}
      </div>

      {/* Title */}
      <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2 line-clamp-2">
        {card.title}
      </h4>

      {/* Execution state + activity */}
      <div className="flex items-center gap-1.5 mb-2">
        <ExecIcon className={`w-3.5 h-3.5 ${execution === 'running' ? 'animate-spin text-emerald-500' : 'text-slate-400'}`} />
        <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {execution}
        </span>
      </div>

      {/* Bottom row: metadata */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Assigned actors */}
        {(card as any).assigned_actor_ids?.length > 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Eye className="w-3 h-3" /> {(card as any).assigned_actor_ids.length} assigned
          </span>
        )}

        {/* Deadline */}
        {card.deadline && (
          <span className={`text-xs flex items-center gap-1 ${isOverdue ? 'text-red-500' : isAtRisk ? 'text-amber-500' : 'text-slate-400'}`}>
            <Clock className="w-3 h-3" />
            {new Date(card.deadline).toLocaleDateString()}
          </span>
        )}

        {/* Verification */}
        {card.verification !== 'not_required' && (
          <Badge variant={card.verification === 'passed' ? 'success' : card.verification === 'failed' ? 'danger' : 'neutral'}>
            <Shield className="w-3 h-3" /> {card.verification}
          </Badge>
        )}

        {/* Evidence count */}
        {evidenceCount > 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {evidenceCount} evidence
          </span>
        )}

        {/* Dependencies */}
        {blockedByCount > 0 && (
          <Badge variant="danger">
            <Link2 className="w-3 h-3" /> {blockedByCount} dep{blockedByCount > 1 ? 's' : ''}
          </Badge>
        )}

        {/* Attention */}
        {card.attention !== 'autonomous' && card.attention !== 'watch' && (
          <Badge variant="warning" dot>
            {card.attention.replace(/_/g, ' ')}
          </Badge>
        )}
      </div>
    </div>
  );
}
