import { login } from '../src/auth/login.js';
export function testLogin(): boolean {
  return login('a', 'b').startsWith('session:');
}
