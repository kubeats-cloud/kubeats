// In-memory PostgreSQL fixture only: no network, env files, artifacts or production data.
// Usage: node scripts/audit/verify-activity-sql.mjs <temporary npm prefix containing PGlite>
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleRoot = process.argv[2];
if (!moduleRoot) throw Error('Provide the temporary PGlite npm prefix. No database URL is accepted.');
const { PGlite } = await import(pathToFileURL(resolve(moduleRoot,'node_modules/@electric-sql/pglite/dist/index.js')).href);
const db = new PGlite(); // No data directory: isolated and ephemeral.
let checks = 0;
const check = (value, expected) => { assert.deepEqual(value,expected); checks++; };
const repA = '10000000-0000-0000-0000-000000000001';
const repB = '10000000-0000-0000-0000-000000000002';
const institute = (n) => `20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const up = await readFile(new URL('../../supabase/migrations/0055_audit_institute_activity.sql',import.meta.url),'utf8');
const down = await readFile(new URL('../../supabase/rollbacks/0055_audit_institute_activity_down.sql',import.meta.url),'utf8');
const registryUp = await readFile(new URL('../../supabase/migrations/0056_audit_registry.sql',import.meta.url),'utf8');
const registryDown = await readFile(new URL('../../supabase/rollbacks/0056_audit_registry_down.sql',import.meta.url),'utf8');
const pendingUp = await readFile(new URL('../../supabase/migrations/0057_audit_open_follow_ups.sql',import.meta.url),'utf8');
const pendingDown = await readFile(new URL('../../supabase/rollbacks/0057_audit_open_follow_ups_down.sql',import.meta.url),'utf8');
const historyUp = await readFile(new URL('../../supabase/migrations/0058_audit_reassignment_history.sql',import.meta.url),'utf8');
const historyDown = await readFile(new URL('../../supabase/rollbacks/0058_audit_reassignment_history_down.sql',import.meta.url),'utf8');
const targetUp = await readFile(new URL('../../supabase/migrations/0059_target_status_case_unique.sql',import.meta.url),'utf8');
const targetDown = await readFile(new URL('../../supabase/rollbacks/0059_target_status_case_unique_down.sql',import.meta.url),'utf8');
try {
  // Minimal actual-column fixture, not a claim that the full Supabase schema/RLS was replayed.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('audit.member',true),'')::uuid $$;
    create function public.app_today() returns date language sql stable as $$ select date '2026-10-23' $$;
    create table institutes(id uuid primary key,name text,type text,city text,area text,state text,status text,
      deleted_at timestamptz,registered_by uuid,campus_id uuid);
    create table institute_statuses(status text primary key,category text);
    create table visits(id uuid default gen_random_uuid(),institute_id uuid,member uuid,date date,
      activity text,lifecycle_status text,status_set_to text);
    create table daily_plans(id uuid default gen_random_uuid(),institute_id uuid,member uuid,date date,
      meetings_actual integer,checkin_at timestamptz,checkout_at timestamptz,
      checkin_lat double precision,checkin_lng double precision,checkout_lat double precision,checkout_lng double precision);
    create table follow_up_tasks(institute_id uuid,member uuid,due_date date,done_at timestamptz);
    grant usage on schema auth to authenticated;
    grant select on all tables in schema public to authenticated;
    alter table institutes enable row level security;
    alter table visits enable row level security;
    alter table daily_plans enable row level security;
    alter table follow_up_tasks enable row level security;
    create policy fixture_owner on institutes using (registered_by = auth.uid());
    create policy fixture_member on visits using (member = auth.uid());
    create policy fixture_member on daily_plans using (member = auth.uid());
    create policy fixture_member on follow_up_tasks using (member = auth.uid());
    insert into institute_statuses values ('Synthetic Open','open'),('Synthetic Closed','closed');
    insert into institutes(id,name,type,city,registered_by)
    select ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
      'Synthetic '||lpad(n::text,3,'0'),'school','Synthetic City',
      case when n <= 110 then '${repA}'::uuid else '${repB}'::uuid end
    from generate_series(1,120) n;
    insert into visits(institute_id,member,date,activity,status_set_to) values
      ('${institute(1)}','${repA}','2026-10-20','meeting','Synthetic Open'),
      ('${institute(1)}','${repA}','2026-10-20','meeting','Synthetic Open'),
      ('${institute(1)}','${repA}','2026-10-20','meeting','Synthetic Closed');
    insert into visits(institute_id,member,date,activity,lifecycle_status,status_set_to) values
      ('${institute(1)}','${repA}','2026-10-20','session','Set','Synthetic Open'),
      ('${institute(1)}','${repA}','2026-10-20','session','Done','Synthetic Closed');
    insert into visits(institute_id,member,date,activity,status_set_to)
    select '${institute(2)}','${repA}','2026-10-20','meeting','Synthetic Open' from generate_series(1,12);
    insert into daily_plans(institute_id,member,date,meetings_actual,checkin_at,checkout_at) values
      ('${institute(1)}','${repA}','2026-10-20',1,'2026-10-20 10:00+05:30','2026-10-20 11:00+05:30'),
      ('${institute(1)}','${repA}','2026-10-21',null,'2026-10-21 10:00+05:30',null);
    insert into follow_up_tasks values
      ('${institute(1)}','${repA}','2026-10-20',null),
      ('${institute(1)}','${repA}','2026-10-25',null),
      ('${institute(1)}','${repA}','2026-10-19','2026-10-20');
  `);
  await db.exec(up);
  await db.exec(`alter table institutes add column boards text[];
    create table profiles(id uuid primary key,name text);
    grant select on profiles to authenticated;
    alter table profiles enable row level security;
    create policy fixture_profiles on profiles using (id = auth.uid());
    insert into profiles values ('${repA}','Synthetic A'),('${repB}','Synthetic B');
    update institutes set boards = array['NIOS',' Nios ','nios','NA',' na ','Not applicable'];`);
  await db.exec(registryUp);
  check((await db.query('select normalized_boards from audit_registry limit 1')).rows[0].normalized_boards.sort(),['NIOS','Not applicable']);
  check((await db.query('select audit_registry_facets() facets')).rows[0].facets.boards,['NIOS','Not applicable']);
  await db.exec(`alter table visits add column created_at timestamptz default '2026-10-20 10:00Z';
    alter table visits add column follow_up_date date;
    alter table visits add column expected_date date;
    alter table visits add column notes text;
    alter table follow_up_tasks add column id uuid default gen_random_uuid();
    alter table follow_up_tasks add column status_set_to text;
    alter table follow_up_tasks add column follow_up_date date;
    alter table follow_up_tasks add column expected_date date;
    alter table follow_up_tasks add column call_notes text;
    alter table follow_up_tasks add column reported_at timestamptz;
    alter table follow_up_tasks add column kind text default 'meeting';
    update institutes set status = 'Synthetic Open' where id = '${institute(1)}';
    update follow_up_tasks set kind = 'call',status_set_to = 'Synthetic Open',follow_up_date = '2026-10-27',
      reported_at = '2026-10-21 20:00Z' where due_date = '2026-10-25';`);
  await db.exec(pendingUp);
  const attributed = (await db.query('select attribution_source,follow_up_date::text,set_on::text from audit_open_follow_ups where institute_id = $1',[institute(1)])).rows[0];
  check(attributed,{attribution_source:'call',follow_up_date:'2026-10-27',set_on:'2026-10-22'});
  const model = async (over={}) => {
    const args = {from:null,to:null,search:'',member:null,campus:null,sort:'institute',desc:false,page:1,...over};
    const result = await db.query('select audit_institute_activity($1,$2,$3,$4,$5,$6,$7,$8) model',Object.values(args));
    return result.rows[0].model;
  };
  const first = await model();
  check([first.total,first.pages,first.page,first.rows.length],[120,3,1,50]);
  const row = first.rows[0];
  check(row.byActivity.meeting,{open:2,closed:1});
  check(row.byActivity.session,{open:1,closed:1});
  check([row.totalActivities,row.totalVisits,row.meetingsCompleted,row.followUpsOwned,row.followUpsPending],[5,2,1,2,1]);
  check(row.lastCheckoutAt,null); // No fabricated check-out on latest arrival.
  const ids = [...first.rows,...(await model({page:2})).rows,...(await model({page:3})).rows].map(r=>r.id);
  check([ids.length,new Set(ids).size],[120,120]);
  check((await model({page:999})).page,3);
  check((await model({page:0})).page,1);
  check((await model({search:'Synthetic 119'})).rows.map(r=>r.id),[institute(119)]);
  check((await model({search:'nothing-matches'})).total,0);
  check((await model({sort:'total',desc:true})).rows.slice(0,2).map(r=>r.totalActivities),[12,5]);
  check((await model({from:'2026-10-21',to:'2026-10-21'})).rows[0].totalActivities,0);
  await db.exec(`set role authenticated; set audit.member = '${repA}';`);
  check((await model()).total,110);
  check((await db.query('select count(*)::integer n from audit_registry')).rows[0].n,110);
  check((await db.query('select audit_registry_facets() facets')).rows[0].facets.owners.reps.map(r=>r.id),[repA]);
  check((await model({member:repB})).total,0); // Filter cannot widen invoker RLS.
  await db.exec(`set audit.member = '${repB}';`);
  check((await model()).total,10);
  await db.exec('reset role');
  await db.exec(pendingDown);
  check((await db.query("select to_regclass('audit_open_follow_ups') v")).rows[0].v,null);
  await db.exec(pendingUp);
  await db.exec(registryDown);
  check((await db.query("select to_regclass('audit_registry') v")).rows[0].v,null);
  await db.exec(registryUp);
  check((await db.query('select count(*)::integer n from audit_registry')).rows[0].n,120);
  await db.exec(`insert into visits(institute_id,member,date,activity,lifecycle_status,status_set_to)
    values ('${institute(1)}','${repA}','2026-10-20','session',null,'Synthetic Open')`);
  const drift = await model({search:'Synthetic 001'});
  check(drift.reconciliationFailed,true);
  check(drift.rows[0].byActivity.meeting,{open:0,closed:0});
  check(drift.rows[0].totalActivities,6);
  await db.exec(down);
  check((await db.query("select to_regprocedure('audit_institute_activity(date,date,text,uuid,uuid,text,boolean,integer)') f")).rows[0].f,null);
  await db.exec(up);
  check((await model()).total,120);
  await db.exec(`create function public.is_admin() returns boolean language sql stable as $$
    select coalesce(current_setting('audit.admin',true),'false') = 'true' $$;
    set audit.member = '${repA}';`);
  await db.exec(historyUp);
  await db.query('update institutes set registered_by = $1 where id = $2',[repB,institute(1)]);
  await db.query('update institutes set registered_by = $1 where id = $2',[repB,institute(1)]);
  await db.query('update institutes set registered_by = $1 where id = $2',[repA,institute(1)]);
  check((await db.query('select count(*)::integer n from institute_reassignment_history')).rows[0].n,2);
  check((await db.query('select from_rep,to_rep,changed_by from institute_reassignment_history order by changed_at,id')).rows
    .every(row => row.changed_by === repA && row.from_rep !== row.to_rep),true);
  for (const statement of ['update institute_reassignment_history set changed_by = null',
    'delete from institute_reassignment_history','truncate institute_reassignment_history']) {
    await assert.rejects(db.exec(statement),error => error.code === '42501'); checks++;
  }
  await db.exec(`set role authenticated; set audit.admin = 'false';`);
  check((await db.query('select count(*)::integer n from institute_reassignment_history')).rows[0].n,0);
  await assert.rejects(db.exec(`insert into institute_reassignment_history(institute_id,from_rep,to_rep)
    values ('${institute(1)}','${repA}','${repB}')`),error => error.code === '42501'); checks++;
  await db.exec("set audit.admin = 'true'");
  check((await db.query('select count(*)::integer n from institute_reassignment_history')).rows[0].n,2);
  await db.exec('reset role');
  await db.exec(historyDown);
  check((await db.query('select count(*)::integer n from institute_reassignment_history_0058_archive')).rows[0].n,2);
  await db.exec(historyUp);
  check((await db.query('select count(*)::integer n from institute_reassignment_history')).rows[0].n,2);
  await db.exec("create table target_statuses(name text primary key check(length(trim(name)) > 0)); insert into target_statuses values ('Synthetic Status');");
  await db.exec(targetUp);
  for (const value of ['synthetic status','  SYNTHETIC STATUS  ']) {
    await assert.rejects(db.query('insert into target_statuses values ($1)',[value]),error => error.code === '23505'); checks++;
  }
  await assert.rejects(db.query('insert into target_statuses values ($1)',[' ']),error => error.code === '23514'); checks++;
  await db.exec(targetDown);
  check((await db.query("select to_regclass('target_statuses_name_normalized_unique') i")).rows[0].i,null);
  await db.exec(targetUp);
  check((await db.query('select count(*)::integer n from target_statuses')).rows[0].n,1);
  const hygiene = await db.exec(await readFile(new URL('../prod_data_hygiene_report.sql',import.meta.url),'utf8'));
  check(hygiene.every(result => result.rows.every(row => Object.keys(row).every(key => ['kind','campus_id','n','ids'].includes(key)))),true);
  const proposal = await readFile(new URL('../prod_data_hygiene_proposal_DO_NOT_RUN.sql',import.meta.url),'utf8');
  check(proposal.split('\n').every(line => !line.trim() || line.trim().startsWith('--')),true);
  console.log(`PASS activity SQL: ${checks} checks; UP/DOWN/UP; ephemeral PostgreSQL fixture, not full Supabase integration.`);
} finally { await db.close(); }
