import { describe, expect, it } from 'vitest';
import { isForbiddenHostedMcpResolvedAddress } from '../scripts/hosted-mcp-conformance.js';

describe('hosted MCP public network boundary', () => {
  it('accepts representative public-routable IPv4 and IPv6 addresses', () => {
    for (const address of [
      '1.1.1.1',
      '8.8.8.8',
      '93.184.216.34',
      '2606:4700:4700::1111',
      '2001:4860:4860::8888',
    ]) {
      expect(isForbiddenHostedMcpResolvedAddress(address), address).toBe(false);
    }
  });

  it('rejects loopback, private, link-local, CGNAT, benchmark, documentation and multicast IPv4 ranges', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '127.0.0.1',
      '100.64.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.0.0.1',
      '192.0.2.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isForbiddenHostedMcpResolvedAddress(address), address).toBe(true);
    }
  });

  it('rejects loopback, ULA, link-local, mapped, documentation and multicast IPv6 ranges', () => {
    for (const address of [
      '::',
      '::1',
      '::ffff:192.0.2.1',
      'fc00::1',
      'fd12:3456:789a::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
    ]) {
      expect(isForbiddenHostedMcpResolvedAddress(address), address).toBe(true);
    }
  });

  it('fails closed for malformed or non-IP resolved-address inputs', () => {
    for (const address of ['', 'not-an-ip', 'mcp.example.test']) {
      expect(isForbiddenHostedMcpResolvedAddress(address), address).toBe(true);
    }
  });
});
