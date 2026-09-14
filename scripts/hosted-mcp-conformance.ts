import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { probeHostedMcpConformance } from '../src/hosted-mcp-conformance.js';

const explicitlyEnabled = process.env.FURYPIPE_ALLOW_HOSTED_MCP_PROBE === '1';
const endpoint = process.env.FURYPIPE_HOSTED_MCP_URL?.trim();
const bearerToken = process.env.FURYPIPE_HOSTED_MCP_BEARER_TOKEN?.trim();
const sourceCommit = process.env.FURYPIPE_SOURCE_COMMIT?.trim();
const outputDir = process.env.FURYPIPE_HOSTED_MCP_OUTPUT_DIR?.trim()
  || 'artifacts/hosted-mcp-conformance';

if (!explicitlyEnabled || !endpoint || !bearerToken || !sourceCommit) {
  console.log(JSON.stringify({
    format: 'furypipe-hosted-mcp-conformance-launch/v1',
    status: 'BLOCKED_EXTERNAL_ENV',
    requestExecuted: false,
    reason: 'Set FURYPIPE_ALLOW_HOSTED_MCP_PROBE=1, FURYPIPE_HOSTED_MCP_URL, FURYPIPE_HOSTED_MCP_BEARER_TOKEN and FURYPIPE_SOURCE_COMMIT.',
  }, null, 2));
  process.exitCode = 2;
} else if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  console.error('Hosted MCP validation refuses NODE_TLS_REJECT_UNAUTHORIZED=0.');
  process.exitCode = 2;
} else {
  try {
    const report = await probeHostedMcpConformance({
      endpoint,
      bearerToken,
      expectedSourceCommit: sourceCommit,
      allowInsecureHttp: process.argv.includes('--allow-insecure-http'),
    });
    const canonical = `${JSON.stringify(report, null, 2)}\n`;
    const digest = createHash('sha256').update(canonical).digest('hex');
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, 'hosted-mcp-conformance.json'), canonical, { encoding: 'utf8', mode: 0o600 });
    await writeFile(
      join(outputDir, 'hosted-mcp-conformance.json.sha256'),
      `${digest}  hosted-mcp-conformance.json\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    console.log(canonical.trimEnd());
    console.log(`evidenceSha256=${digest}`);
    if (report.status !== 'VERIFIED') process.exitCode = 1;
  } catch {
    console.error('Hosted MCP conformance failed; response bodies, endpoint details and credentials were not recorded.');
    process.exitCode = 1;
  }
}
