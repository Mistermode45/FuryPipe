import { createSession } from './session.js';
export function login(user: string, password: string): string {
  if (!password) throw new Error('password required');
  return createSession(user);
}
