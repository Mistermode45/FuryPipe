import { describe, expect, it } from 'vitest';

import { CONTEXT7_PLUGIN_BUNDLE } from '../src/plugin-bundles.js';
import {
  defineFuryPluginUiExtension,
  planFuryPluginRuntimeAdmission,
  projectFuryPluginUiExtensions,
} from '../src/fury-plugin-runtime.js';

const extension=defineFuryPluginUiExtension({
  format:'furypipe-plugin-ui-extension/v1',
  id:'context7-inspector',
  slot:'inspector-panel',
  title:'Context7',
  entrypoint:'ui/inspector.html',
});

describe('Fury Plugin Runtime admission',()=>{
  it('keeps unapproved plugins rejected and grants no implicit runtime authority',()=>{
    const plan=planFuryPluginRuntimeAdmission({
      bundle:CONTEXT7_PLUGIN_BUNDLE,
      uiExtensions:[extension],
      grantedPermissions:[],
      operatorApproved:false,
    });
    expect(plan).toMatchObject({
      state:'REJECTED',
      requiresOperatorApproval:true,
      mountAuthorized:false,
      filesystemAuthorized:false,
      networkAuthorized:false,
      executionAuthorized:false,
      isolation:{
        processIsolation:'required',
        hostDomAccess:false,
        credentialAccess:false,
        filesystemAccess:'none',
        networkAccess:'none',
      },
    });
    expect(projectFuryPluginUiExtensions(plan)).toEqual([]);
  });

  it('admits metadata after operator approval while keeping UI mounting separately unauthorized',()=>{
    const plan=planFuryPluginRuntimeAdmission({
      bundle:CONTEXT7_PLUGIN_BUNDLE,
      uiExtensions:[extension],
      grantedPermissions:['network'],
      operatorApproved:true,
    });
    expect(plan.state).toBe('ADMITTED_METADATA_ONLY');
    expect(plan.bundleDigestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(projectFuryPluginUiExtensions(plan)).toEqual([
      expect.objectContaining({
        pluginId:'context7',
        extensionId:'context7-inspector',
        slot:'inspector-panel',
        renderMode:'sandboxed-iframe',
        mountAuthorized:false,
      }),
    ]);
  });

  it('rejects permission escalation and unsafe extension entrypoints',()=>{
    expect(()=>planFuryPluginRuntimeAdmission({
      bundle:CONTEXT7_PLUGIN_BUNDLE,
      grantedPermissions:['repository-write'],
      operatorApproved:true,
    })).toThrow(/permission escalation/u);

    expect(()=>defineFuryPluginUiExtension({
      format:'furypipe-plugin-ui-extension/v1',
      id:'escape',
      slot:'sidebar-panel',
      title:'Escape',
      entrypoint:'../evil.js',
    })).toThrow(/package-relative/u);
  });
});
