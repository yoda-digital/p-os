// ABAC (Attribute-Based Access Control) policy engine.

export { evaluate } from './evaluate.js';
export { loadActorContext, invalidateActorCache, invalidateAllCaches } from './loader.js';
export type {
  AttributeCondition,
  Policy,
  ActorContext,
  ResourceContext,
  EnvironmentContext,
  AuthorizationRequest,
  AuthorizationResult,
} from './types.js';
