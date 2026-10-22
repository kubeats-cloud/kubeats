import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
process.loadEnvFile('.env.local');
if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:56321')throw Error('Isolated local database only');
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_free_lance_reconcile','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8'});
const files=fs.readdirSync('supabase/rollbacks').filter(x=>/^00(4[7-9]|5[0-4])_.*_down.sql$/.test(x)).sort().reverse();
const body=f=>fs.readFileSync('supabase/rollbacks/'+f,'utf8').replace(/^\s*(begin|commit);\s*$/gim,'');
// Hash complete rows, including configuration/payload columns, across every public table.
const capture=`create temporary table reconciliation_rows(name text primary key, digest text); do $$ declare t record; d text; begin for t in select tablename from pg_tables where schemaname='public' loop execute format('select md5(coalesce(string_agg(to_jsonb(r)::text, chr(10) order by to_jsonb(r)::text),'''')) from public.%I r',t.tablename) into d; insert into reconciliation_rows values(t.tablename,d); end loop; end $$;`;
// Status retirement is an intentional behavioral change in 0048, so exclude ONLY
// institute_statuses from strict byte comparison; assert no labels disappeared.
const verify=`do $$ declare t record; d text; begin for t in select * from reconciliation_rows where name <> 'institute_statuses' loop execute format('select md5(coalesce(string_agg(to_jsonb(r)::text, chr(10) order by to_jsonb(r)::text),'''')) from public.%I r',t.name) into d; if d <> t.digest then raise exception 'Row/payload loss or mutation: %',t.name; end if; end loop; if not exists(select 1 from public.institute_statuses where status='Not Interested') then raise exception 'Historical status label lost'; end if; end $$;`;
const results=[];
for(const file of files){sql('begin;\n'+capture+'\n'+body(file)+'\n'+verify+'\nrollback;');results.push({migration:file,status:'passed',check:'All public table rows/payloads unchanged; historical status retained; transaction rolled back'});console.log('PASS',file);}
sql('begin;\n'+capture+'\n'+files.map(body).join('\n')+'\n'+verify+'\nrollback;');
results.push({migration:'full reverse chain 0054 → 0047',status:'passed'});
fs.writeFileSync('.local-reconcile/downs.json',JSON.stringify(results,null,2));
console.log('PASS full reverse chain; latest schema restored by transaction rollback');

