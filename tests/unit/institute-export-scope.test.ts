import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({gate:vi.fn(),user:vi.fn(),build:vi.fn(),statusBuild:vi.fn()}));
vi.mock('@/lib/admin',() => ({requireStaff:mocks.gate}));
vi.mock('@/lib/auth',() => ({getCurrentUser:mocks.user}));
vi.mock('@/lib/exports/institute-activity-export',() => ({
  buildInstituteActivityExport:mocks.build,
  buildInstituteStatusActivityExport:mocks.statusBuild,
}));
import { GET } from '@/app/api/export/institute-activity/route';

const own = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const range = 'from=2026-10-01&to=2026-10-23';
const request = (query='') => new NextRequest(`http://localhost/api/export/institute-activity?${query}`);
const okFile = {ok:true,bytes:new Uint8Array([80,75]),filename:'synthetic.xlsx'};

describe('institute export authorization and filter forwarding',() => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.gate.mockResolvedValue({ok:false,error:'Forbidden'});
    mocks.user.mockResolvedValue(null);
    mocks.build.mockResolvedValue(okFile);
    mocks.statusBuild.mockResolvedValue(okFile);
  });

  it('denies anonymous downloads before any workbook work',async () => {
    expect((await GET(request(`view=rep&${range}`))).status).toBe(403);
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.statusBuild).not.toHaveBeenCalled();
  });

  it('denies a rep calling the admin Institute Activity export',async () => {
    mocks.user.mockResolvedValue({id:own,role:'rep'});
    expect((await GET(request(range))).status).toBe(403);
    expect(mocks.statusBuild).not.toHaveBeenCalled();
  });

  it('denies staff calling a rep-only view',async () => {
    mocks.gate.mockResolvedValue({ok:true,user:{id:own,role:'admin'}});
    expect((await GET(request(`view=presence&${range}`))).status).toBe(403);
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it.each(['rep','presence'])('pins the %s export to the logged-in rep and never forwards a member',async view => {
    mocks.user.mockResolvedValue({id:own,role:'rep'});
    expect((await GET(request(`view=${view}&member=${other}&page=2&q=Synthetic&${range}`))).status).toBe(200);
    const forwarded = mocks.build.mock.calls[0][0] as Record<string,unknown>;
    expect(forwarded).toMatchObject({view,range:{from:'2026-10-01',to:'2026-10-23'}});
    // The SQL function has no rep-id parameter at all; the route must not send one.
    expect(forwarded).not.toHaveProperty('member');
    expect(forwarded).not.toHaveProperty('page');
  });

  it('requires a complete date range for every export',async () => {
    mocks.gate.mockResolvedValue({ok:true,user:{id:own,role:'admin'}});
    expect((await GET(request('from=2026-10-01'))).status).toBe(400);
    expect(mocks.statusBuild).not.toHaveBeenCalled();
    mocks.gate.mockResolvedValue({ok:false,error:'Forbidden'});
    mocks.user.mockResolvedValue({id:own,role:'rep'});
    expect((await GET(request('view=rep&from=2026-10-01'))).status).toBe(400);
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it('caps every export at 31 days before any query',async () => {
    mocks.gate.mockResolvedValue({ok:true,user:{id:own,role:'admin'}});
    expect((await GET(request('from=2026-10-01&to=2026-11-01'))).status).toBe(400);
    expect(mocks.statusBuild).not.toHaveBeenCalled();
    expect((await GET(request('from=2026-10-01&to=2026-10-31'))).status).toBe(200);
  });

  it('forwards the admin filters and never a screen page',async () => {
    mocks.gate.mockResolvedValue({ok:true,user:{id:own,role:'admin'}});
    await GET(request(`member=${other}&campus=${own}&page=3&q=Synthetic&sort=status:RSVP%20received&dir=desc&${range}`));
    const forwarded = mocks.statusBuild.mock.calls[0][0] as Record<string,unknown>;
    expect(forwarded).toMatchObject({
      member:other,campus:own,search:'Synthetic',
      sort:{key:'status:RSVP received',dir:'desc'},
    });
    expect(forwarded).not.toHaveProperty('page');
  });

  it('rejects invalid dates before workbook work',async () => {
    mocks.gate.mockResolvedValue({ok:true,user:{id:own,role:'admin'}});
    expect((await GET(request('from=not-a-date&to=2026-10-01'))).status).toBe(400);
    expect(mocks.statusBuild).not.toHaveBeenCalled();
  });

  it('rejects an unknown view instead of treating it as the admin export',async () => {
    mocks.gate.mockResolvedValue({ok:true,user:{id:own,role:'admin'}});
    expect((await GET(request(`view=everything&${range}`))).status).toBe(400);
    expect(mocks.statusBuild).not.toHaveBeenCalled();
  });
});
