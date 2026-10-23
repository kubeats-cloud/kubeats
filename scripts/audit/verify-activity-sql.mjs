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
  console.log(`PASS activity SQL: ${checks} checks; UP/DOWN/UP; ephemeral PostgreSQL fixture, not full Supabase integration.`);
} finally { await db.close(); }
