/**
 * Calendar Integration (SP6 §1)
 *
 * - Deadline sync: mirror process deadlines to calendar events
 * - Availability check: query calendar for scheduling decisions
 * - Inbound: calendar event changes feed into interpretation pipeline
 */

import type postgres from 'postgres';
import { ExternalPipeline, type RawExternalEvent } from '../services/external-pipeline.js';

type Sql = ReturnType<typeof postgres>;

// ── Types ────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id?: string;
  title: string;
  description?: string;
  start: string; // ISO datetime
  end: string;   // ISO datetime
  attendees?: string[];
  location?: string;
  reminder_minutes?: number;
}

export interface AvailabilitySlot {
  start: string;
  end: string;
  status: 'free' | 'busy' | 'tentative';
}

// ── Calendar Integration Service ────────────────────────────────────

export class CalendarIntegration {
  private pipeline: ExternalPipeline;

  constructor(private sql: Sql) {
    this.pipeline = new ExternalPipeline(sql);
  }

  // ── Deadline Sync ─────────────────────────────────────────────

  /**
   * Sync a process deadline to the calendar.
   * Creates or updates a calendar event for the move deadline.
   */
  async syncDeadline(
    integrationId: string,
    moveId: string,
    moveTitle: string,
    caseTitle: string,
    deadline: string,
    assignedUserEmails: string[],
  ): Promise<{ success: boolean; calendar_event_id?: string; error?: string }> {
    const [integration] = await this.sql`
      SELECT credentials_encrypted, settings FROM integrations
      WHERE id = ${integrationId} AND type = 'calendar'
    `;

    if (!integration?.credentials_encrypted) {
      return { success: false, error: 'Calendar integration not connected' };
    }

    // In production: create/update Google Calendar or CalDAV event
    const calendarEvent: CalendarEvent = {
      title: `[Process OS] ${moveTitle}`,
      description: `Case: ${caseTitle}\nMove: ${moveTitle}\nDeadline for completion.`,
      start: deadline,
      end: new Date(new Date(deadline).getTime() + 30 * 60000).toISOString(), // 30 min block
      attendees: assignedUserEmails,
      reminder_minutes: 60,
    };

    console.log(`[Calendar] Would sync deadline for move ${moveId}:`, calendarEvent);

    return {
      success: true,
      calendar_event_id: `cal-${moveId}`,
    };
  }

  /**
   * Remove a deadline from the calendar (move completed or cancelled).
   */
  async removeDeadline(
    integrationId: string,
    calendarEventId: string,
  ): Promise<{ success: boolean }> {
    // In production: delete the calendar event via API
    console.log(`[Calendar] Would remove deadline event ${calendarEventId}`);
    return { success: true };
  }

  // ── Availability Check ────────────────────────────────────────

  /**
   * Check availability of users for scheduling a decision meeting or review.
   */
  async checkAvailability(
    integrationId: string,
    userEmails: string[],
    timeMin: string,
    timeMax: string,
  ): Promise<{
    available_slots: AvailabilitySlot[];
    busy_periods: Array<{ email: string; periods: AvailabilitySlot[] }>;
  }> {
    const [integration] = await this.sql`
      SELECT credentials_encrypted FROM integrations
      WHERE id = ${integrationId} AND type = 'calendar'
    `;

    if (!integration?.credentials_encrypted) {
      return { available_slots: [], busy_periods: [] };
    }

    // In production: query Google Calendar freebusy API or CalDAV
    // For now, return placeholder data
    return {
      available_slots: [
        {
          start: timeMin,
          end: timeMax,
          status: 'free',
        },
      ],
      busy_periods: userEmails.map((email) => ({
        email,
        periods: [],
      })),
    };
  }

  /**
   * Find the next available slot for all specified users.
   */
  async findNextAvailableSlot(
    integrationId: string,
    userEmails: string[],
    durationMinutes: number,
    startFrom?: string,
  ): Promise<{ slot: AvailabilitySlot | null }> {
    const from = startFrom ?? new Date().toISOString();
    const to = new Date(Date.now() + 7 * 24 * 3600000).toISOString(); // 7 days ahead

    const { available_slots } = await this.checkAvailability(
      integrationId,
      userEmails,
      from,
      to,
    );

    // Find a slot long enough
    const slot = available_slots.find((s) => {
      const duration = (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000;
      return duration >= durationMinutes && s.status === 'free';
    });

    return { slot: slot ?? null };
  }

  // ── Inbound: Calendar Changes ─────────────────────────────────

  /**
   * Handle an inbound calendar change event (via webhook or push notification).
   */
  async handleCalendarChange(
    integrationId: string,
    changeType: string,
    eventData: Record<string, unknown>,
  ): Promise<void> {
    const rawEvent: RawExternalEvent = {
      integration_id: integrationId,
      source_type: 'calendar',
      event_type: changeType, // e.g. 'event.updated', 'event.deleted'
      payload: eventData,
    };

    await this.pipeline.process(rawEvent);
  }
}
