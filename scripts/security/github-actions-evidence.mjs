const API_ORIGIN = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const PER_PAGE = 100;
const MAX_PAGES = 10;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]+$/u;
const SHA40 = /^[0-9a-f]{40}$/u;

function repositoryParts(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 256) {
    throw new Error('GitHub repository identity is invalid');
  }
  const parts = value.split('/');
  if (
    parts.length !== 2
    || !parts[0]
    || !parts[1]
    || !REPOSITORY_PART.test(parts[0])
    || !REPOSITORY_PART.test(parts[1])
  ) {
    throw new Error('GitHub repository identity is invalid');
  }
  return Object.freeze({ owner: parts[0], repo: parts[1] });
}

function exactSha(value) {
  if (typeof value !== 'string' || !SHA40.test(value)) {
    throw new Error('GitHub Actions source SHA must be an exact lowercase 40-character commit SHA');
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function boundedString(value, label, max = 256) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nullableBoundedString(value, label, max = 64) {
  if (value === null) return null;
  return boundedString(value, label, max);
}

function parseTimestamp(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new Error(`${label} is invalid`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(`${label} is invalid`);
  }
  return timestamp;
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function byteLengthHeader(response) {
  const raw = response.headers.get('content-length');
  if (raw === null) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('GitHub API response content-length is invalid');
  }
  return parsed;
}

async function readBoundedText(response) {
  const declared = byteLengthHeader(response);
  if (declared !== undefined && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('GitHub API response exceeded the exporter size boundary');
  }

  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub API response exceeded the exporter size boundary');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function responseJson(response) {
  const text = await readBoundedText(response);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('GitHub API response was not valid JSON');
  }
}

function mapWorkflowRun(value, index) {
  const run = record(value, `workflow_runs[${index}]`);
  return Object.freeze({
    runId: positiveInteger(run.id, `workflow_runs[${index}].id`),
    workflowName: boundedString(run.name, `workflow_runs[${index}].name`),
    headSha: exactSha(run.head_sha),
    status: boundedString(run.status, `workflow_runs[${index}].status`, 64),
    conclusion: nullableBoundedString(
      run.conclusion,
      `workflow_runs[${index}].conclusion`,
      64,
    ),
    createdAt: parseTimestamp(run.created_at, `workflow_runs[${index}].created_at`),
  });
}

function mapWorkflowJob(value, index, runId) {
  const job = record(value, `jobs[${index}]`);
  return Object.freeze({
    jobId: positiveInteger(job.id, `jobs[${index}].id`),
    runId,
    name: boundedString(job.name, `jobs[${index}].name`),
    status: boundedString(job.status, `jobs[${index}].status`, 64),
    conclusion: nullableBoundedString(job.conclusion, `jobs[${index}].conclusion`, 64),
  });
}

export function createGitHubActionsEvidenceClient(options) {
  const { owner, repo } = repositoryParts(options?.repository);
  const token = typeof options?.token === 'string' ? options.token.trim() : '';
  if (!token || token.length > 4096 || token.includes('\0')) {
    throw new Error('GitHub Actions token is missing or invalid');
  }

  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('GitHub Actions exporter requires fetch');
  }

  const requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(requestTimeoutMs)
    || requestTimeoutMs < 1
    || requestTimeoutMs > 30_000
  ) {
    throw new Error('GitHub API request timeout is outside the allowed boundary');
  }

  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  async function request(path) {
    if (
      typeof path !== 'string'
      || !path.startsWith(`${repositoryPath}/actions/`)
      || path.includes('://')
    ) {
      throw new Error('GitHub API request path is outside the fixed Actions boundary');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    try {
      response = await fetchImpl(`${API_ORIGIN}${path}`, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': API_VERSION,
          'User-Agent': 'FuryPipe-Security-CI-Evidence-Exporter',
        },
      });
    } catch {
      if (controller.signal.aborted) {
        throw new Error('GitHub API request timed out');
      }
      throw new Error('GitHub API request failed');
    } finally {
      clearTimeout(timeout);
    }

    if (!response || typeof response.status !== 'number') {
      throw new Error('GitHub API response is invalid');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`GitHub API request failed with status ${response.status}`);
    }
    return responseJson(response);
  }

  async function listWorkflowRunsForCommit(sourceCommit) {
    const sha = exactSha(sourceCommit);
    const collected = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = record(
        await request(
          `${repositoryPath}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=${PER_PAGE}&page=${page}`,
        ),
        'workflow runs response',
      );
      const runs = payload.workflow_runs;
      if (!Array.isArray(runs)) {
        throw new Error('GitHub workflow runs response is invalid');
      }
      const totalCount = nonNegativeInteger(payload.total_count, 'workflow runs total_count');
      collected.push(...runs.map(mapWorkflowRun));

      if (runs.length < PER_PAGE || collected.length >= totalCount) {
        return Object.freeze(collected);
      }
      if (page === MAX_PAGES) {
        throw new Error('GitHub workflow run search exceeded the exporter pagination boundary');
      }
    }

    throw new Error('GitHub workflow run pagination reached an invalid state');
  }

  async function listJobsForRun(workflowRunId) {
    const runId = positiveInteger(workflowRunId, 'workflow run ID');
    const collected = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = record(
        await request(
          `${repositoryPath}/actions/runs/${runId}/jobs?filter=latest&per_page=${PER_PAGE}&page=${page}`,
        ),
        'workflow jobs response',
      );
      const jobs = payload.jobs;
      if (!Array.isArray(jobs)) {
        throw new Error('GitHub workflow jobs response is invalid');
      }
      const totalCount = nonNegativeInteger(payload.total_count, 'workflow jobs total_count');
      collected.push(...jobs.map((job, index) => mapWorkflowJob(job, index, runId)));

      if (jobs.length < PER_PAGE || collected.length >= totalCount) {
        return Object.freeze(collected);
      }
      if (page === MAX_PAGES) {
        throw new Error('GitHub workflow job search exceeded the exporter pagination boundary');
      }
    }

    throw new Error('GitHub workflow job pagination reached an invalid state');
  }

  return Object.freeze({
    listWorkflowRunsForCommit,
    listJobsForRun,
  });
}

export const GITHUB_ACTIONS_EVIDENCE_API_ORIGIN = API_ORIGIN;
export const GITHUB_ACTIONS_EVIDENCE_API_VERSION = API_VERSION;
export const GITHUB_ACTIONS_EVIDENCE_MAX_RESPONSE_BYTES = MAX_RESPONSE_BYTES;
