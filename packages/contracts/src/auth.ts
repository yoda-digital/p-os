import { z } from 'zod';
import {
  zUserId,
  zOrganizationId,
  zWorkspaceId,
  zTeamId,
  zMembershipId,
  zDeviceId,
  zSessionId,
  zISODateString,
} from './ids.js';

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const zUser = z.object({
  id: zUserId,
  email: z.string().email(),
  display_name: z.string().min(1),
  password_hash: z.string(),
  organization_ids: z.array(zOrganizationId).default([]),
  created_at: zISODateString,
});
export type User = z.infer<typeof zUser>;

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export const zOrganization = z.object({
  id: zOrganizationId,
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  created_at: zISODateString,
});
export type Organization = z.infer<typeof zOrganization>;

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export const zWorkspace = z.object({
  id: zWorkspaceId,
  organization_id: zOrganizationId,
  name: z.string().min(1),
  created_at: zISODateString,
});
export type Workspace = z.infer<typeof zWorkspace>;

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export const zTeam = z.object({
  id: zTeamId,
  organization_id: zOrganizationId,
  name: z.string().min(1),
  member_ids: z.array(zUserId).default([]),
  created_at: zISODateString,
});
export type Team = z.infer<typeof zTeam>;

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export const MembershipRole = {
  Owner: 'owner',
  Admin: 'admin',
  Member: 'member',
  Viewer: 'viewer',
} as const;

export const zMembershipRole = z.enum(['owner', 'admin', 'member', 'viewer']);
export type MembershipRole = z.infer<typeof zMembershipRole>;

export const zMembership = z.object({
  id: zMembershipId,
  user_id: zUserId,
  organization_id: zOrganizationId,
  role: zMembershipRole,
  joined_at: zISODateString,
});
export type Membership = z.infer<typeof zMembership>;

// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------

export const DeviceTrustStatus = {
  Trusted: 'trusted',
  Pending: 'pending',
  Revoked: 'revoked',
} as const;

export const zDeviceTrustStatus = z.enum(['trusted', 'pending', 'revoked']);
export type DeviceTrustStatus = z.infer<typeof zDeviceTrustStatus>;

export const zDevice = z.object({
  id: zDeviceId,
  user_id: zUserId,
  organization_id: zOrganizationId,
  name: z.string().default(''),
  public_key: z.string(),
  trust_status: zDeviceTrustStatus.default('pending'),
  last_seen: zISODateString.optional(),
  created_at: zISODateString,
});
export type Device = z.infer<typeof zDevice>;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const zSession = z.object({
  id: zSessionId,
  user_id: zUserId,
  device_id: zDeviceId.optional(),
  token: z.string(),
  expires_at: zISODateString,
  created_at: zISODateString,
});
export type Session = z.infer<typeof zSession>;

// ---------------------------------------------------------------------------
// Auth token payload (JWT claims)
// ---------------------------------------------------------------------------

export const zAuthTokenPayload = z.object({
  sub: zUserId,
  org: zOrganizationId,
  roles: z.array(z.string()),
  iat: z.number(),
  exp: z.number(),
});
export type AuthTokenPayload = z.infer<typeof zAuthTokenPayload>;

// ---------------------------------------------------------------------------
// Login / Register request schemas
// ---------------------------------------------------------------------------

export const zLoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginRequest = z.infer<typeof zLoginRequest>;

export const zRegisterRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  display_name: z.string().min(1),
  organization_name: z.string().min(1),
});
export type RegisterRequest = z.infer<typeof zRegisterRequest>;
