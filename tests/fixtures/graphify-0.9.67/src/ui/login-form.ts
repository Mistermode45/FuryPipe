import { renderButton } from './button.js';
import { login } from '../auth/login.js';
export function submit(user: string, password: string): string {
  return renderButton(login(user, password));
}
