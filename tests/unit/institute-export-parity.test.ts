import { beforeEach,describe,expect,it,vi } from 'vitest';
import { buildInstituteActivityRows } from '@/lib/institute-activity-counts';
import { SEED_STATUS_CATALOGUE } from '@/lib/validation/institute';
import { buildInstituteActivityExport,instituteActivitySheetRows,presenceSheetRows,repInstituteSheetRows } from '@/lib/exports/institute-activity-export';
import { instituteActivityExportHref,instituteActivitySortHref } from '@/lib/institute-activity-links';

const exportMocks = vi.hoisted(() => ({model:vi.fn(),book:vi.fn()}));
vi.mock('@/lib/institute-activity-report',() => ({getInstituteActivityModel:exportMocks.model}));
vi.mock('@/lib/xlsx',() => ({buildWorkbook:exportMocks.book}));

const rows = buildInstituteActivityRows({institutes:[{id:'synthetic',name:'Synthetic Institute'}],
  visits:[{institute_id:'synthetic',activity:'meeting',lifecycle_status:null,status_set_to:'First meeting done'}],
  meetingsCompletedByInstitute:new Map([['synthetic',2]]),followUpsOwnedByInstitute:new Map([['synthetic',3]]),
  followUpsPendingByInstitute:new Map([['synthetic',1]]),presenceByInstitute:new Map(),catalogue:SEED_STATUS_CATALOGUE}).rows;

const zero = {open:0,closed:0};
const sqlTotals = {meeting:{open:700,closed:17},session:zero,campus_visit:zero,
  olympiad:zero,application:zero,admission:zero};

describe('filtered-page export shape and totals',() => {
  beforeEach(() => { vi.resetAllMocks(); exportMocks.book.mockReturnValue(new Uint8Array([1])); });
  it('exports exactly the bounded model rows and per-column Total for the admin table',() => {
    const sheet = instituteActivitySheetRows(rows);
    expect(sheet).toHaveLength(rows.length+2);
    expect(sheet[0]).toHaveLength(13);
    expect(sheet[1][0]).toBe(rows[0].name);
    expect(sheet.at(-1)).toEqual(['Total',...sheet[1].slice(1)]);
  });
  it('asks for every matching row and writes the SQL totals, not one page',async () => {
    exportMocks.model.mockResolvedValue({ok:true,model:{rows,range:{},rangeActive:false,
      sort:{key:'institute',dir:'asc'},totalInstitutes:717,reconciliationFailed:false,page:1,pages:15,
      totals:{byActivity:sqlTotals,totalActivities:717,meetingsCompleted:0,followUpsOwned:0,
        followUpsPending:0,totalVisits:717}}});
    const result = await buildInstituteActivityExport({});
    expect(result.ok).toBe(true);
    // `allRows` is what turns the RPC's 50-row window into the full report.
    expect(exportMocks.model).toHaveBeenCalledWith(expect.objectContaining({allRows:true,page:undefined}));
    const sheet = exportMocks.book.mock.calls[0][0] as {rows:unknown[][]};
    expect(sheet.rows).toHaveLength(rows.length+2);
    // 700/17 are the SQL totals over all 717 rows, not this one-row model.
    expect(sheet.rows.at(-1)).toEqual(['Total',700,17,0,0,0,0,0,0,0,0,0,0]);
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
  it('preserves every page/filter in export URLs and resets page on sort',() => {
    const href = instituteActivityExportHref({range:{from:'2026-10-01'},sortKey:'meeting_open',sortDir:'desc',page:'2',search:'Synthetic',member:'rep-id',campus:'campus-id'});
    const params = new URL(href,'http://localhost').searchParams;
    expect(Object.fromEntries(params)).toEqual({from:'2026-10-01',sort:'meeting_open',dir:'desc',page:'2',q:'Synthetic',member:'rep-id',campus:'campus-id'});
    const sort = instituteActivitySortHref({key:'total',currentKey:'institute',currentDir:'asc',range:{},basePath:'/',extraParams:{q:'Synthetic',member:'rep-id'}});
    expect(sort).toContain('q=Synthetic');
    expect(sort).toContain('member=rep-id');
    expect(sort).not.toContain('page=');
  });
});
