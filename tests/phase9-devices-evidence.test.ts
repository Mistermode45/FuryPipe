import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createFuryCapabilityIndex } from '../src/capability-index.js';
import { selectFuryCapabilitiesForTask } from '../src/capability-autopilot.js';
import { FURY_GATEWAY_CONNECT_FORMAT, FURY_GATEWAY_PROTOCOL_VERSION, parseFuryGatewayConnectEnvelope } from '../src/gateway.js';
import { createFuryGatewayDeviceAuthCoordinator, createFuryGatewayDeviceProof } from '../src/gateway-auth-node.js';
import { createFuryGatewayPairingCoordinator } from '../src/gateway-pairing-node.js';
import { FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT, createFuryGatewayNodeRegistry } from '../src/gateway-node-registry-node.js';
import { createFuryGatewayNodeSessionCoordinator } from '../src/gateway-node-session-node.js';
import { FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT, createFuryGatewayPrincipalRegistry } from '../src/gateway-principal-node.js';
import { createFuryGatewaySessionCoordinator } from '../src/gateway-session-node.js';
import { FURY_MEDIA_PLUGIN_BUNDLE_FORMAT, FURY_MEDIA_PLUGIN_PROFILE_FORMAT, validateFuryMediaPluginBundle } from '../src/media-plugin-contracts.js';
import { FURY_REALTIME_VOICE_POLICY_FORMAT, createFuryRealtimeVoiceAdapterRegistry, createFuryRealtimeVoiceCoordinator, type FuryRealtimeVoiceAdapter } from '../src/media-realtime-voice.js';
import {
  FURY_PHASE9_DEVICES_EVIDENCE_FORMAT,
  createFuryPhase9DevicesEvidenceSnapshot,
  isGeneratedFuryPhase9DevicesEvidenceSnapshot,
  projectFuryPhase9DevicesIntoCapabilityIndex,
} from '../src/phase9-devices-evidence.js';

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function nodeHarness(capabilities: readonly string[] = ['camera', 'voice.realtime', 'shell']) {
  let time = 100_000;
  const now = () => time;
  const keys = generateKeyPairSync('ed25519');
  const connect = parseFuryGatewayConnectEnvelope({
    format: FURY_GATEWAY_CONNECT_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    role: 'node',
    client: { clientId: 'phase9-device', instanceId: 'node-1', platform: 'linux', deviceFamily: 'workstation' },
    capabilities: [], commands: [],
  });
  const auth = createFuryGatewayDeviceAuthCoordinator({ now });
  const challenge = auth.issueChallenge();
  const device = auth.verifyProof(connect, createFuryGatewayDeviceProof(connect, challenge, keys.privateKey));
  const pairing = createFuryGatewayPairingCoordinator({ now });
  const request = pairing.requestPairing(device);
  pairing.approvePairing(request.requestId, 'principal:owner');
  const nodes = createFuryGatewayNodeRegistry({ pairingCoordinator: pairing, now });
  const node = nodes.registerNode(device);
  const sessions = createFuryGatewayNodeSessionCoordinator({ nodeRegistry: nodes, pairingCoordinator: pairing, now, heartbeatTtlMs: 60_000 });
  const session = sessions.openSession(node, device);
  nodes.advertiseCapabilities(node, { format: FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT, generation: 1, capabilities });
  return { get time(){return time;}, set time(v:number){time=v;}, now, keys, connect, auth, device, pairing, nodes, node, sessions, session };
}

