import { describe, expect, it } from 'vitest';

import { createFuryArtifactStore } from '../src/fury-artifacts.js';

describe('Fury Artifacts', () => {
  it('versions artifacts immutably and restores by creating a new revision', () => {
    const store = createFuryArtifactStore();
    const v1 = store.create({
      artifactId:'report',
      label:'Report.md',
      kind:'document',
      mediaType:'text/markdown',
      payload:'# v1',
      tags:['report','final'],
      recordedAt:'2026-09-26T16:20:00Z',
      provenance:'test',
    });
    const v2 = store.revise('report',{
      label:'Report.md',
      payload:'# v2',
      tags:['final','report'],
      recordedAt:'2026-09-26T16:21:00Z',
      provenance:'test',
    });
    const restored = store.restore('report',1,'2026-09-26T16:22:00Z');

    expect([v1.revision,v2.revision,restored.revision]).toEqual([1,2,3]);
    expect(restored.contentSha256).toBe(v1.contentSha256);
    expect(restored.restoredFromRevision).toBe(1);
    expect(store.history('report').map((entry)=>entry.revision)).toEqual([1,2,3]);
  });

  it('searches deterministic head metadata and exports without I/O authority', () => {
    const store = createFuryArtifactStore();
    store.create({
      artifactId:'diagram',
      label:'Architecture diagram',
      kind:'image',
      mediaType:'image/png',
      payload:new Uint8Array([1,2,3,4]),
      tags:['architecture'],
      recordedAt:'2026-09-26T16:20:00Z',
    });
    store.create({
      artifactId:'notes',
      label:'Notes',
      kind:'document',
      mediaType:'text/plain',
      payload:'hello',
      tags:['notes'],
      recordedAt:'2026-09-26T16:20:01Z',
    });

    expect(store.search({query:'architecture'}).map((entry)=>entry.artifactId)).toEqual(['diagram']);
    const exported=store.export('diagram');
    expect(exported).toMatchObject({
      format:'furypipe-artifact-export/v1',
      filesystemAuthorized:false,
      networkAuthorized:false,
      executionAuthorized:false,
    });
    expect(exported.exportDigestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Buffer.from(exported.payloadBase64,'base64')).toEqual(Buffer.from([1,2,3,4]));
  });

  it('fails closed on traversal-like ids, invalid media types and oversized search limits', () => {
    const store=createFuryArtifactStore();
    expect(()=>store.create({
      artifactId:'../escape',
      label:'x',
      kind:'other',
      mediaType:'application/octet-stream',
      payload:'x',
      recordedAt:'2026-09-26T16:20:00Z',
    })).toThrow(/artifactId/u);

    expect(()=>store.create({
      artifactId:'bad-media',
      label:'x',
      kind:'other',
      mediaType:'not-a-media-type',
      payload:'x',
      recordedAt:'2026-09-26T16:20:00Z',
    })).toThrow(/mediaType/u);

    expect(()=>store.search({limit:101})).toThrow(/1\.\.100/u);
  });
});
