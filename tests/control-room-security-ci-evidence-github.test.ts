import { describe, expect, it } from 'vitest';

import {
  createGitHubActionsEvidenceClient,
  GITHUB_ACTIONS_EVIDENCE_API_ORIGIN,
  GITHUB_ACTIONS_EVIDENCE_API_VERSION,
  GITHUB_ACTIONS_EVIDENCE_MAX_RESPONSE_BYTES,
} from '../scripts/security/github-actions-evidence.mjs';

const SHA = 'a'.repeat(40);
const TOKEN = 'ghs_TEST_SECRET_TOKEN';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GitHub Actions Security CI evidence adapter', () => {
  it('uses the fixed GitHub API origin, exact head_sha, pinned API version and no redirects', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = createGitHubActionsEvidenceClient({
      repository: 'Mistermode45/FuryPipe',
      token: TOKEN,
      fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          total_count: 1,
          workflow_runs: [{
            id: 10,
            name: 'CodeQL',
            head_sha: SHA,
            status: 'completed',
            conclusion: 'success',
            created_at: '2026-09-13T20:00:00Z',
            token: 'DO-NOT-PROPAGATE',
            logs_url: 'https://api.github.com/private',
          }],
        });
      },
    });

    const runs = await client.listWorkflowRunsForCommit(SHA);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `${GITHUB_ACTIONS_EVIDENCE_API_ORIGIN}/repos/Mistermode45/FuryPipe/actions/runs?head_sha=${SHA}&per_page=100&page=1`,
    );
    expect(calls[0]?.init?.redirect).toBe('error');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['X-GitHub-Api-Version']).toBe(GITHUB_ACTIONS_EVIDENCE_API_VERSION);
    expect(runs).toEqual([{
      runId: 10,
      workflowName: 'CodeQL',
      headSha: SHA,
      status: 'completed',
      conclusion: 'success',
      createdAt: Date.parse('2026-09-13T20:00:00Z'),
    }]);
    expect(JSON.stringify(runs)).not.toContain(TOKEN);
    expect(JSON.stringify(runs)).not.toContain('logs_url');
    expect(JSON.stringify(runs)).not.toContain('DO-NOT-PROPAGATE');
  });

  it('paginates workflow runs explicitly and never retries a failed request', async () => {
    let calls = 0;
    const hundred = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: 'CodeQL',
      head_sha: SHA,
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-09-13T20:00:00Z',
    }));
    const client = createGitHubActionsEvidenceClient({
      repository: 'Mistermode45/FuryPipe',
      token: TOKEN,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse({ total_count: 101, workflow_runs: hundred });
        return jsonResponse({
          total_count: 101,
          workflow_runs: [{
            id: 101,
            name: 'Secret Scan',
            head_sha: SHA,
            status: 'completed',
            conclusion: 'success',
            created_at: '2026-09-13T20:00:01Z',
          }],
        });
      },
    });

    expect(await client.listWorkflowRunsForCommit(SHA)).toHaveLength(101);
    expect(calls).toBe(2);

    let failedCalls = 0;
    const failingClient = createGitHubActionsEvidenceClient({
      repository: 'Mistermode45/FuryPipe',
      token: TOKEN,
      fetchImpl: async () => {
        failedCalls += 1;
        return jsonResponse({ message: `private body ${TOKEN}` }, 500);
      },
    });
    await expect(failingClient.listWorkflowRunsForCommit(SHA))
      .rejects.toThrow('GitHub API request failed with status 500');
    expect(failedCalls).toBe(1);
  });

  it('collects latest-attempt jobs for the exact selected workflow run only', async () => {
    const urls: string[] = [];
    const client = createGitHubActionsEvidenceClient({
      repository: 'Mistermode45/FuryPipe',
      token: TOKEN,
      fetchImpl: async (url: string | URL | Request) => {
        urls.push(String(url));
        return jsonResponse({
          total_count: 2,
          jobs: [
            {
              id: 201,
              name: 'Workflow action pinning',
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.com/private',
            },
            {
              id: 202,
              name: 'GitHub dependency review',
              status: 'completed',
              conclusion: 'skipped',
              steps: [{ name: 'private step' }],
            },
          ],
        });
      },
    });

    const jobs = await client.listJobsForRun(99);
    expect(urls[0]).toContain('/actions/runs/99/jobs?filter=latest&per_page=100&page=1');
    expect(jobs).toEqual([
      {
        jobId: 201,
        runId: 99,
        name: 'Workflow action pinning',
        status: 'completed',
        conclusion: 'success',
      },
      {
        jobId: 202,
        runId: 99,
        name: 'GitHub dependency review',
        status: 'completed',
        conclusion: 'skipped',
      },
    ]);
    expect(JSON.stringify(jobs)).not.toContain('private step');
    expect(JSON.stringify(jobs)).not.toContain('github.com/private');
  });

  it('sanitizes arbitrary GitHub error bodies and never propagates Authorization data', async () => {
    const client = createGitHubActionsEvidenceClient({
      repository: 'Mistermode45/FuryPipe',
      token: TOKEN,
      fetchImpl: async () => jsonResponse({
        message: `Authorization: Bearer ${TOKEN}`,
        documentation_url: 'https://api.github.com/private',
      }, 403),
    });

    let message = '';
    try {
      await client.listWorkflowRunsForCommit(SHA);
    } catch (caught) {
      message = caught instanceof Error ? caught.message : String(caught);
    }
    expect(message).toBe('GitHub API request failed with status 403');
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain('Authorization');
    expect(message).not.toContain('api.github.com/private');
  });

  it('enforces a bounded response body before JSON parsing', async () => {
    const oversized = 'x'.repeat(GITHUB_ACTIONS_EVIDENCE_MAX_RESPONSE_BYTES + 1);
    const client = createGitHubActionsEvidenceClient({
      repository: 'Mistermode45/FuryPipe',
      token: TOKEN,
      fetchImpl: async () => new Response(oversized, { status: 200 }),
    });

    await expect(client.listWorkflowRunsForCommit(SHA))
      .rejects.toThrow(/size boundary/i);
  });

  it('times out a single request without retrying', async () => {
    let calls = 0;
    const client = createGitHubActionsEvidenceClient({
      repository: 'Mistermode45/FuryPipe',
      token: TOKEN,
      requestTimeoutMs: 5,
      fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        await new Promise<void>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return reject(new Error('missing signal'));
          if (signal.aborted) return reject(new Error('aborted'));
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        return jsonResponse({});
      },
    });

    await expect(client.listWorkflowRunsForCommit(SHA))
      .rejects.toThrow('GitHub API request timed out');
    expect(calls).toBe(1);
  });

  it('rejects arbitrary repository/base-url shaped identities and invalid SHAs', async () => {
    expect(() => createGitHubActionsEvidenceClient({
      repository: 'https://evil.example/Mistermode45/FuryPipe',
      token: TOKEN,
    })).toThrow(/repository identity/i);

    const client = createGitHubActionsEvidenceClient({
      repository: 'Mistermode45/FuryPipe',
      token: TOKEN,
      fetchImpl: async () => jsonResponse({ total_count: 0, workflow_runs: [] }),
    });
    await expect(client.listWorkflowRunsForCommit('main')).rejects.toThrow(/exact lowercase 40-character/i);
  });
});