function realtimeHarness(adapterOverride: Partial<FuryRealtimeVoiceAdapter> = {}) {
  const h = nodeHarness(['voice.realtime']);
  const principals = createFuryGatewayPrincipalRegistry({ now: h.now, evidenceTtlMs: 300_000 });
  const principal = principals.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:owner', kind: 'human', issuer: 'local', subject: 'owner', authenticationMethod: 'local-owner',
  });
  const gatewaySessions = createFuryGatewaySessionCoordinator({ principalRegistry: principals, gatewayInstanceId: 'g99', now: h.now, defaultTtlMs: 120_000, maxTtlMs: 300_000, terminalRetentionMs: 30_000 });
  const gatewaySession = gatewaySessions.issueSession({ principal, role: 'operator', scopes: ['nodes.manage', 'nodes.inspect'], binding: { kind: 'local-operator' } });
  const bundle = validateFuryMediaPluginBundle({
    format: FURY_MEDIA_PLUGIN_BUNDLE_FORMAT, id: 'rt-lab', version: '1.0.0',
    permissions: ['media-read','media-write','voice-realtime'],
    source: { url:'https://github.com/example/rt-lab', commitSha:'1234567890abcdef1234567890abcdef12345678', licenseStatus:'VERIFIED', licenseSpdx:'MIT' },
    profiles:[{ format:FURY_MEDIA_PLUGIN_PROFILE_FORMAT,id:'rt',family:'realtime-voice-provider',permissions:['media-read','media-write','voice-realtime'],supportedMediaTypes:['audio/wav'],bounds:{maxInputBytes:4096,maxOutputBytes:4096,maxItems:1,maxDurationMs:60_000},health:{status:'healthy',observedAt:h.time,authority:'health-observation-only',executionAuthority:false},secretRefs:[],lifecycle:'registered',compatibility:['phase9-v1'] }],
  });
  const adapter: FuryRealtimeVoiceAdapter = { bundleId:'rt-lab',bundleVersion:'1.0.0',profileId:'rt',sendFrame:async()=>({status:'accepted'}),interrupt:async()=>({status:'acknowledged'}),cancel:async()=>({status:'acknowledged'}),...adapterOverride };
  const adapters=createFuryRealtimeVoiceAdapterRegistry([adapter]);
  const coordinator=createFuryRealtimeVoiceCoordinator({ gatewaySessionCoordinator:gatewaySessions,gatewaySession,nodeSessionCoordinator:h.sessions,nodeSession:h.session,nodeRegistry:h.nodes,node:h.node,adapters,now:h.now,maxHealthAgeMs:60_000,maxLeaseTtlMs:60_000 });
  const req=coordinator.prepare({bundle,profileId:'rt',direction:'duplex',sourceDigestSha256:sha256('src'),sinkDigestSha256:sha256('sink'),maxBytes:4096,maxFrames:8,maxDurationMs:30_000});
  const lease=coordinator.authorize(req,{format:FURY_REALTIME_VOICE_POLICY_FORMAT,policyId:'rt-policy',allowStream:true,requestDigestSha256:req.requestDigestSha256,bundleId:req.bundleId,bundleVersion:req.bundleVersion,profileId:req.profileId,direction:req.direction,sourceDigestSha256:req.sourceDigestSha256,sinkDigestSha256:req.sinkDigestSha256,expiresInMs:20_000});
  return {...h, principals, gatewaySessions, gatewaySession, bundle, adapters, coordinator, req, lease};
}

