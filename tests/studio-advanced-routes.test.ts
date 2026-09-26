import { describe,expect,it } from 'vitest';
import { studioApiRoute } from '../src/studio/studio-api.js';

describe('Studio advanced route registry',()=>{
  it('registers code intelligence and managed browser routes',()=>{
    expect(studioApiRoute('/api/studio/code/intelligence')).toEqual({route:'code-intelligence',method:'POST'});
    expect(studioApiRoute('/api/studio/code/symbol')).toEqual({route:'code-symbol',method:'POST'});
    expect(studioApiRoute('/api/studio/browser/status.json')).toEqual({route:'browser-status',method:'GET'});
    expect(studioApiRoute('/api/studio/browser/sessions')).toEqual({route:'browser-session-create',method:'POST'});
    expect(studioApiRoute('/api/studio/browser/action')).toEqual({route:'browser-action',method:'POST'});
  });
});
