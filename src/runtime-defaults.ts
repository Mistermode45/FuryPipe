export const FURYPIPE_DEFAULT_HOST = '127.0.0.1';
export const FURYPIPE_DEFAULT_PORT = 48721;

export function parseFuryPipePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return FURYPIPE_DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('FURYPIPE_PORT must be an integer between 1 and 65535');
  }
  return port;
}
