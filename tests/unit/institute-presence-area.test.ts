import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks = vi.hoisted(() => ({areasFor:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',() => ({createClient:async () => ({rpc:mocks.rpc})}));
vi.mock('@/lib/place-cache',() => ({areasFor:mocks.areasFor}));
vi.mock('@/lib/xlsx',() => ({buildWorkbook:vi.fn()}));
import { cellFor } from '@/lib/places';
import { getInstituteActivityModel } from '@/lib/institute-activity-report';
import { presenceSheetRows } from '@/lib/exports/institute-activity-export';

const LAT = 23.0225;
const LNG = 72.5714;
const AREA = 'Synthetic Area';
const zero = {open:0,closed:0};

function rpcData() {
  return {
    rows:[{
      id:'synthetic',name:'Synthetic Institute',type:'school',city:null,area:null,
      state:null,status:'First meeting done',
      byActivity:{meeting:{open:1,closed:0},session:zero,campus_visit:zero,
        olympiad:zero,application:zero,admission:zero},
      totalActivities:1,meetingsCompleted:0,followUpsOwned:0,followUpsPending:0,
      totalVisits:1,lastCheckinAt:'2026-10-01T05:00:00.000Z',lastCheckinArea:null,
      lastCheckoutAt:null,lastCheckoutArea:null,
      checkinLat:LAT,checkinLng:LNG,checkoutLat:null,checkoutLng:null,
    }],
    statuses:[],visits:[],visitCount:0,total:1,page:1,pages:1,
    reconciliationFailed:false,
    totals:{meeting:{open:1,closed:0},session:zero,campus_visit:zero,olympiad:zero,
      application:zero,admission:zero,totalActivities:1,meetingsCompleted:0,
      followUpsOwned:0,followUpsPending:0,totalVisits:1},
  };
}

describe('presence export location parity',() => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({data:rpcData(),error:null});
    mocks.areasFor.mockResolvedValue(new Map([[cellFor(LAT,LNG),AREA]]));
  });

  it('writes the same cached area on screen and in the all-rows export',async () => {
    const screen = await getInstituteActivityModel({});
    const file = await getInstituteActivityModel({allRows:true});
    expect(screen.ok).toBe(true);
    expect(file.ok).toBe(true);
    if (!screen.ok || !file.ok) return;
    expect(screen.model.rows[0].lastCheckinArea).toBe(AREA);
    expect(file.model.rows[0].lastCheckinArea).toBe(AREA);
    const sheet = presenceSheetRows(file.model.rows);
    expect(sheet[0][3]).toBe('Location');
    expect(sheet[1][3]).toBe(AREA);
  });

  it('still says Area unavailable when the cache has no label',async () => {
    mocks.areasFor.mockResolvedValue(new Map());
    const file = await getInstituteActivityModel({allRows:true});
    expect(file.ok).toBe(true);
    if (!file.ok) return;
    const sheet = presenceSheetRows(file.model.rows);
    expect(sheet[1][3]).toBe('Area unavailable');
  });
});
