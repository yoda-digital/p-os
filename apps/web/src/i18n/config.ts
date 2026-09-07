import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import all locale files
import roCommon from './locales/ro/common.json';
import roAuth from './locales/ro/auth.json';
import roCases from './locales/ro/cases.json';
import roKanban from './locales/ro/kanban.json';
import roAttention from './locales/ro/attention.json';
import roTimeline from './locales/ro/timeline.json';
import roDependencies from './locales/ro/dependencies.json';
import roEvidence from './locales/ro/evidence.json';
import roDecisions from './locales/ro/decisions.json';
import roCompliance from './locales/ro/compliance.json';
import roActors from './locales/ro/actors.json';
import roResources from './locales/ro/resources.json';
import roRisk from './locales/ro/risk.json';
import roWhy from './locales/ro/why.json';
import roTimeTravel from './locales/ro/time-travel.json';
import roSimulation from './locales/ro/simulation.json';
import roIntelligence from './locales/ro/intelligence.json';
import roSteering from './locales/ro/steering.json';
import roAdmin from './locales/ro/admin.json';

import ruCommon from './locales/ru/common.json';
import ruAuth from './locales/ru/auth.json';
import ruCases from './locales/ru/cases.json';
import ruKanban from './locales/ru/kanban.json';
import ruAttention from './locales/ru/attention.json';
import ruTimeline from './locales/ru/timeline.json';
import ruDependencies from './locales/ru/dependencies.json';
import ruEvidence from './locales/ru/evidence.json';
import ruDecisions from './locales/ru/decisions.json';
import ruCompliance from './locales/ru/compliance.json';
import ruActors from './locales/ru/actors.json';
import ruResources from './locales/ru/resources.json';
import ruRisk from './locales/ru/risk.json';
import ruWhy from './locales/ru/why.json';
import ruTimeTravel from './locales/ru/time-travel.json';
import ruSimulation from './locales/ru/simulation.json';
import ruIntelligence from './locales/ru/intelligence.json';
import ruSteering from './locales/ru/steering.json';
import ruAdmin from './locales/ru/admin.json';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enCases from './locales/en/cases.json';
import enKanban from './locales/en/kanban.json';
import enAttention from './locales/en/attention.json';
import enTimeline from './locales/en/timeline.json';
import enDependencies from './locales/en/dependencies.json';
import enEvidence from './locales/en/evidence.json';
import enDecisions from './locales/en/decisions.json';
import enCompliance from './locales/en/compliance.json';
import enActors from './locales/en/actors.json';
import enResources from './locales/en/resources.json';
import enRisk from './locales/en/risk.json';
import enWhy from './locales/en/why.json';
import enTimeTravel from './locales/en/time-travel.json';
import enSimulation from './locales/en/simulation.json';
import enIntelligence from './locales/en/intelligence.json';
import enSteering from './locales/en/steering.json';
import enAdmin from './locales/en/admin.json';

const ns = [
  'common', 'auth', 'cases', 'kanban', 'attention', 'timeline', 'dependencies',
  'evidence', 'decisions', 'compliance', 'actors', 'resources', 'risk', 'why',
  'time-travel', 'simulation', 'intelligence', 'steering', 'admin',
] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ro: {
        common: roCommon, auth: roAuth, cases: roCases, kanban: roKanban, attention: roAttention,
        timeline: roTimeline, dependencies: roDependencies, evidence: roEvidence, decisions: roDecisions,
        compliance: roCompliance, actors: roActors, resources: roResources, risk: roRisk, why: roWhy,
        'time-travel': roTimeTravel, simulation: roSimulation, intelligence: roIntelligence,
        steering: roSteering, admin: roAdmin,
      },
      ru: {
        common: ruCommon, auth: ruAuth, cases: ruCases, kanban: ruKanban, attention: ruAttention,
        timeline: ruTimeline, dependencies: ruDependencies, evidence: ruEvidence, decisions: ruDecisions,
        compliance: ruCompliance, actors: ruActors, resources: ruResources, risk: ruRisk, why: ruWhy,
        'time-travel': ruTimeTravel, simulation: ruSimulation, intelligence: ruIntelligence,
        steering: ruSteering, admin: ruAdmin,
      },
      en: {
        common: enCommon, auth: enAuth, cases: enCases, kanban: enKanban, attention: enAttention,
        timeline: enTimeline, dependencies: enDependencies, evidence: enEvidence, decisions: enDecisions,
        compliance: enCompliance, actors: enActors, resources: enResources, risk: enRisk, why: enWhy,
        'time-travel': enTimeTravel, simulation: enSimulation, intelligence: enIntelligence,
        steering: enSteering, admin: enAdmin,
      },
    },
    fallbackLng: 'ro',
    defaultNS: 'common',
    ns: ns as unknown as string[],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'pos_language',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
export type SupportedLanguage = 'ro' | 'ru' | 'en';
export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; label: string; flag: string }[] = [
  { code: 'ro', label: 'Română', flag: '🇲🇩' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];
