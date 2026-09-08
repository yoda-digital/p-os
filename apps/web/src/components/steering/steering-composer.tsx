import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '../common/select';
import { Textarea } from '../common/textarea';
import { Button } from '../common/button';
import { Badge } from '../common/badge';
import { useSendSteering, useSteeringHistory } from '../../hooks/use-steering';
import type { SteeringClass, SteeringState } from '../../lib/api';
import {
  Send,
  CheckCircle2,
  Circle,
  ArrowRight,
  Lightbulb,
  ShieldAlert,
  Shuffle,
  PauseCircle,
  OctagonX,
  GitFork,
  UserCheck2,
  AlertTriangle,
} from 'lucide-react';

const STEERING_CLASS_VALUES: SteeringClass[] = [
  'advisory',
  'constraint',
  'redirect',
  'pause',
  'hard_stop',
  'fork',
  'reassign',
];

const DELIVERY_STATES: SteeringState[] = [
  'issued',
  'delivered_to_edge',
  'delivered_to_executor',
  'acknowledged',
  'applied',
];

type BadgeVariant = 'info' | 'warning' | 'danger' | 'purple' | 'neutral';

const CLASS_META: Record<SteeringClass, { icon: typeof Send; badge: BadgeVariant }> = {
  advisory: { icon: Lightbulb, badge: 'info' },
  constraint: { icon: ShieldAlert, badge: 'warning' },
  redirect: { icon: Shuffle, badge: 'purple' },
  pause: { icon: PauseCircle, badge: 'neutral' },
  hard_stop: { icon: OctagonX, badge: 'danger' },
  fork: { icon: GitFork, badge: 'purple' },
  reassign: { icon: UserCheck2, badge: 'info' },
};

const INDICATOR_TEXT_CLASS: Record<BadgeVariant, string> = {
  info: 'text-blue-700 dark:text-blue-400',
  warning: 'text-amber-700 dark:text-amber-400',
  danger: 'text-red-700 dark:text-red-400',
  purple: 'text-purple-700 dark:text-purple-400',
  neutral: 'text-slate-600 dark:text-slate-400',
};

interface SteeringComposerProps {
  caseId: string;
  moveId: string;
  /** The attempt this steering targets. When absent, steering is scoped to the move and
   *  will be delivered to whichever attempt starts next. */
  attemptId?: string;
}

/**
 * Full steering UI (spec §1.5): type selector, instruction input, send button, a live
 * issued → edge → executor → acknowledged → applied ladder for the most recent command, and
 * the full steering history for the current attempt (or move, before any attempt exists).
 */
export function SteeringComposer({ caseId, moveId, attemptId }: SteeringComposerProps) {
  const { t, i18n } = useTranslation('steering');
  const [steeringClass, setSteeringClass] = useState<SteeringClass>('advisory');
  const [instruction, setInstruction] = useState('');

  const sendSteering = useSendSteering(caseId, moveId, attemptId);
  const { data: history } = useSteeringHistory(attemptId, moveId);

  const sorted = history ?? []; // API returns issued_at DESC — sorted[0] is the most recent
  const latest = sorted[0];
  const latestStateIdx = latest ? DELIVERY_STATES.indexOf(latest.state) : -1;

  const classOptions = STEERING_CLASS_VALUES.map((value) => ({ value, label: t(`class.${value}`) }));
  const meta = CLASS_META[steeringClass];
  const Icon = meta.icon;

  const handleSend = async () => {
    if (!instruction.trim()) return;
    try {
      await sendSteering.mutateAsync({ class: steeringClass, instruction });
      setInstruction('');
    } catch {
      // sendSteering.isError renders the failure below
    }
  };

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('composer.title')}</h4>

      <Select
        label={t('panel.type_label')}
        value={steeringClass}
        onChange={(e) => setSteeringClass(e.target.value as SteeringClass)}
        options={classOptions}
      />

      {/* Visual indicator for the selected steering type */}
      <div className={`flex items-center gap-1.5 text-xs font-medium ${INDICATOR_TEXT_CLASS[meta.badge]}`}>
        <Icon className="w-4 h-4 shrink-0" />
        <span>{t(`class.${steeringClass}`)}</span>
      </div>
      {steeringClass === 'constraint' && (
        <p className={`flex items-start gap-1.5 text-xs ${INDICATOR_TEXT_CLASS.warning}`}>
          <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {t('composer.constraint_warning')}
        </p>
      )}
      {steeringClass === 'hard_stop' && (
        <p className={`flex items-start gap-1.5 text-xs ${INDICATOR_TEXT_CLASS.danger}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {t('composer.hard_stop_warning')}
        </p>
      )}

      <Textarea
        label={t('panel.instruction_label')}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={t('panel.instruction_placeholder')}
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={steeringClass === 'hard_stop' ? 'danger' : 'primary'}
          onClick={handleSend}
          loading={sendSteering.isPending}
          disabled={!instruction.trim()}
        >
          <Send className="w-3.5 h-3.5" /> {t('panel.send')}
        </Button>
        {sendSteering.isSuccess && !sendSteering.isPending && (
          <span className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> {t('panel.sent')}
          </span>
        )}
        {sendSteering.isError && <span className="text-xs text-red-600">{t('composer.error')}</span>}
      </div>

      {/* Real-time delivery state ladder for the most recently issued command */}
      {latest && (
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            {t('composer.latest_delivery')}
          </p>
          <div className="flex items-center gap-1 text-xs text-slate-400 flex-wrap">
            {DELIVERY_STATES.map((state, i) => {
              const reached = i <= latestStateIdx;
              return (
                <span
                  key={state}
                  className={`flex items-center gap-1 ${reached ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
                >
                  {reached ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                  <span className="hidden sm:inline">{t(`delivery_state.${state}`)}</span>
                  {i < DELIVERY_STATES.length - 1 && <ArrowRight className="w-3 h-3" />}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Steering history for this attempt (or move) */}
      <div>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
          {t('history.title')}
          {sorted.length > 0 ? ` (${sorted.length})` : ''}
        </p>
        {sorted.length === 0 ? (
          <p className="text-xs text-slate-400">{t('history.empty')}</p>
        ) : (
          <ul className="space-y-1.5 max-h-56 overflow-y-auto">
            {sorted.map((s) => {
              const HistIcon = CLASS_META[s.class].icon;
              return (
                <li
                  key={s.id}
                  className="flex items-start justify-between gap-2 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <HistIcon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${INDICATOR_TEXT_CLASS[CLASS_META[s.class].badge]}`} />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-700 dark:text-slate-300 break-words">{s.instruction}</p>
                      <p className="text-[11px] text-slate-400">
                        {t('history.issued_at', { value: new Date(s.issued_at).toLocaleString(i18n.language) })}
                      </p>
                    </div>
                  </div>
                  <Badge variant={CLASS_META[s.class].badge}>{t(`delivery_state.${s.state}`)}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
