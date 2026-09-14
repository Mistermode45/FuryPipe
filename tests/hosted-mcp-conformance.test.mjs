import { describe, expect, it } from 'vitest';
import {
  evaluateHostedMcpEvidence,
  isForbiddenHostedMcpHostname,
  isForbiddenResolvedAddress,
  modernRpcBody,
  parseHostedMcpTarget,
  parseRpcPayloadText,
} from '../scripts/hosted-mcp-conformance.mjs';

describe('hosted MCP conformance harness', () => {
  it('rejects loopback and insecure targets by default', () => {
    expect(isForbiddenHostedMcpHostname('localhost')).toBe(true);
    expect(isForbiddenHostedMcpHostname('127.0.0.1')).toBe(true);
    expect(isForbiddenHostedMcpHostname('::1')).toBe(true);
    expect(isForbiddenHostedMcpHostname('mcp.example.test')).toBe(false);
    expect(isForbiddenResolvedAddress('10.0.0.1')).toBe(true);
    expect(isForbiddenResolvedAddress('172.16.0.1')).toBe(true);
    expect(isForbiddenResolvedAddress('192.168.1.1')).toBe(true);
    expect(isForbiddenResolvedAddress('169.254.169.254')).toBe(true);
    expect(isForbiddenResolvedAddress('100.64.0.1')).toBe(true);
    expect(isForbiddenResolvedAddress('8.8.8.8')).toBe(false);
    expect(isForbiddenResolvedAddress('2606:4700:4700::1111')).toBe(false);
    expect(() => parseHostedMcpTarget('http://mcp.example.test/mcp')).toThrow('requires HTTPS');
    expect(() => parseHostedMcpTarget('https://127.0.0.1/mcp')).toThrow('refuses loopback');
    expect(() => parseHostedMcpTarget('https://user:secret@mcp.example.test/mcp')).toThrow('credentials');
    expect(() => parseHostedMcpTarget('https://mcp.example.test/mcp?token=x')).toThrow('query strings');
    expect(parseHostedMcpTarget('https://mcp.example.test/mcp').pathname).toBe('/mcp');
  });

  it('builds the 2026-07-28 per-request envelope without credential material', () => {
    const body = modernRpcBody('case-1', 'tools/list', {});
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 'case-1',
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'furypipe-hosted-conformance',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain('Bearer');
  });

  it('parses JSON and SSE JSON frames', () => {
    expect(parseRpcPayloadText('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', 'application/json'))
      .toMatchObject({ result: { ok: true } });
    expect(parseRpcPayloadText(
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n',
      'text/event-stream',
    )).toMatchObject({ result: { tools: [] } });
  });

  it('promotes only a complete external source-bound matrix', () => {
    const complete = {
      sourceBinding: { matchesClientSource: true },
      network: { dns: { resolved: true }, tls: { applicable: true, authorized: true } },
      auth: {
        missingRejected: true,
        invalidRejected: true,
        bearerChallengeObserved: true,
        validTokenAccepted: true,
      },
      protocol: {
        modern: { discoverVerified: true, toolsListVerified: true, readOnlyFetchVerified: true },
        legacy: { verified: true },
      },
      reconnect: { verified: true },
      resilience: {
        timeout: { verified: true },
        cancellation: { clientAbortObserved: true, serviceRecovered: true },
      },
      execution: { githubHostedBoundary: true },
    };
    expect(evaluateHostedMcpEvidence(complete)).toBe('VERIFIED');
    expect(evaluateHostedMcpEvidence({
      ...complete,
      network: { ...complete.network, tls: { applicable: true, authorized: false } },
    })).toBe('PARTIAL');
    expect(evaluateHostedMcpEvidence({
      ...complete,
      execution: { githubHostedBoundary: false },
    })).toBe('PARTIAL');
  });
});
