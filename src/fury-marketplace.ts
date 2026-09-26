import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

import type { CapabilityPermissions, CapabilityType } from './ecosystem/types.js';

export const FURY_MARKETPLACE_MANIFEST_FORMAT = 'furypipe-marketplace-manifest/v1' as const;
export const FURY_MARKETPLACE_SIGNATURE_FORMAT = 'furypipe-marketplace-signature/v1' as const;
export const FURY_MARKETPLACE_PLAN_FORMAT = 'furypipe-marketplace-transition-plan/v1' as const;

export type FuryMarketplaceTrustLevel = 'OFFICIAL' | 'VERIFIED' | 'COMMUNITY' | 'RESTRICTED';
export type FuryMarketplaceTransition = 'INSTALL' | 'UPDATE' | 'ROLLBACK';
export type FuryMarketplacePlanState = 'READY_FOR_APPROVAL' | 'REJECTED';

export interface FuryMarketplaceManifestInput {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilityType: CapabilityType;
  readonly sourceUrl: string;
  readonly sourceSha256: string;
  readonly license: string;
  readonly author: string;
  readonly permissions: CapabilityPermissions;
  readonly dependencies?: readonly string[];
  readonly documentation?: readonly string[];
  readonly trust: FuryMarketplaceTrustLevel;
}

export interface FuryMarketplaceManifest extends FuryMarketplaceManifestInput {
  readonly format: typeof FURY_MARKETPLACE_MANIFEST_FORMAT;
  readonly dependencies: readonly string[];
  readonly documentation: readonly string[];
  readonly manifestDigestSha256: string;
  readonly executionAuthorized: false;
}

export interface FuryMarketplaceSignature {
  readonly format: typeof FURY_MARKETPLACE_SIGNATURE_FORMAT;
  readonly algorithm: 'Ed25519';
  readonly keyId: string;
  readonly manifestDigestSha256: string;
  readonly signatureBase64: string;
  readonly executionAuthorized: false;
}

export interface FuryMarketplaceTrustedKey {
  readonly keyId: string;
  readonly publicKeyPem: string | Buffer;
  readonly trust: Exclude<FuryMarketplaceTrustLevel, 'COMMUNITY' | 'RESTRICTED'>;
}

export interface FuryMarketplaceTransitionPlan {
  readonly format: typeof FURY_MARKETPLACE_PLAN_FORMAT;
  readonly action: FuryMarketplaceTransition;
  readonly state: FuryMarketplacePlanState;
  readonly manifestId: string;
  readonly fromVersion: string | null;
  readonly toVersion: string;
  readonly trust: FuryMarketplaceTrustLevel;
  readonly sourceUrl: string;
  readonly sourceSha256: string;
  readonly signatureVerified: boolean;
  readonly permissions: CapabilityPermissions;
  readonly dependencies: readonly string[];
  readonly reasons: readonly string[];
  readonly requiresOperatorApproval: true;
  readonly networkAuthorized: false;
  readonly filesystemAuthorized: false;
  readonly executionAuthorized: false;
}

const SHA256_RE=/^[a-f0-9]{64}$/u;
const ID_RE=/^[a-z0-9][a-z0-9._-]{0,127}$/u;
const VERSION_RE=/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/u;
const KEY_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:@+~-]{0,127}$/u;
const HTTPS_RE=/^https:\/\//iu;

function sha256(value:string):string{
  return createHash('sha256').update(value,'utf8').digest('hex');
}

function bounded(value:string,label:string,max:number):string{
  if(typeof value!=='string') throw new TypeError(`${label} must be text`);
  const trimmed=value.trim();
  if(!trimmed||trimmed.length>max||/[\u0000-\u001f\u007f]/u.test(trimmed)) throw new Error(`${label} is invalid`);
  return trimmed;
}

function list(values:readonly string[]|undefined,label:string,maxItems:number,maxChars:number):readonly string[]{
  const input=values??[];
  if(!Array.isArray(input)||input.length>maxItems) throw new Error(`${label} is invalid`);
  return Object.freeze([...new Set(input.map((value,index)=>bounded(value,`${label}[${index}]`,maxChars)))].sort());
}

function canonicalPayload(input:Omit<FuryMarketplaceManifest,'format'|'manifestDigestSha256'|'executionAuthorized'>):string{
  return JSON.stringify(input);
}

