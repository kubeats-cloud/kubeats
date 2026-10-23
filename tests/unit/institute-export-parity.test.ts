import { beforeEach,describe,expect,it,vi } from 'vitest';
import { buildInstituteActivityRows } from '@/lib/institute-activity-counts';
import { SEED_STATUS_CATALOGUE } from '@/lib/validation/institute';
import {
  buildInstituteActivityExport,
  buildInstituteStatusActivityExport,
  presenceSheetRows,
  repInstituteSheetRows,
  statusActivitySheetRows,
} from '@/lib/exports/institute-activity-export';
import {
  instituteActivityExportHref,
  instituteActivityExportRangeProblem,
  instituteActivitySortHref,
} from '@/lib/institute-activity-links';

const exportMocks = vi.hoisted(() => ({statusModel:vi.fn(),model:vi.fn(),book:vi.fn()}));
vi.mock('@/lib/institute-activity-report',() => ({
  getInstituteStatusActivityModel:exportMocks.statusModel,
  getInstituteActivityModel:exportMocks.model,
}));
vi.mock('@/lib/xlsx',() => ({buildWorkbook:exportMocks.book}));

const rows = buildInstituteActivityRows({institutes:[{id:'synthetic',name:'Synthetic Institute'}],
  visits:[{institute_id:'synthetic',activity:'meeting',lifecycle_status:null,status_set_to:'First meeting done'}],
  meetingsCompletedByInstitute:new Map([['synthetic',2]]),followUpsOwnedByInstitute:new Map([['synthetic',3]]),
  followUpsPendingByInstitute:new Map([['synthetic',1]]),presenceByInstitute:new Map(),catalogue:SEED_STATUS_CATALOGUE}).rows;

const zero = {open:0,closed:0};
const sqlTotals = {meeting:{open:700,closed:17},session:zero,campus_visit:zero,
  olympiad:zero,application:zero,admission:zero};

const statuses = [
  {status:'First meeting done',category:'open' as const,sortOrder:1},
  {status:'RSVP received',category:'closed' as const,sortOrder:2},
];
const visits = [
  {institute:'Synthetic Institute',member:'Synthetic Rep',activity:'meeting',date:'2026-10-01',
    status:'First meeting done',checkinAt:'2026-10-01T05:00:00.000Z',checkoutAt:null,location:'Synthetic Area',
    followUpDate:'2026-10-05',followUpTime:'09:30:00',followUpCreated:true},
  {institute:'Synthetic Institute',member:'Synthetic Rep',activity:'meeting',date:'2026-10-02',
    status:'RSVP received',checkinAt:null,checkoutAt:null,location:null,
    followUpDate:null,followUpTime:null,followUpCreated:false},
];
const statusTotals = {byStatus:{'First meeting done':1,'RSVP received':1},totalVisits:2,
  meetingsCompleted:2,followUpsOwned:3,followUpsPending:1};

