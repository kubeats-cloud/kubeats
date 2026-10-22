import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
const {chromium}=createRequire('D:/devcache/npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json')('playwright');
process.loadEnvFile('.env.local');
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,'127.0.0.1');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const ck=({data,error})=>{if(error)throw Error(error.message);return data;};
const ids=JSON.parse(fs.readFileSync('output/evidence/accounts.json'));
const f=JSON.parse(fs.readFileSync('output/evidence/fixtures.json'));
const school=f.institutes[0];
const baseline={};
for(const table of ['visits','institutes','daily_plans','follow_up_tasks','institute_status_history'])baseline[table]=ck(await db.from(table).select('id')).map(x=>x.id);
const browser=await chromium.launch();
const context=await browser.newContext({storageState:'output/evidence/Audit-Admin-session.json',viewport:{width:1440,height:1050}});
const page=await context.newPage();
const detail='http://127.0.0.1:3000/institutes/'+school.id;
await page.goto(detail);
await page.getByRole('heading',{name:school.name,exact:true}).waitFor();
if(!ck(await db.from('institutes').select('deleted_at').eq('id',school.id).single()).deleted_at){
// Complete the Phase 0 reassignment check using the existing control, then restore ownership.
for(const name of ['Audit Bob','Audit Alice']){
 await page.getByRole('combobox',{name:'Hand it to',exact:true}).click();
 await page.getByRole('option',{name,exact:true}).click();
 await page.getByRole('button',{name:'Reassign',exact:true}).click();
 await page.locator('[role=status]').filter({hasText:/handed|belongs|reassigned|now/i}).first().waitFor();
 assert.equal(ck(await db.from('institutes').select('registered_by').eq('id',school.id).single()).registered_by,ids[name].id);
 await page.reload();
}
await page.getByRole('button',{name:'Delete',exact:true}).click();
await page.getByRole('dialog').waitFor();
await page.screenshot({path:'output/evidence/IQ1-confirmation.png',fullPage:false});
await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
assert.equal(ck(await db.from('institutes').select('deleted_at').eq('id',school.id).single()).deleted_at,null);
await page.getByRole('button',{name:'Delete',exact:true}).click();
await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
await page.waitForURL('**/institutes',{timeout:30000});
assert.equal(await page.getByRole('link',{name:school.name,exact:true}).count(),0);
await page.screenshot({path:'output/evidence/IQ1-active-list.png',fullPage:false});
}
assert(ck(await db.from('institutes').select('deleted_at').eq('id',school.id).single()).deleted_at);
await page.goto(detail);
await page.getByRole('heading',{name:school.name,exact:true}).waitFor();
assert.equal(await page.getByRole('button',{name:'Delete',exact:true}).count(),0);
await page.getByText('Visit history',{exact:true}).scrollIntoViewIfNeeded();
await page.screenshot({path:'output/evidence/IQ1-history.png',fullPage:false});
await page.getByRole('link',{name:'Open the full report',exact:true}).first().click();
await page.getByText('Synthetic report',{exact:false}).first().waitFor();
await page.getByText('Synthetic report',{exact:false}).first().scrollIntoViewIfNeeded();
await page.screenshot({path:'output/evidence/IQ1-report.png',fullPage:false});
for(const [table,prior] of Object.entries(baseline)){
 const rows=ck(await db.from(table).select('id')).map(x=>x.id);assert(prior.every(id=>rows.includes(id)),table+' lost records');
}
const rep=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
ck(await rep.auth.signInWithPassword({email:ids['Audit Alice'].email,password:'Local-audit-2026!'}));
assert.equal((await rep.rpc('soft_delete_institute',{p_institute:f.institutes[1].id})).error?.code,'42501');
assert((await rep.from('institutes').update({deleted_at:new Date().toISOString()}).eq('id',f.institutes[1].id)).error);
const purpose=f.purposes.find(p=>p.label==='Follow-up');
assert.equal((await db.from('daily_plans').insert({member:ids['Audit Alice'].id,date:f.future,institute_id:school.id,purpose:purpose.label,purpose_id:purpose.id})).error?.code,'23514');
const repPage=await browser.newPage({storageState:'output/evidence/Audit-Alice-session.json'});
await repPage.goto('http://127.0.0.1:3000/institutes');
assert.equal(await repPage.getByRole('link',{name:school.name,exact:true}).count(),0);
const down=fs.readFileSync('supabase/rollbacks/0049_soft_delete_institute_down.sql','utf8').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const test=`begin; ${down}\ndo $$ begin if to_regprocedure('public.soft_delete_institute(uuid)') is not null then raise exception 'DOWN failed'; end if; if not exists(select 1 from public.institutes where id='${school.id}' and deleted_at is not null) then raise exception 'DOWN lost history'; end if; end $$; rollback;`;
const result=spawnSync('docker',['exec','-i','supabase_db_free_lance','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:test,encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
await browser.close();
const manifest=JSON.parse(fs.readFileSync('output/evidence/manifest.json'));
for(const [file,caption] of [['IQ1-confirmation.png','Admin Delete confirmation; Cancel leaves the institute active'],['IQ1-active-list.png','Confirmed soft delete removes institute from active list'],['IQ1-history.png','Deleted institute remains accessible with saved visit history'],['IQ1-report.png','Full saved report is still readable after institute soft deletion']])manifest.push({item:'IQ1',caption,file});
fs.writeFileSync('output/evidence/manifest.json',JSON.stringify(manifest,null,2));
console.log('PASS IQ1: confirmation, active lists, history preserved, Rep blocked, new work rejected, DOWN tested; IQ3 reassignment saved both ways');
