import { admin } from "./_v12lib.mjs";
import { writeFileSync } from "node:fs";
const stamp = Date.now();
const email = `rule12.rep.${stamp}@kubeats-test.invalid`;
const u = await admin.auth.admin.createUser({ email, email_confirm: true });
if (u.error) throw u.error;
await admin.from("profiles").upsert({ id: u.data.user.id, name: "RULE12 Test Rep", role: "rep" });
const inst = await admin.from("institutes").insert({
  name: "RULE12 Test School", type: "school", city: "Mumbai", state: "Maharashtra",
  registered_by: u.data.user.id,
}).select("id").single();
if (inst.error) throw inst.error;
const today = new Date().toISOString().slice(0, 10);
const plan = await admin.from("daily_plans").insert({
  member: u.data.user.id, date: today, institute_id: inst.data.id, purpose: "Fix a session",
}).select("id").single();
if (plan.error) throw plan.error;
writeFileSync("_v12ids.json", JSON.stringify({ id: u.data.user.id, email, institute: inst.data.id, plan: plan.data.id }, null, 1));
console.log(JSON.stringify({ rep: u.data.user.id, institute: inst.data.id, plan: plan.data.id }));