export function createFuryMarketplaceManifest(input:FuryMarketplaceManifestInput):FuryMarketplaceManifest{
  const id=bounded(input.id,'id',128).toLowerCase();
  if(!ID_RE.test(id)) throw new Error('id is invalid');
  const name=bounded(input.name,'name',160);
  const version=bounded(input.version,'version',128);
  if(!VERSION_RE.test(version)) throw new Error('version is invalid');
  const sourceUrl=bounded(input.sourceUrl,'sourceUrl',2048);
  if(!HTTPS_RE.test(sourceUrl)||/[?#].*(?:token|key|secret|password)=/iu.test(sourceUrl)) throw new Error('sourceUrl must be credential-free HTTPS');
  if(!SHA256_RE.test(input.sourceSha256)) throw new Error('sourceSha256 must be lowercase SHA-256');
  const license=bounded(input.license,'license',128);
  const author=bounded(input.author,'author',160);
  if(!['OFFICIAL','VERIFIED','COMMUNITY','RESTRICTED'].includes(input.trust)) throw new Error('trust is invalid');
  const dependencies=list(input.dependencies,'dependencies',64,160);
  const documentation=list(input.documentation,'documentation',32,2048);
  for(const url of documentation){
    if(!HTTPS_RE.test(url)) throw new Error('documentation URLs must use HTTPS');
  }
  const unsigned=Object.freeze({
    id,name,version,capabilityType:input.capabilityType,sourceUrl,sourceSha256:input.sourceSha256,
    license,author,permissions:input.permissions,dependencies,documentation,trust:input.trust,
  });
  return Object.freeze({
    format:FURY_MARKETPLACE_MANIFEST_FORMAT,
    ...unsigned,
    manifestDigestSha256:sha256(canonicalPayload(unsigned)),
    executionAuthorized:false,
  });
}

function signaturePayload(digest:string):Buffer{
  if(!SHA256_RE.test(digest)) throw new Error('manifest digest is invalid');
  return Buffer.from(`${FURY_MARKETPLACE_SIGNATURE_FORMAT}\0${digest}`,'utf8');
}

export function signFuryMarketplaceManifest(
  manifest:FuryMarketplaceManifest,
  privateKeyPem:string|Buffer,
  keyId:string,
):FuryMarketplaceSignature{
  const validKeyId=bounded(keyId,'keyId',128);
  if(!KEY_ID_RE.test(validKeyId)) throw new Error('keyId is invalid');
  const key=createPrivateKey(privateKeyPem);
  if(key.asymmetricKeyType!=='ed25519') throw new Error('marketplace signatures require Ed25519');
  return Object.freeze({
    format:FURY_MARKETPLACE_SIGNATURE_FORMAT,
    algorithm:'Ed25519',
    keyId:validKeyId,
    manifestDigestSha256:manifest.manifestDigestSha256,
    signatureBase64:sign(null,signaturePayload(manifest.manifestDigestSha256),key).toString('base64'),
    executionAuthorized:false,
  });
}

export function verifyFuryMarketplaceSignature(
  manifest:FuryMarketplaceManifest,
  signature:FuryMarketplaceSignature,
  trustedKeys:readonly FuryMarketplaceTrustedKey[],
):{readonly verified:boolean;readonly trust:FuryMarketplaceTrustLevel;readonly reason:string}{
  if(signature.format!==FURY_MARKETPLACE_SIGNATURE_FORMAT||signature.algorithm!=='Ed25519'||signature.executionAuthorized!==false
    ||signature.manifestDigestSha256!==manifest.manifestDigestSha256) {
    return Object.freeze({verified:false,trust:'RESTRICTED',reason:'signature metadata does not match the manifest'});
  }
  const trusted=trustedKeys.find((key)=>key.keyId===signature.keyId);
  if(!trusted) return Object.freeze({verified:false,trust:'RESTRICTED',reason:'signing key is not trusted'});
  const key=createPublicKey(trusted.publicKeyPem);
  if(key.asymmetricKeyType!=='ed25519') throw new Error('trusted marketplace keys must be Ed25519');
  const bytes=Buffer.from(signature.signatureBase64,'base64');
  if(bytes.length!==64||!verify(null,signaturePayload(manifest.manifestDigestSha256),key,bytes)) {
    return Object.freeze({verified:false,trust:'RESTRICTED',reason:'signature verification failed'});
  }
  const effectiveTrust=manifest.trust==='OFFICIAL'&&trusted.trust!=='OFFICIAL'
    ? 'VERIFIED'
    : manifest.trust==='RESTRICTED'
      ? 'RESTRICTED'
      : trusted.trust;
  return Object.freeze({verified:true,trust:effectiveTrust,reason:'detached Ed25519 signature verified'});
}

export function planFuryMarketplaceTransition(input:{
  readonly action:FuryMarketplaceTransition;
  readonly manifest:FuryMarketplaceManifest;
  readonly signature:FuryMarketplaceSignature;
  readonly trustedKeys:readonly FuryMarketplaceTrustedKey[];
  readonly currentVersion?:string|null;
}):FuryMarketplaceTransitionPlan{
  if(!['INSTALL','UPDATE','ROLLBACK'].includes(input.action)) throw new Error('marketplace action is invalid');
  const currentVersion=input.currentVersion==null?null:bounded(input.currentVersion,'currentVersion',128);
  if(input.action==='INSTALL'&&currentVersion!==null) throw new Error('INSTALL requires no current version');
  if((input.action==='UPDATE'||input.action==='ROLLBACK')&&currentVersion===null) throw new Error(`${input.action} requires a current version`);
  const verification=verifyFuryMarketplaceSignature(input.manifest,input.signature,input.trustedKeys);
  const reasons:string[]=[verification.reason];
  let state:FuryMarketplacePlanState='READY_FOR_APPROVAL';
  if(!verification.verified){
    state='REJECTED';
  }
  if(verification.trust==='RESTRICTED'){
    state='REJECTED';
    reasons.push('restricted trust cannot be installed automatically');
  }
  return Object.freeze({
    format:FURY_MARKETPLACE_PLAN_FORMAT,
    action:input.action,
    state,
    manifestId:input.manifest.id,
    fromVersion:currentVersion,
    toVersion:input.manifest.version,
    trust:verification.trust,
    sourceUrl:input.manifest.sourceUrl,
    sourceSha256:input.manifest.sourceSha256,
    signatureVerified:verification.verified,
    permissions:input.manifest.permissions,
    dependencies:input.manifest.dependencies,
    reasons:Object.freeze(reasons),
    requiresOperatorApproval:true,
    networkAuthorized:false,
    filesystemAuthorized:false,
    executionAuthorized:false,
  });
}
