/**
 * Resume intelligence — decides the optimal context recovery strategy
 * when a session is resumed after a gap.
 *
 * Spec: §3.4 Resume Intelligence
 *
 * Decision matrix:
 *   < 5 min, cache warm      → 'resume'       (resume as-is, no extra context)
 *   5-60 min                  → 'resume_delta'  (inject only new events)
 *   1-24 hours                → 'fresh'         (full capsule rehydration)
 *   > 24 hours                → 'fresh'         (recommend fresh session)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResumeStrategy = 'resume' | 'resume_delta' | 'fresh';

export interface ResumeDecision {
  strategy: ResumeStrategy;
  reason: string;
  /** If true, recommend starting a fresh session rather than resuming. */
  recommendFresh: boolean;
  /** Estimated time since last response in seconds. */
  timeSinceLastResponse: number;
  /** Number of events since the last session interaction. */
  eventsSince: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIVE_MINUTES = 5 * 60;          // 300 seconds
const ONE_HOUR = 60 * 60;             // 3600 seconds
const TWENTY_FOUR_HOURS = 24 * 60 * 60; // 86400 seconds

/** Above this many events, a delta is not useful — go full. */
const MAX_USEFUL_DELTA_EVENTS = 50;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decide the optimal resume strategy based on time gap and activity.
 *
 * @param timeSinceLastResponse - Seconds since the last Claude response in this session
 * @param eventsSince - Number of events in the case since the last session interaction
 */
export function decideResumeStrategy(
  timeSinceLastResponse: number,
  eventsSince: number,
): ResumeDecision {
  // Very short gap: context is likely still in prompt cache, resume as-is
  if (timeSinceLastResponse < FIVE_MINUTES) {
    return {
      strategy: 'resume',
      reason: 'Short gap (<5 min) — context likely still cached',
      recommendFresh: false,
      timeSinceLastResponse,
      eventsSince,
    };
  }

  // Medium gap: inject delta events to catch up
  if (timeSinceLastResponse < ONE_HOUR && eventsSince <= MAX_USEFUL_DELTA_EVENTS) {
    return {
      strategy: 'resume_delta',
      reason: `Medium gap (${formatDuration(timeSinceLastResponse)}) — ${eventsSince} new event(s) to inject`,
      recommendFresh: false,
      timeSinceLastResponse,
      eventsSince,
    };
  }

  // Medium gap but too many events: full rehydration
  if (timeSinceLastResponse < ONE_HOUR) {
    return {
      strategy: 'fresh',
      reason: `Medium gap but ${eventsSince} events — too many for delta, full rehydration needed`,
      recommendFresh: false,
      timeSinceLastResponse,
      eventsSince,
    };
  }

  // Long gap: full capsule rehydration
  if (timeSinceLastResponse < TWENTY_FOUR_HOURS) {
    return {
      strategy: 'fresh',
      reason: `Long gap (${formatDuration(timeSinceLastResponse)}) — full capsule rehydration`,
      recommendFresh: false,
      timeSinceLastResponse,
      eventsSince,
    };
  }

  // Very long gap: recommend fresh session
  return {
    strategy: 'fresh',
    reason: `Very long gap (${formatDuration(timeSinceLastResponse)}) — recommend starting a fresh session`,
    recommendFresh: true,
    timeSinceLastResponse,
    eventsSince,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}
