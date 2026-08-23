/**
 * Authentication module for the Overlay Companion MCP management server.
 *
 * Authentication is owned by Better Auth (see better-auth.ts), mounted at
 * /api/auth. This file now contains only the shared types and the password
 * hashing helper still used for VM-connection credentials (per §7: Argon2id
 * is OWASP-recommended; never roll our own crypto — the `argon2` package is
 * the established implementation).
 */

import argon2 from 'argon2';

// ---- Shared types --------------------------------------------------------

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  roles: string[];
  provider: string;
}

export interface AuthState {
  user: AuthUser;
  sessionId: string;
  csrfToken: string;
}

// ---- Password hashing (connection credentials, §7) -----------------------

export async function hashPassword(password: string): Promise<string> {
  if (!password) {
    throw new Error('Password must not be empty');
  }
  return argon2.hash(password, { type: argon2.argon2id });
}