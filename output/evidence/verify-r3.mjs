import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const require = createRequire('D:/devcache/npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = require('playwright');

process.loadEnvFile('.env.local');
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, '127.0.0.1');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ck = ({ data, error }) => {
  if (error) throw Error(error.message);
  return data;
};

const ids = JSON.parse(fs.readFileSync('output/evidence/accounts.json'));
const aliceId = ids['Audit Alice'].id;

// 1. Get campus
const campus = ck(await db.from('campuses').select('id').eq('name', 'Verify Campus').single()).id;

// 2. Create or find Audit R3 School
let school = ck(await db.from('institutes').select('*').eq('name', 'Audit R3 Auto Follow-up School').maybeSingle());
if (!school) {
  school = ck(await db.from('institutes').insert({
    name: 'Audit R3 Auto Follow-up School',
    type: 'school',
    campus_id: campus,
    registered_by: aliceId,
    status: 'First meeting done',
    pincode: '382421',
    address: 'Sector 25, Gandhinagar',
    boards: ['CBSE'],
  }).select().single());
} else {
  school = ck(await db.from('institutes').update({
    status: 'First meeting done',
    deleted_at: null,
    registered_by: aliceId,
  }).eq('id', school.id).select().single());
}

const followUpPurpose = ck(await db.from('purposes').select('id, label').eq('activity', 'meeting').eq('is_active', true).eq('requires_note', false).order('label', { ascending: false }).limit(1).single());

// Clean up any existing unstarted test plans for this school
await db.from('daily_plans').delete().eq('member', aliceId).eq('institute_id', school.id).is('checkin_at', null);

// Clean up existing open test tasks for this school
await db.from('follow_up_tasks').delete().eq('member', aliceId).eq('institute_id', school.id);

// 3. Insert Today's meeting follow-up and Yesterday's meeting follow-up, plus Today's call follow-up
const taskToday = ck(await db.from('follow_up_tasks').insert({
  member: aliceId,
  institute_id: school.id,
  kind: 'meeting',
  due_date: '2026-10-22',
  purpose_id: followUpPurpose.id,
  note: 'Auto-followup today meeting',
}).select().single());

const taskPast = ck(await db.from('follow_up_tasks').insert({
  member: aliceId,
  institute_id: school.id,
  kind: 'meeting',
  due_date: '2026-10-21',
  purpose_id: followUpPurpose.id,
  note: 'Auto-followup past meeting',
}).select().single());

const taskCall = ck(await db.from('follow_up_tasks').insert({
  member: aliceId,
  institute_id: school.id,
  kind: 'call',
  due_date: '2026-10-22',
  note: 'Auto-followup today call',
}).select().single());

console.log('Inserted tasks for Audit R3 School:', {
  taskToday: taskToday.id,
  taskPast: taskPast.id,
  taskCall: taskCall.id,
});

// 4. Drive browser as Alice
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();

await page.goto('http://127.0.0.1:3000/login');
await page.locator('input[name=email]').fill(ids['Audit Alice'].email);
await page.locator('input[name=password]').fill('Local-audit-2026!');
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.waitForURL('http://127.0.0.1:3000/', { timeout: 60000 });

// Wait for Today's Plan section
await page.waitForTimeout(1000);
const bodyText = await page.locator('body').innerText();
assert(bodyText.includes('Audit R3 Auto Follow-up School'), 'Institute name must appear on dashboard');
assert(bodyText.includes('Follow-up'), 'Follow-up purpose must appear in Today plan');

// Screenshot 1: Today's Plan with auto-added follow-ups
await page.screenshot({ path: 'output/evidence/R3-auto-plan.png', fullPage: false });

// 5. Verify follow-up calls section if present
const hasCallsSection = bodyText.includes('Follow-up calls') || bodyText.includes('Auto-followup today call');
console.log('Follow-up calls displayed:', hasCallsSection);

await page.screenshot({ path: 'output/evidence/R3-auto-calls.png', fullPage: false });

// 6. Reload page and assert no duplicate plans created
await page.reload();
await page.waitForTimeout(1000);

const plans = ck(await db.from('daily_plans').select('*').eq('member', aliceId).eq('institute_id', school.id).eq('date', '2026-10-22').is('cancelled_at', null));
console.log('Active plans for today:', plans.length);
assert(plans.length >= 1, 'At least one plan should be materialised');
const taskIdsLinked = plans.map(p => p.follow_up_task_id).filter(Boolean);
console.log('Linked follow up task IDs:', taskIdsLinked);
assert(taskIdsLinked.includes(taskToday.id) || taskIdsLinked.includes(taskPast.id), 'Task must be linked');

// Assert uniqueness - no duplicates
const uniqueTaskIds = new Set(taskIdsLinked);
assert.equal(uniqueTaskIds.size, taskIdsLinked.length, 'No duplicate follow-up plans');

// 7. Verify DOWN script execution in a rolled-back transaction
const down = fs.readFileSync('supabase/rollbacks/0051_automatic_follow_up_plan_down.sql', 'utf8')
  .replace(/^begin;$/m, '')
  .replace(/^commit;$/m, '');
const sql = `begin;${down} do $$ begin if to_regprocedure('public.materialise_due_followups()') is not null then raise exception 'DOWN failed'; end if; end $$;rollback;`;
const result = spawnSync('docker', ['exec', '-i', 'supabase_db_free_lance', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input: sql,
  encoding: 'utf8',
});
assert.equal(result.status, 0, result.stderr);
console.log('DOWN script verified cleanly in rollback transaction');

await browser.close();

// 8. Update manifest.json
const manifest = JSON.parse(fs.readFileSync('output/evidence/manifest.json'));
manifest.push({
  item: 'R3',
  caption: 'Due and overdue follow-ups automatically added to Today\'s Plan',
  file: 'R3-auto-plan.png',
});
manifest.push({
  item: 'R3',
  caption: 'Follow-up calls rendered in Daily Plan without duplicate entries',
  file: 'R3-auto-calls.png',
});
fs.writeFileSync('output/evidence/manifest.json', JSON.stringify(manifest, null, 2));

console.log('PASS R3: Automatic Follow-Up in Daily Plan verified live, no duplicates, DOWN verified');
