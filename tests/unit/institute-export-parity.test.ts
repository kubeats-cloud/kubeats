import { describe,expect,it } from 'vitest';
import { buildInstituteActivityRows } from '@/lib/institute-activity-counts';
import { SEED_STATUS_CATALOGUE } from '@/lib/validation/institute';
import { instituteActivitySheetRows,presenceSheetRows,repInstituteSheetRows } from '@/lib/exports/institute-activity-export';
import { instituteActivityExportHref,instituteActivitySortHref } from '@/lib/institute-activity-links';

const rows = buildInstituteActivityRows({institutes:[{id:'synthetic',name:'Synthetic Institute'}],
  visits:[{institute_id:'synthetic',activity:'meeting',lifecycle_status:null,status_set_to:'First meeting done'}],
  meetingsCompletedByInstitute:new Map([['synthetic',2]]),followUpsOwnedByInstitute:new Map([['synthetic',3]]),
  followUpsPendingByInstitute:new Map([['synthetic',1]]),presenceByInstitute:new Map(),catalogue:SEED_STATUS_CATALOGUE}).rows;

describe('filtered-page export shape and totals',() => {
  it('exports exactly the bounded model rows and per-column Total for the admin table',() => {
    const sheet = instituteActivitySheetRows(rows);
    expect(sheet).toHaveLength(rows.length+2);
    expect(sheet[0]).toHaveLength(13);
    expect(sheet[1][0]).toBe(rows[0].name);
    expect(sheet.at(-1)).toEqual(['Total',...sheet[1].slice(1)]);
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
