import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks = vi.hoisted(() => ({gate:vi.fn(),insert:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/admin',() => ({requireAdmin:mocks.gate}));
vi.mock('next/cache',() => ({revalidatePath:mocks.revalidate}));
vi.mock('@/lib/errors',() => ({logError:vi.fn(),toFriendlyMessage:() => 'Request failed'}));
import { addTargetStatus } from '@/lib/target-status-actions';

const add = (name:string) => {const form=new FormData();form.set('name',name);return addTargetStatus({error:null,fieldErrors:{}},form);};
describe('target-status validation feedback',() => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.gate.mockResolvedValue({ok:true,supabase:{from:() => ({insert:mocks.insert})}});
    mocks.insert.mockResolvedValue({error:null});
  });
  it('rejects whitespace before an insert',async () => {
    expect((await add('   ')).error).toBe('A status name is required.');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('maps the database case-insensitive uniqueness violation to a clear message',async () => {
    mocks.insert.mockResolvedValue({error:{code:'23505'}});
    expect((await add('synthetic status')).error).toBe('A target status with that name already exists.');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('trims a valid saved name and refreshes Targets',async () => {
    expect((await add('  Synthetic Status  ')).ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledWith({name:'Synthetic Status'});
    expect(mocks.revalidate).toHaveBeenCalledWith('/targets');
  });
  it('does not insert for a non-admin',async () => {
    mocks.gate.mockResolvedValue({ok:false,error:'Forbidden'});
    expect((await add('Synthetic Status')).error).toBe('Forbidden');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
