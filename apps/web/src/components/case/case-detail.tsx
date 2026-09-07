import { Outlet, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCase } from '../../hooks/use-case';
import { Badge } from '../common/badge';
import { FullPageSpinner } from '../common/spinner';

const lifecycleVariant: Record<string, string> = {
  open: 'success',
  dormant: 'warning',
  closed: 'neutral',
  archived: 'neutral',
  void: 'danger',
};

export function CaseDetail() {
  const { t } = useTranslation('cases');
  const { t: tCommon } = useTranslation('common');
  const { caseId } = useParams<{ caseId: string }>();
  const { data: caseData, isLoading } = useCase(caseId);

  if (isLoading) return <FullPageSpinner />;
  if (!caseData) return <div className="p-8 text-center text-slate-500">{t('detail.not_found')}</div>;

  return (
    <div className="h-full flex flex-col">
      {/* Case Header */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{caseData.title}</h1>
          <Badge variant={lifecycleVariant[caseData.lifecycle] as any}>
            {tCommon(`status.${caseData.lifecycle}`, { defaultValue: caseData.lifecycle })}
          </Badge>
          {caseData.type !== 'general' && (
            <Badge variant="info">{t(`types.${caseData.type}`, { defaultValue: caseData.type })}</Badge>
          )}
        </div>
        {caseData.description && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{caseData.description}</p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
