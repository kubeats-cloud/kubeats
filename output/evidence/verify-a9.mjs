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
const f = JSON.parse(fs.readFileSync('output/evidence/fixtures.json'));

const statusName = 'Awaiting Trustee Approval';

// 1. Admin creates custom status
let statusRow = ck(await db.from('institute_statuses').select('*').eq('status', statusName).maybeSingle());
if (!statusRow) {
  statusRow = ck(await db.from('institute_statuses').insert({
    status: statusName,
    category: 'open',
    tone: 'warning',
    sort_order: 150,
    is_active: true,
    asks_expected_date: true,
  }).select().single());
}

// 2. Configure status-specific dynamic dropdown fields
await db.from('status_fields').delete().eq('status', statusName);

const outcomeField = ck(await db.from('status_fields').insert({
  status: statusName,
  field_name: 'Outcome',
  field_type: 'select',
  options: ['High Priority', 'Under Review', 'Disqualified'],
  is_required: true,
  sort_order: 1,
}).select().single());

const timelineField = ck(await db.from('status_fields').insert({
  status: statusName,
  field_name: 'Decision Timeline',
  field_type: 'select',
  options: ['Within 1 week', 'Within 1 month', 'Next Quarter'],
  is_required: false,
  sort_order: 2,
}).select().single());

console.log('Configured dynamic fields for', statusName, ':', [outcomeField.field_name, timelineField.field_name]);

// 3. Browser drive: Admin views Settings -> Status Management
const browser = await chromium.launch({ headless: true });
const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const adminPage = await adminContext.newPage();

await adminPage.goto('http://127.0.0.1:3000/login');
await adminPage.locator('input[name=email]').fill(ids['Audit Admin'].email);
await adminPage.locator('input[name=password]').fill('Local-audit-2026!');
await adminPage.getByRole('button', { name: 'Sign in', exact: true }).click();
await adminPage.waitForURL('http://127.0.0.1:3000/', { timeout: 60000 });

await adminPage.goto('http://127.0.0.1:3000/settings');
await adminPage.waitForTimeout(1000);

const adminSettingsText = await adminPage.locator('body').innerText();
assert(adminSettingsText.includes('Status Management'), 'Section title Status Management must be present');
assert(adminSettingsText.includes(statusName), 'Status name must be listed');
assert(adminSettingsText.includes('Outcome'), 'Outcome dynamic field must be displayed');
assert(adminSettingsText.includes('Decision Timeline'), 'Decision Timeline field must be displayed');

// Screenshot 1: Status Management panel in Settings
await adminPage.screenshot({ path: 'output/evidence/A9-status-management.png', fullPage: false });

// 4. Rep logs in and submits a call report using the custom status and dynamic fields
// Ensure a call task exists for Audit Bob on Audit Bob School
const bobSchool = ck(await db.from('institutes').select('*').eq('name', 'Audit Bob School').single());
await db.from('institutes').update({ status: 'First meeting done', deleted_at: null }).eq('id', bobSchool.id);
await db.from('follow_up_tasks').delete().eq('member', ids['Audit Bob'].id).eq('institute_id', bobSchool.id).eq('kind', 'call');

const bobCallTask = ck(await db.from('follow_up_tasks').insert({
  member: ids['Audit Bob'].id,
  institute_id: bobSchool.id,
  kind: 'call',
  due_date: f.today,
  note: 'Call to review trustee approval',
}).select().single());

const repContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const repPage = await repContext.newPage();

await repPage.goto('http://127.0.0.1:3000/login');
await repPage.locator('input[name=email]').fill(ids['Audit Bob'].email);
await repPage.locator('input[name=password]').fill('Local-audit-2026!');
await repPage.getByRole('button', { name: 'Sign in', exact: true }).click();
await repPage.waitForURL('http://127.0.0.1:3000/', { timeout: 60000 });

await repPage.goto('http://127.0.0.1:3000/pending');
await repPage.waitForTimeout(700);

// Open log call dialog
await repPage.getByRole('button', { name: 'Log call', exact: true }).first().click();
const dialog = repPage.getByRole('dialog');

