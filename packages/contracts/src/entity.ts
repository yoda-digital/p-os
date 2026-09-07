import { z } from 'zod';
import { zEntityId, zCaseId, zActorId, zISODateString } from './ids.js';

export const zEntity = z.object({
  id: zEntityId,
  case_id: zCaseId,
  type: z.string().min(1), // namespaced, e.g. 'software.repository', 'procurement.requirement'
  title: z.string().min(1),
  description: z.string().default(''),
  properties: z.record(z.string(), z.unknown()).default({}),
  created_at: zISODateString,
  created_by: zActorId,
  revision: z.number().int().nonnegative().default(0),
});

export type Entity = z.infer<typeof zEntity>;