describe('FuryPipe Phase 9 Capability Autopilot + Devices evidence surface',()=>{
  it('projects only current live Phase 9 device capabilities into the existing index',()=>{
    const h=nodeHarness(); const index=createFuryCapabilityIndex();
    const report=projectFuryPhase9DevicesIntoCapabilityIndex({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]});
    expect(report).toMatchObject({indexed:2,skippedNodes:0,skippedCapabilities:1,authority:'projection-only',executionAuthority:false,activationAuthority:false,connectionAuthority:false});
    const records=index.list('plugin');
    expect(records.map(r=>r.families).flat()).toContain('phase9-device');
    expect(records.every(r=>r.executionAuthority===false&&r.source.system==='host'&&r.health==='ready')).toBe(true);
    expect(records.some(r=>r.requiredPermissions.includes('device-camera'))).toBe(true);
    expect(records.some(r=>r.requiredPermissions.includes('voice-realtime'))).toBe(true);
  });

  it('keeps Capability Autopilot selection-only for a projected camera surface',()=>{
    const h=nodeHarness(['camera']); const index=createFuryCapabilityIndex();
    projectFuryPhase9DevicesIntoCapabilityIndex({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]});
    const camera=index.list('plugin')[0]!;
    const plan=selectFuryCapabilitiesForTask({objective:'use the camera input',index,explicitRequests:[{kind:'plugin',id:camera.id}],availablePermissions:['device-camera'],hostCompatibility:['phase9-v1']});
    expect(plan.selected.map(x=>x.id)).toContain(camera.id);
    expect(plan.authority).toBe('selection-only');
    expect(plan.executionAuthority).toBe(false);
  });

  it('removes stale projected capabilities after reconnect until a newer advertisement exists',()=>{
    const h=nodeHarness(['camera']); const index=createFuryCapabilityIndex();
    expect(projectFuryPhase9DevicesIntoCapabilityIndex({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]}).indexed).toBe(1);
    expect(h.sessions.closeSession(h.session)).toBe(true);
    h.sessions.openSession(h.node,h.device);
    const report=projectFuryPhase9DevicesIntoCapabilityIndex({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]});
    expect(report).toMatchObject({indexed:0,skippedNodes:1,removed:1});
    expect(index.list('plugin')).toHaveLength(0);
  });

  it('restores discoverability only after a newer post-reconnect advertisement generation',()=>{
    const h=nodeHarness(['camera']); const index=createFuryCapabilityIndex();
    h.sessions.closeSession(h.session); h.sessions.openSession(h.node,h.device);
    h.nodes.advertiseCapabilities(h.node,{format:FURY_GATEWAY_NODE_CAPABILITY_ADVERTISEMENT_INPUT_FORMAT,generation:2,capabilities:['camera']});
    const report=projectFuryPhase9DevicesIntoCapabilityIndex({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]});
    expect(report.indexed).toBe(1); expect(index.list('plugin')[0]?.health).toBe('ready');
  });

  it('rejects copied node descriptors rather than projecting lookalike authority',()=>{
    const h=nodeHarness(['camera']); const index=createFuryCapabilityIndex();
    expect(()=>projectFuryPhase9DevicesIntoCapabilityIndex({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[{...h.node}]})).toThrow(/process-local|descriptor set/u);
  });

  it('requires the complete current registry descriptor set',()=>{
    const h=nodeHarness(['camera']); const index=createFuryCapabilityIndex();
    expect(()=>projectFuryPhase9DevicesIntoCapabilityIndex({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[]})).toThrow(/complete current registry/u);
  });

  it('rolls back partial projection when the shared index cannot accept all entries',()=>{
    const h=nodeHarness(['camera','microphone']); const index=createFuryCapabilityIndex({maxRecords:1});
    expect(()=>projectFuryPhase9DevicesIntoCapabilityIndex({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]})).toThrow();
    expect(index.snapshot().count).toBe(0);
  });

  it('builds digest-only dashboard observations without raw registry/session identifiers',()=>{
    const h=nodeHarness(['camera','voice.realtime']); const index=createFuryCapabilityIndex();
    projectFuryPhase9DevicesIntoCapabilityIndex({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]});
    const snapshot=createFuryPhase9DevicesEvidenceSnapshot({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]});
    expect(snapshot).toMatchObject({format:FURY_PHASE9_DEVICES_EVIDENCE_FORMAT,nodeCount:1,connectedNodeCount:1,authority:'dashboard-observation-only',executionAuthority:false,activationAuthority:false,connectionAuthority:false,policyAuthority:false});
    expect(isGeneratedFuryPhase9DevicesEvidenceSnapshot(snapshot)).toBe(true);
    expect(snapshot.nodes[0]?.capabilities).toEqual(['camera','voice.realtime']);
    const encoded=JSON.stringify(snapshot);
    expect(encoded).not.toContain(h.node.registrationId);
    expect(encoded).not.toContain(h.node.deviceId);
    expect(encoded).not.toContain(h.session.sessionId);
    expect(encoded).not.toContain(h.session.livenessEpoch);
  });

  it('marks disconnected nodes as observations only with no current capabilities',()=>{
    const h=nodeHarness(['camera']); const index=createFuryCapabilityIndex();
    h.sessions.closeSession(h.session);
    const snapshot=createFuryPhase9DevicesEvidenceSnapshot({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]});
    expect(snapshot.nodes[0]).toMatchObject({connected:false,capabilities:[],executionAuthority:false});
  });

  it('exposes a genuine realtime lease as bounded plugin/profile observation metadata',()=>{
    const h=realtimeHarness(); const index=createFuryCapabilityIndex();
    const snapshot=createFuryPhase9DevicesEvidenceSnapshot({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node],realtime:[{coordinator:h.coordinator,lease:h.lease}]});
    expect(snapshot.activities[0]).toMatchObject({kind:'realtime-voice',status:'live',bundleId:'rt-lab',profileId:'rt',unknownOutcome:false,retrySafe:false,automaticReplayAllowed:false,executionAuthority:false});
    expect(JSON.stringify(snapshot.activities[0])).not.toContain('provider-session');
  });

  it('surfaces explicit realtime unknown outcome without making it retry-safe',async()=>{
    const h=realtimeHarness({sendFrame:async()=>({status:'unknown'})}); const index=createFuryCapabilityIndex();
    await expect(h.coordinator.sendFrame(h.lease,{format:'furypipe-realtime-voice-frame/v1',sequence:1,direction:'input',mimeType:'audio/wav',bytes:new Uint8Array([1,2,3])})).rejects.toMatchObject({outcome:'unknown',retrySafe:false});
    const snapshot=createFuryPhase9DevicesEvidenceSnapshot({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node],realtime:[{coordinator:h.coordinator,lease:h.lease}]});
    expect(snapshot).toMatchObject({unknownOutcomeCount:1});
    expect(snapshot.activities[0]).toMatchObject({status:'unknown',unknownOutcome:true,retrySafe:false,automaticReplayAllowed:false});
  });

  it('rejects copied realtime lease observations',()=>{
    const h=realtimeHarness(); const index=createFuryCapabilityIndex();
    expect(()=>createFuryPhase9DevicesEvidenceSnapshot({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node],realtime:[{coordinator:h.coordinator,lease:{...h.lease}}]})).toThrow(/process-local/u);
  });

  it('rejects activity evidence bound to a node outside the Devices snapshot',()=>{
    const h=nodeHarness(['camera']); const rt=realtimeHarness(); const index=createFuryCapabilityIndex();
    expect(()=>createFuryPhase9DevicesEvidenceSnapshot({
      index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node],
      realtime:[{coordinator:rt.coordinator,lease:rt.lease}],
    })).toThrow(/outside this snapshot/u);
  });

  it('does not accept forged capture or voice result evidence',()=>{
    const h=nodeHarness(); const index=createFuryCapabilityIndex();
    expect(()=>createFuryPhase9DevicesEvidenceSnapshot({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node],captures:[{request:{} as never,result:{} as never}]})).toThrow(/process-local/u);
    expect(()=>createFuryPhase9DevicesEvidenceSnapshot({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node],voiceResults:[{} as never]})).toThrow(/process-local/u);
  });

  it('enforces bounded dashboard nodes and activities',()=>{
    const h=nodeHarness(); const index=createFuryCapabilityIndex();
    expect(()=>createFuryPhase9DevicesEvidenceSnapshot({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node],maxNodes:0})).toThrow(/maxNodes/u);
    expect(()=>createFuryPhase9DevicesEvidenceSnapshot({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node],realtime:[],maxActivities:0})).not.toThrow();
    const rt=realtimeHarness();
    expect(()=>createFuryPhase9DevicesEvidenceSnapshot({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node],realtime:[{coordinator:rt.coordinator,lease:rt.lease}],maxActivities:0})).toThrow(/activity count|item bound/u);
  });

  it('keeps every projected record free of activation, connection or execution authority',()=>{
    const h=nodeHarness(['camera','microphone','speaker','notifications','media.image.input','voice.stt','voice.tts','voice.realtime']); const index=createFuryCapabilityIndex();
    projectFuryPhase9DevicesIntoCapabilityIndex({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]});
    const encoded=JSON.stringify(index.snapshot());
    expect(encoded).not.toContain('executionAuthority":true');
    expect(index.list('plugin').every(r=>r.executionAuthority===false)).toBe(true);
  });

  it('uses minimum capability-specific permission surfaces',()=>{
    const h=nodeHarness(['camera','microphone','speaker','notifications','media.image.input','voice.stt','voice.tts','voice.realtime']); const index=createFuryCapabilityIndex();
    projectFuryPhase9DevicesIntoCapabilityIndex({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]});
    const perms=new Map(index.list('plugin').map(r=>[r.families.at(-1),r.requiredPermissions]));
    expect(index.list('plugin').find(r=>r.id.endsWith(':camera'))?.requiredPermissions).toEqual(['device-camera']);
    expect(index.list('plugin').find(r=>r.id.endsWith(':microphone'))?.requiredPermissions).toEqual(['device-microphone']);
    expect(index.list('plugin').find(r=>r.id.endsWith(':voice.realtime'))?.requiredPermissions).toEqual(['voice-realtime']);
    expect(index.list('plugin').find(r=>r.id.endsWith(':media.image.input'))?.requiredPermissions).toEqual(['media-read']);
    expect(perms.size).toBeGreaterThan(0);
  });

  it('makes snapshot authenticity process-local',()=>{
    const h=nodeHarness(); const index=createFuryCapabilityIndex();
    const s=createFuryPhase9DevicesEvidenceSnapshot({index,nodeRegistry:h.nodes,nodeSessionCoordinator:h.sessions,nodes:[h.node]});
    expect(isGeneratedFuryPhase9DevicesEvidenceSnapshot({...s})).toBe(false);
  });
});
