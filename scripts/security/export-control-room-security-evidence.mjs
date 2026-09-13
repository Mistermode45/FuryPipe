import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  evaluateSecurityCiEvidenceExport,
  inspectSecurityCiWorkflowRuns,
  serializeControlRoomSecurityCiEvidence,
} from '../../dist/control-room/security-ci-evidence-exporter.js';
import { createGitHubActionsEvidenceClient } from './github-actions-evidence.mjs';

const MAX_WAIT_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 15 * 1000;
const SHA40 = /^[0-9a-f]{40}$/u;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sourceSha() {
  const value = requiredEnv('FURYPIPE_SECURITY_CI_SOURCE_SHA');
  if (!SHA40.test(value)) {
    throw new Error('FURYPIPE_SECURITY_CI_SOURCE_SHA must be an exact lowercase 40-character commit SHA');
  }
  return value;
}

function outputDirectory() {
  const configured = process.env.FURYPIPE_SECURITY_CI_OUTPUT_DIR?.trim();
  if (!configured) return path.resolve('artifacts/control-room-security-ci');
  if (configured.includes('\0') || configured.length > 4096) {
    throw new Error('FURYPIPE_SECURITY_CI_OUTPUT_DIR is invalid');
  }
  return path.resolve(configured);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectedRunIds(selection) {
  return Object.freeze({
    codeql: selection.selected.codeql?.runId,
    secretScan: selection.selected.secretScan?.runId,
    licenseCompliance: selection.selected.licenseCompliance?.runId,
    supplyChain: selection.selected.supplyChain?.runId,
  });
}

function evidenceRunIds(evidence) {
  return Object.freeze({
    codeql: evidence.codeql?.runId,
    secretScan: evidence.secretScan?.runId,
    licenseCompliance: evidence.licenseCompliance?.runId,
    supplyChain: evidence.supplyChain?.run.runId,
  });
}

function sameRunIdentity(a, b) {
  return a.codeql === b.codeql
    && a.secretScan === b.secretScan
    && a.licenseCompliance === b.licenseCompliance
    && a.supplyChain === b.supplyChain;
}

async function collectOnce(client, sourceCommit) {
  const workflowRuns = await client.listWorkflowRunsForCommit(sourceCommit);
  const selection = inspectSecurityCiWorkflowRuns(workflowRuns, sourceCommit);
  const supplyChainRun = selection.selected.supplyChain;
  const supplyChainJobs = supplyChainRun === undefined
    ? []
    : await client.listJobsForRun(supplyChainRun.runId);

  return evaluateSecurityCiEvidenceExport({
    sourceCommit,
    generatedAt: Date.now(),
    workflowRuns,
    supplyChainJobs,
  });
}

async function collectStableEvidence(client, sourceCommit) {
  const deadline = Date.now() + MAX_WAIT_MS;

  for (;;) {
    const evaluation = await collectOnce(client, sourceCommit);
    if (evaluation.state === 'waiting') {
      if (Date.now() >= deadline) {
        throw new Error('Security CI evidence collection timed out before all required runs/jobs were terminal');
      }
      console.log(`Security CI evidence waiting: ${evaluation.waiting.join('; ')}`);
      await delay(POLL_INTERVAL_MS);
      continue;
    }

    const candidate = evaluation.evidence;
    const freshRuns = await client.listWorkflowRunsForCommit(sourceCommit);
    const freshSelection = inspectSecurityCiWorkflowRuns(freshRuns, sourceCommit);
    if (
      freshSelection.waiting.length > 0
      || !sameRunIdentity(evidenceRunIds(candidate), selectedRunIds(freshSelection))
    ) {
      if (Date.now() >= deadline) {
        throw new Error('Security CI evidence collection timed out during final freshness verification');
      }
      console.log('Security CI evidence changed during freshness verification; collecting again');
      await delay(POLL_INTERVAL_MS);
      continue;
    }

    return candidate;
  }
}

async function main() {
  const sourceCommit = sourceSha();
  const repository = requiredEnv('GITHUB_REPOSITORY');
  const token = requiredEnv('GITHUB_TOKEN');
  const outputDir = outputDirectory();

  const client = createGitHubActionsEvidenceClient({
    repository,
    token,
  });

  const evidence = await collectStableEvidence(client, sourceCommit);
  const bytes = serializeControlRoomSecurityCiEvidence(evidence);
  const digest = createHash('sha256').update(bytes, 'utf8').digest('hex');

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const jsonPath = path.join(outputDir, 'control-room-security-ci-evidence.json');
  const checksumPath = path.join(outputDir, 'control-room-security-ci-evidence.json.sha256');

  await writeFile(jsonPath, bytes, { encoding: 'utf8', mode: 0o600 });
  await writeFile(
    checksumPath,
    `${digest}  control-room-security-ci-evidence.json\n`,
    { encoding: 'utf8', mode: 0o600 },
  );

  console.log(`Security CI evidence exported for ${sourceCommit}`);
  console.log(`SHA-256: ${digest}`);
  console.log(`Artifact directory: ${outputDir}`);
}

main().catch((caught) => {
  const message = caught instanceof Error ? caught.message : 'unknown failure';
  console.error(`Security CI evidence export failed: ${message}`);
  process.exitCode = 1;
});
