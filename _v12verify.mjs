import { admin, cookieFor, SITE } from "./_v12lib.mjs";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const ids = JSON.parse(readFileSync("_v12ids.json", "utf8"));

console.log("1. THE DEPLOYED UI");
const cookie = await cookieFor(ids.email);
const html = await fetch(`${SITE}/log?plan=${ids.plan}`, { headers: { cookie } }).then((r) => r.text());
console.log(`   label still says "(optional)"      : ${html.includes("Photo (optional)")}`);
console.log(`   label marked required              : ${/Photo[\s\S]{0,120}\(required\)/.test(html)}`);
console.log(`   hint says the photo is required    : ${html.includes("Required. The location and time are stamped")}`);
console.log(`   old "save without it" copy present : ${html.includes("You can save the visit without it")}`);

console.log("\n2. THE DATABASE (needs migration 0006)");
const link = await admin.auth.admin.generateLink({ type: "magiclink", email: ids.email });
const rep = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
await rep.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });

const rpc = await rep.rpc("log_visit", { p_institute_id: ids.institute, p_activity: "olympiad" });
console.log(`   log_visit() with no photo          : ${rpc.error ? `REFUSED ${rpc.error.code} "${rpc.error.message}"` : "ACCEPTED - 0006 not applied yet"}`);
if (!rpc.error && typeof rpc.data === "string") await admin.from("visits").delete().eq("id", rpc.data);

const direct = await rep.from("visits").insert({
  institute_id: ids.institute, member: ids.id, activity: "olympiad",
  date: new Date().toISOString().slice(0, 10),
}).select("id");
console.log(`   direct INSERT with no photo        : ${direct.error ? `REFUSED ${direct.error.code} "${direct.error.message.slice(0, 60)}"` : "ACCEPTED - 0006 not applied yet"}`);
if (!direct.error && direct.data?.[0]?.id) await admin.from("visits").delete().eq("id", direct.data[0].id);

const ok = await rep.from("visits").insert({
  institute_id: ids.institute, member: ids.id, activity: "olympiad",
  date: new Date().toISOString().slice(0, 10), photo_url: `${ids.id}/proof.jpg`,
}).select("id");
console.log(`   same insert WITH a photo           : ${ok.error ? `REFUSED ${ok.error.code}` : "accepted (correct)"}`);
if (ok.data?.[0]?.id) await admin.from("visits").delete().eq("id", ok.data[0].id);
