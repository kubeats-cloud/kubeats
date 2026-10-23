import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({gate:vi.fn(),user:vi.fn(),build:vi.fn()}));
vi.mock('@/lib/admin',() => ({requireStaff:mocks.gate}));
vi.mock('@/lib/auth',() => ({getCurrentUser:mocks.user}));
vi.mock('@/lib/exports/institute-activity-export',() => ({buildInstituteActivityExport:mocks.build}));
import { GET } from '@/app/api/export/institute-activity/route';

const own = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const request = (query='') => new NextRequest(`http://localhost/api/export/institute-activity?${query}`);
describe('institute export authorization and filter forwarding',() => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.gate.mockResolvedValue({ok:false,error:'Forbidden'});
    mocks.user.mockResolvedValue(null);
    mocks.build.mockResolvedValue({ok:true,bytes:new Uint8Array([80,75]),filename:'synthetic.xlsx'});
  });
  it('denies anonymous downloads before any workbook work',async () => {
    expect((await GET(request('view=rep'))).status).toBe(403);
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it('preserves staff-only access to the original admin matrix export',async () => {
    mocks.user.mockResolvedValue({id:own,role:'rep'});
    expect((await GET(request())).status).toBe(403);
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it.each(['rep','presence'])('pins the %s export to the logged-in rep, ignoring spoofed member',async view => {
    mocks.user.mockResolvedValue({id:own,role:'rep'});
    expect((await GET(request(`view=${view}&member=${other}&page=2&q=Synthetic&from=2026-10-01&to=2026-10-23`))).status).toBe(200);
    expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({view,member:own,page:'2',search:'Synthetic',
      range:{from:'2026-10-01',to:'2026-10-23'}}));
  });
  it('forwards the admin screen page, rep, campus, search and sort unchanged',async () => {
    mocks.gate.mockResolvedValue({ok:true,user:{id:own,role:'admin'}});
    await GET(request(`member=${other}&campus=${own}&page=3&q=Synthetic&sort=meeting_open&dir=desc`));
    expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({member:other,campus:own,page:'3',search:'Synthetic',sort:{key:'meeting_open',dir:'desc'}}));
  });
  it('rejects invalid dates before workbook work',async () => {
    mocks.gate.mockResolvedValue({ok:true,user:{id:own,role:'admin'}});
    expect((await GET(request('from=not-a-date'))).status).toBe(400);
    expect(mocks.build).not.toHaveBeenCalled();
  });
});
