import { type Result, err, ok } from '@itadaki/shared/domain';
import { type Role } from './role';

export interface StaffUser {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
  readonly active: boolean;
}

/** What a verified session carries. Never includes the password hash. */
export interface StaffSession {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: Role;
  readonly displayName: string;
  readonly expiresAt: Date;
}

export type CredentialError =
  | { readonly kind: 'INVALID_EMAIL'; readonly email: string }
  | { readonly kind: 'PASSWORD_TOO_SHORT'; readonly length: number };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The password half alone, for flows where the address is already known. */
export function validatePassword(password: string): Result<string, CredentialError> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return err({ kind: 'PASSWORD_TOO_SHORT', length: password.length });
  }
  return ok(password);
}

/** Validated before hashing, so a rejected password never reaches storage. */
export function validateCredentials(
  email: string,
  password: string,
): Result<{ email: string; password: string }, CredentialError> {
  const normalised = normaliseEmail(email);
  if (!EMAIL_PATTERN.test(normalised)) {
    return err({ kind: 'INVALID_EMAIL', email });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return err({ kind: 'PASSWORD_TOO_SHORT', length: password.length });
  }
  return ok({ email: normalised, password });
}

export function isSessionValid(session: StaffSession, now: Date): boolean {
  return session.expiresAt.getTime() > now.getTime();
}