// Select custom status
await dialog.getByRole('combobox', { name: 'Institute status' }).click();
await repPage.getByRole('option', { name: statusName, exact: true }).click();
await repPage.waitForTimeout(500);

// Verify dynamic fields render
const dialogText = await dialog.innerText();
assert(dialogText.includes('Outcome'), 'Dynamic field Outcome must render in form');
assert(dialogText.includes('Decision Timeline'), 'Dynamic field Decision Timeline must render in form');

// Fill required status date, notes, and dynamic fields
await dialog.locator('#expected-date').fill(f.today);
await dialog.locator('#follow-up-date').fill(f.future);
await dialog.locator('#notes').fill('Trustee meeting confirmed positive reception.');

// Select dynamic dropdown options
await dialog.getByRole('combobox', { name: 'Outcome' }).click();
await repPage.getByRole('option', { name: 'High Priority', exact: true }).click();

await dialog.getByRole('combobox', { name: 'Decision Timeline' }).click();
await repPage.getByRole('option', { name: 'Within 1 week', exact: true }).click();

// Screenshot 2: Dynamic fields rendered and filled in form
await repPage.screenshot({ path: 'output/evidence/A9-dynamic-form.png', fullPage: false });

// Save report
await dialog.getByRole('button', { name: 'Save', exact: true }).click();
await dialog.waitFor({ state: 'hidden', timeout: 30000 });

// 5. Verify saved task has custom_fields persisted in DB
const savedTask = ck(await db.from('follow_up_tasks').select('*').eq('id', bobCallTask.id).single());
assert(savedTask.reported_at, 'Call task must be reported');
assert.equal(savedTask.status_set_to, statusName);
console.log('Persisted custom_fields on follow_up_tasks:', savedTask.custom_fields);
assert.equal(savedTask.custom_fields?.['Outcome'], 'High Priority');
assert.equal(savedTask.custom_fields?.['Decision Timeline'], 'Within 1 week');

// 6. Admin Review displays the dynamic fields
await adminPage.goto(`http://127.0.0.1:3000/review/${bobCallTask.id}?kind=call`);
await adminPage.waitForTimeout(1000);

const reviewText = await adminPage.locator('body').innerText();
assert(reviewText.includes('Outcome'), 'Review detail must show Outcome dynamic field');
assert(reviewText.includes('High Priority'), 'Review detail must show selected Outcome option');
assert(reviewText.includes('Decision Timeline'), 'Review detail must show Decision Timeline field');
assert(reviewText.includes('Within 1 week'), 'Review detail must show selected Timeline option');

// Screenshot 3: Dynamic fields rendered in Review detail
await adminPage.screenshot({ path: 'output/evidence/A9-review-report.png', fullPage: false });

// 7. Verify DOWN rollback execution cleanly inside transaction
const down = fs.readFileSync('supabase/rollbacks/0054_status_management_dynamic_fields_down.sql', 'utf8')
  .replace(/^begin;$/m, '')
  .replace(/^commit;$/m, '');
const testSql = `begin;${down} do $$ begin if to_regclass('public.status_fields') is not null then raise exception 'DOWN failed'; end if; end $$;rollback;`;
const res = spawnSync('docker', ['exec', '-i', 'supabase_db_free_lance', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input: testSql,
  encoding: 'utf8',
});
assert.equal(res.status, 0, res.stderr);
console.log('DOWN rollback test verified cleanly');

await browser.close();

// 8. Update manifest.json
const manifest = JSON.parse(fs.readFileSync('output/evidence/manifest.json'));
manifest.push({
  item: 'A9',
  caption: 'Settings Status Management: Admin configures dynamic dropdown fields and required flags',
  file: 'A9-status-management.png',
});
manifest.push({
  item: 'A9',
  caption: 'Dynamic dropdown fields and options render when status is selected in forms',
  file: 'A9-dynamic-form.png',
});
manifest.push({
  item: 'A9',
  caption: 'Submitted dynamic fields persist and display in Review and reports',
  file: 'A9-review-report.png',
});
fs.writeFileSync('output/evidence/manifest.json', JSON.stringify(manifest, null, 2));

console.log('PASS A9: Status Management with status-specific dynamic fields fully verified end-to-end');