describe('visit-level export shape and parity',() => {
  beforeEach(() => { vi.resetAllMocks(); exportMocks.book.mockReturnValue(new Uint8Array([1])); });
  it('exports every visit and a Total row that equals the status totals on screen',() => {
    const sheet = statusActivitySheetRows(statuses,visits);
    expect(sheet).toHaveLength(visits.length+2);
    // Parity: each status column in the file sums to the number the table
    // shows for that status over the same filter.
    for (const [index,status] of statuses.entries()) {
      const fileSum = sheet.slice(1,-1)
        .reduce((sum,row) => sum + Number(row[10+index] ?? 0),0);
      expect(fileSum).toBe(statusTotals.byStatus[status.status as keyof typeof statusTotals.byStatus]);
      expect(sheet.at(-1)?.[10+index]).toBe(fileSum);
    }
  });
  it('asks the admin model for every matching visit and writes its exact sheet',async () => {
    exportMocks.statusModel.mockResolvedValue({ok:true,model:{rows:[],statuses,range:{from:'2026-10-01',to:'2026-10-02'},
      rangeActive:true,sort:{key:'institute',dir:'asc'},totalInstitutes:1,totals:statusTotals,
      visits,visitCount:2,page:1,pages:1}});
    const result = await buildInstituteStatusActivityExport({range:{from:'2026-10-01',to:'2026-10-02'}});
    expect(result.ok).toBe(true);
    expect(exportMocks.statusModel).toHaveBeenCalledWith(expect.objectContaining({allRows:true,page:undefined}));
    const sheet = exportMocks.book.mock.calls[0][0] as {rows:unknown[][]};
    expect(sheet.rows).toHaveLength(visits.length+2);
    expect(sheet.rows.at(-1)).toEqual(['Total',...Array(9).fill(null),1,1,null,null,1]);
  });
  it('matches the rep consolidated table columns and totals',() => {
    const sheet = repInstituteSheetRows(rows);
    expect(sheet[0]).toEqual(['Institute','Type','Location','Status','Open','Closed','Follow-ups owned','Follow-ups pending','Meetings completed']);
    expect(sheet[1].slice(4)).toEqual([1,0,3,1,2]);
    expect(sheet.at(-1)?.slice(4)).toEqual(sheet[1].slice(4));
  });
  it('matches R7 columns and never manufactures missing times or locations',() => {
    const sheet = presenceSheetRows(rows);
    expect(sheet[0]).toHaveLength(9);
    expect(sheet[1].slice(1,4)).toEqual(['Not recorded','Not recorded','—']);
    expect(sheet.at(-1)?.slice(4)).toEqual(sheet[1].slice(4));
  });
  it('exports every rep/presence row too, never one page',async () => {
    exportMocks.model.mockResolvedValue({ok:true,model:{rows,range:{from:'2026-10-01',to:'2026-10-02'},
      rangeActive:true,sort:{key:'institute',dir:'asc'},totalInstitutes:1,reconciliationFailed:false,
      page:2,pages:9,totals:{byActivity:sqlTotals,totalActivities:1,meetingsCompleted:2,followUpsOwned:3,
        followUpsPending:1,totalVisits:1}}});
    const result = await buildInstituteActivityExport({view:'presence',range:{from:'2026-10-01',to:'2026-10-02'},page:'2'});
    expect(result.ok).toBe(true);
    expect(exportMocks.model).toHaveBeenCalledWith(expect.objectContaining({allRows:true,page:undefined}));
  });
  it('preserves every filter in export URLs; page is not part of the file',() => {
    const href = instituteActivityExportHref({range:{from:'2026-10-01',to:'2026-10-23'},sortKey:'status:RSVP received',sortDir:'desc',search:'Synthetic',member:'rep-id',campus:'campus-id'});
    const params = new URL(href,'http://localhost').searchParams;
    expect(Object.fromEntries(params)).toEqual({from:'2026-10-01',to:'2026-10-23',sort:'status:RSVP received',dir:'desc',q:'Synthetic',member:'rep-id',campus:'campus-id'});
    const sort = instituteActivitySortHref({key:'total_visits',currentKey:'institute',currentDir:'asc',range:{},basePath:'/institutes',extraParams:{view:'activity',q:'Synthetic',member:'rep-id'}});
    expect(sort).toContain('view=activity');
    expect(sort).toContain('q=Synthetic');
    expect(sort).toContain('member=rep-id');
    expect(sort).not.toContain('page=');
  });
});

describe('the export range guard',() => {
  it('requires both dates',() => {
    expect(instituteActivityExportRangeProblem({})).toBe('Choose a From and To date for the Excel export.');
    expect(instituteActivityExportRangeProblem({from:'2026-10-01'})).toBe('Choose a From and To date for the Excel export.');
  });
  it('accepts 31 inclusive days and refuses 32',() => {
    expect(instituteActivityExportRangeProblem({from:'2026-10-01',to:'2026-10-31'})).toBeNull();
    expect(instituteActivityExportRangeProblem({from:'2026-10-01',to:'2026-11-01'}))
      .toBe('Choose a date range of 31 days or fewer for the Excel export.');
  });
  it('refuses a backwards range',() => {
    expect(instituteActivityExportRangeProblem({from:'2026-10-02',to:'2026-10-01'}))
      .toBe('The To date must not be before the From date.');
  });
});
