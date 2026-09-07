import { getLocalDb } from './db.js';

export interface DeviceIdentity {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  paired_at: string | null;
  control_plane_url: string | null;
  auth_token: string | null;
}

/**
 * Device identity storage. There is at most one row: this Claude Code
 * install's device identity as established by pairing with the control
 * plane (spec section 5.4, `POST /edge/v1/pair`).
 */
export class DeviceStore {
  /** Get the current device identity, or `null` if none has been saved. */
  get(): DeviceIdentity | null {
    const db = getLocalDb();
    const row = db.prepare<[], DeviceIdentity>('SELECT * FROM device LIMIT 1').get();
    return row ?? null;
  }

  /** Whether this device has completed pairing (has a bound user). */
  isPaired(): boolean {
    return this.get()?.user_id != null;
  }

  /** Save (create or replace) the device identity. */
  save(device: DeviceIdentity): void {
    const db = getLocalDb();
    // A single-row table: clear any previous identity so we never end up
    // with more than one device row (e.g. after re-pairing with a new id).
    db.prepare('DELETE FROM device').run();
    db.prepare(
      `INSERT INTO device (id, user_id, organization_id, paired_at, control_plane_url, auth_token)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      device.id,
      device.user_id,
      device.organization_id,
      device.paired_at,
      device.control_plane_url,
      device.auth_token,
    );
  }

  /** Clear the device identity (e.g. on unpair / logout). */
  clear(): void {
    getLocalDb().prepare('DELETE FROM device').run();
  }
}
