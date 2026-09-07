/**
 * PreToolUse hook handler (spec section 4.5).
 *
 * Before every tool invocation:
 * 1. Fastest path: not paired / not bound → {}
 * 2. Check pending steering queue → inject via additionalContext
 * 3. Check local policy mirror → block if tool is prohibited
 */
import type { HookInput, HookResult } from './handler.js';
import { extractSessionId } from './handler.js';
import { DeviceStore } from '../storage/device.js';
import { SessionStore } from '../storage/sessions.js';
import { SteeringQueueStore } from '../storage/steering-queue.js';
import { PolicyMirrorStore } from '../storage/policy-mirror.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handlePreToolUse(input: HookInput): Promise<HookResult> {
  const deviceStore = new DeviceStore();
  if (!deviceStore.isPaired()) return {};

  const sessionId = extractSessionId(input);
  if (!sessionId) return {};

  const sessionStore = new SessionStore();
  const binding = sessionStore.get(sessionId);
  if (!binding?.case_id) return {};

  const toolName = extractToolName(input);
  const result: HookResult = {};

  // ── 1. Deliver pending steering ─────────────────────────────────────────
  const steeringStore = new SteeringQueueStore();
  const pending = steeringStore.getPending(binding.case_id);

  if (pending.length > 0) {
    const messages = pending.map((s) => {
      let instruction = s.payload;
      try {
        const parsed = JSON.parse(s.payload) as Record<string, unknown>;
        if (typeof parsed['instruction'] === 'string') instruction = parsed['instruction'];
      } catch {
        /* payload is the instruction itself */
      }

      switch (s.steering_class) {
        case 'constraint':
          return `CONSTRAINT: ${instruction}`;
        case 'advisory':
          return `ADVISORY: ${instruction}`;
        case 'redirect':
          return `REDIRECT: ${instruction}`;
        case 'pause':
          return `PAUSE REQUESTED: ${instruction}`;
        case 'hard_stop':
          return `HARD STOP: ${instruction}`;
        default:
          return `STEERING: ${instruction}`;
      }
    });

    result['additionalContext'] = `[Process OS Steering Delivered]\n${messages.join('\n')}`;

    // Mark all as delivered
    for (const s of pending) {
      steeringStore.markDelivered(s.id);
    }
  }

  // ── 2. Policy enforcement ───────────────────────────────────────────────
  if (toolName) {
    const policyStore = new PolicyMirrorStore();
    const policies = policyStore.getActive();

    for (const policy of policies) {
      try {
        const data = JSON.parse(policy.policy_data) as Record<string, unknown>;
        if (data['type'] !== 'tool_block') continue;

        const tools = data['tools'];
        if (Array.isArray(tools) && tools.includes(toolName)) {
          return {
            decision: 'block',
            reason:
              (typeof data['reason'] === 'string' ? data['reason'] : null) ??
              `Tool "${toolName}" is prohibited by process policy`,
          };
        }
      } catch {
        /* skip unreadable policy */
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractToolName(input: HookInput): string {
  if (typeof input['tool_name'] === 'string') return input['tool_name'];
  const tool = input['tool'];
  if (tool && typeof tool === 'object') {
    const name = (tool as Record<string, unknown>)['name'];
    if (typeof name === 'string') return name;
  }
  return '';
}
