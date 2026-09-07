import { z } from 'zod';
import { zResourceId, zCaseId, zActorId, zISODateString } from './ids.js';

export const zResource = z.object({
  id: zResourceId,
  case_id: zCaseId,
  type: z.string().min(1), // e.g. 'person_hours', 'gpu', 'budget', 'api_quota', 'token_budget'
  name: z.string().min(1),
  capacity: z.number().nonnegative().default(0),
  available: z.number().nonnegative().default(0),
  reserved: z.number().nonnegative().default(0),
  cost_per_unit: z.number().nonnegative().default(0),
  currency: z.string().default('USD'),
  location: z.string().optional(),
  consumable: z.boolean().default(true),
  created_at: zISODateString,
  created_by: zActorId,
  revision: z.number().int().nonnegative().default(0),
});

export type Resource = z.infer<typeof zResource>;
