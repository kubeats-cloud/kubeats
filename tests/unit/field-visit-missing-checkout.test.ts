import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks = vi.hoisted(() => ({sheet:vi.fn(),query:vi.fn()}));
vi.mock('@/lib/supabase/server',() => ({createClient:async () => ({from:() => {
  const q = {select:() => q,gte:() => q,lt:() => q,order:() => q,range:() => mocks.query()};return q;
}})}));
vi.mock('@/lib/place-cache',() => ({areasFor:async () => new Map()}));
vi.mock('@/lib/xlsx',() => ({buildWorkbook:mocks.sheet}));
import { buildFieldVisitExport } from '@/lib/exports/field-visit-export';

describe('field-visit check-out integrity',() => {
  beforeEach(() => {
    vi.resetAllMocks();mocks.sheet.mockReturnValue(new Uint8Array());
  });
  it('keeps exact five columns and exports missing check-out as blank',async () => {
    mocks.query.mockResolvedValue({error:null,data:[{
      id:'synthetic',checkin_at:'2026-10-23T04:30:00Z',checkout_at:null,
      checkin_lat:null,checkin_lng:null,institutes:{name:'Synthetic Institute'},
    }]});
    expect((await buildFieldVisitExport({start:'2026-10-23',end:'2026-10-23'})).ok).toBe(true);
    const sheet = mocks.sheet.mock.calls[0][0];
    expect(sheet.rows[0]).toEqual(['Institution Name','Check-In Date','Check-In Time','Check-Out Time','Location']);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[1][3]).toBe('');
    expect(sheet.rows[1][4]).toBe('Location unavailable');
  });
  it('fails honestly if the range query fails',async () => {
    mocks.query.mockResolvedValue({data:null,error:{code:'42501'}});
    expect((await buildFieldVisitExport({start:'2026-10-23',end:'2026-10-23'})).ok).toBe(false);
    expect(mocks.sheet).not.toHaveBeenCalled();
  });
});
