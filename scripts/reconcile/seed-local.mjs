import {createClient} from "@supabase/supabase-js";
import {writeFileSync,mkdirSync} from "node:fs";
process.loadEnvFile(".env.local");
if(process.env.NEXT_PUBLIC_SUPABASE_URL!=="http://127.0.0.1:56321")throw Error("Isolated local sandbox only");
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const ck=({data,error})=>{if(error)throw Error(error.message);return data;};
const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date());
const day=n=>new Date(Date.parse(today)+n*86400000).toISOString().slice(0,10);
const campus=ck(await db.from("campuses").insert({name:"Reconcile Sandbox North",city:"Synthetic City",active:true}).select("id").single()).id;
const otherCampus=ck(await db.from("campuses").insert({name:"Reconcile Sandbox South",city:"Synthetic City",active:true}).select("id").single()).id;
const accounts={};
for(const [key,name,role,campusId] of [
 ["admin","Reconcile Admin","admin",null],["lead","Reconcile Lead","team_lead",campus],
 ["alice","Reconcile Alice","rep",campus],["bob","Reconcile Bob","rep",campus],
 ["foreign","Reconcile Foreign","rep",otherCampus],
 ...Array.from({length:10},(_,i)=>[`extra${i}`,`Reconcile Rep ${String(i+1).padStart(2,"0")}`,"rep",campus]),
]){
 const email=`reconcile.${key}@example.test`;
 const user=ck(await db.auth.admin.createUser({email,password:"Local-reconcile-2026!",email_confirm:true})).user;
 ck(await db.from("profiles").insert({id:user.id,name,role,campus_id:campusId}));
 accounts[key]={id:user.id,name,email,role};
}
ck(await db.from("profiles").update({team_lead_id:accounts.lead.id}).eq("id",accounts.alice.id));
const schools={};
for(const [key,name,owner,status] of [
 ["alpha","Reconcile Alpha School","alice","First meeting done"],
 ["beta","Reconcile Closed School","alice","Session done"],
 ["calls","Reconcile Calls School","alice","First meeting done"],
 ["past","Reconcile Overdue School","alice","First meeting done"],
 ["future","Reconcile Future School","alice","First meeting done"],
 ["deletable","Reconcile History School","alice","First meeting done"],
 ["bob","Reconcile Bob School","bob","First meeting done"],
 ["foreign","Reconcile Foreign School","foreign","First meeting done"],
])schools[key]=ck(await db.from("institutes").insert({name,type:"school",boards:["CBSE"],city:"Synthetic City",state:"Gujarat",registered_by:accounts[owner].id,campus_id:owner==="foreign"?otherCampus:campus,status}).select("id,name").single());
const purposes=ck(await db.from("purposes").select("*"));
const purpose=label=>purposes.find(p=>p.label===label);
const tasks={};
for(const [key,school,kind,due] of [["today","alpha","meeting",today],["past","past","meeting",day(-2)],["future","future","meeting",day(2)],["call","calls","call",today],["bob","bob","call",today]]){
 tasks[key]=ck(await db.from("follow_up_tasks").insert({member:accounts[school==="bob"?"bob":"alice"].id,institute_id:schools[school].id,kind,due_date:due,note:`Synthetic reconciliation ${key} follow-up`}).select("id").single()).id;
}
const visits=[];
for(const [i,activity,status] of [[0,"meeting","First meeting done"],[1,"meeting","First meeting done"],[2,"meeting","RSVP received"],[3,"session","First meeting done"],[4,"session","Session done"]]){
 const p=activity==="meeting"?purpose("Follow-up"):purpose("Complete a session");
 const stamp=day(-1)+`T${String(4+i).padStart(2,"0")}:30:00Z`;
 const end=day(-1)+`T${String(5+i).padStart(2,"0")}:00:00Z`;
 const plan=ck(await db.from("daily_plans").insert({member:accounts.alice.id,institute_id:schools.alpha.id,date:day(-1),purpose:p.label,purpose_id:p.id,checkin_at:stamp,checkout_at:end,checkin_lat:23.03,checkin_lng:72.58,checkout_lat:23.031,checkout_lng:72.581,checkout_missing:false,meetings_actual:1}).select("id").single());
 const visit=ck(await db.from("visits").insert({member:accounts.alice.id,institute_id:schools.alpha.id,daily_plan_id:plan.id,activity,lifecycle_status:activity==="session"?"Done":null,date:day(-1),status_set_to:status,follow_up_date:status==="First meeting done"?day(3):null,expected_date:activity==="session"?day(-1):null,photo_url:`${accounts.alice.id}/synthetic-reconciliation-${i}.jpg`,notes:`Synthetic saved ${activity} report ${i}`,reported_at:end,students_attended:activity==="session"?40:null,session_topic:activity==="session"?"Synthetic topic":null,session_taken_by:activity==="session"?"Reconcile Faculty":null}).select("id").single());
 visits.push(visit.id);
}
mkdirSync(".local-reconcile",{recursive:true});
writeFileSync(".local-reconcile/fixtures.json",JSON.stringify({today,yesterday:day(-1),tomorrow:day(1),campus,otherCampus,accounts,schools,tasks,purposes,visits},null,2));
console.log("Synthetic reconciliation fixtures ready:",today,"15 accounts, 8 institutes, 5 saved visits, 5 follow-ups");
