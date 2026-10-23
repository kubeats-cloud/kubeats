import { describe, expect, it } from 'vitest';
import { auditHref,auditWindow } from '@/lib/audit-pagination';

describe('SQL list pagination boundaries', () => {
  it('clamps invalid, empty and out-of-range pages to bounded windows', () => {
    expect(auditWindow('2',120)).toEqual({page:2,pages:3,from:50,to:99});
    expect(auditWindow('999',51)).toEqual({page:2,pages:2,from:50,to:99});
    for (const raw of ['0','-1','1.5','Infinity','NaN',undefined]) {
      expect(auditWindow(raw,0)).toEqual({page:1,pages:1,from:0,to:49});
    }
  });
  it('retains search, board and owner filters across pages', () => {
    expect(auditHref('/institutes',{q:'Synthetic school',board:'NIOS|Not applicable',owner:'synthetic'},2))
      .toBe('/institutes?q=Synthetic+school&board=NIOS%7CNot+applicable&owner=synthetic&page=2');
  });
});
