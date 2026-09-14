import { probeOpenClawGateway } from '../src/openclaw.js';

const baseUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
const explicitlyEnabled = process.env.FURYPIPE_ALLOW_OPENCLAW_PROBE === '1';

if (!explicitlyEnabled || !baseUrl) {
  console.log(JSON.stringify({
    format: 'furypipe-openclaw-live-validation/v1',
    status: 'BLOCKED_EXTERNAL_ENV',
    requestExecuted: false,
    reason: 'Set FURYPIPE_ALLOW_OPENCLAW_PROBE=1 and OPENCLAW_GATEWAY_URL to explicitly opt in.',
  }, null, 2));
  process.exitCode = 2;
} else {
  try {
    const result = await probeOpenClawGateway({
      baseUrl,
      allowRemote: process.argv.includes('--allow-remote'),
    });
    console.log(JSON.stringify({
      format: 'furypipe-openclaw-live-validation/v1',
      status: result.overall === 'healthy' ? 'VERIFIED' : 'PARTIAL',
      requestExecuted: true,
      probe: result,
    }, null, 2));
    if (result.overall !== 'healthy') process.exitCode = 1;
  } catch {
    console.error('OpenClaw live validation failed; response bodies and credentials were not recorded.');
    process.exitCode = 1;
  }
}
