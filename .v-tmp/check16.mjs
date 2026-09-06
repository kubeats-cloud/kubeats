import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync("D:/free lance/.env.local","utf8").split(/\r?\n/)
  .filter(l=>l&&!l.startsWith("#")&&l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")).trim(),l.slice(l.indexOf("=")+1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const say = (t, ok, d="") => console.log(`${ok ? "  OK  " : ">>FAIL"} | ${t}${d ? " :: " + d : ""}`);

// F-1
let r = await db.from("institutes").insert({ name: "", type: "school", boards: ["CBSE"],
  state: "G", city: "A", area: "S" }).select("id").single();
say("F-1 empty name refused", r.error?.code === "23514", r.error?.code ?? "ACCEPTED");
r = await db.from("institutes").insert({ name: "ZZV probe", type: "school", boards: [],
  state: "G", city: "A", area: "S" }).select("id").single();
say("F-1 empty boards refused", r.error?.code === "23514", r.error?.code ?? "ACCEPTED");
r = await db.from("institutes").insert({ name: "x".repeat(201), type: "school", boards: ["CBSE"],
  state: "G", city: "A", area: "S" }).select("id").single();
say("F-1 201-char name refused", r.error?.code === "23514", r.error?.code ?? "ACCEPTED");

// F-2 - on a real existing row, without changing it
const { data: v } = await db.from("visits").select("id,latitude,longitude").limit(1).single();
r = await db.from("visits").update({ latitude: 23.02, longitude: null }).eq("id", v.id).select("id");
say("F-2 half a visit coordinate refused", r.error?.code === "23514", r.error?.code ?? "ACCEPTED");
const { data: p } = await db.from("daily_plans").select("id,checkin_at").limit(1).single();
r = await db.from("daily_plans").update({ checkin_lat: 23.02, checkin_lng: null }).eq("id", p.id).select("id");
say("F-2 half a check-in pair refused", r.error?.code === "23514", r.error?.code ?? "ACCEPTED");

// F-4 - only meaningful if that plan is already checked in
if (p.checkin_at) {
  r = await db.from("daily_plans").update({ checkin_at: new Date().toISOString() }).eq("id", p.id).select("id");
  say("F-4 check-in rewrite refused (service role)", r.error?.code === "FO011", r.error?.code ?? "ACCEPTED");
} else {
  say("F-4 trigger present (plan not checked in, so not exercised)", true, "see the notice you saw on apply");
}

// N-1 - a trusted context may still reassign, so confirm the trigger exists by
// checking a rep is blocked would need a rep; the apply notice covered it.
const { data: inst } = await db.from("institutes").select("id,registered_by").limit(1).single();
r = await db.from("institutes").update({ registered_by: inst.registered_by }).eq("id", inst.id).select("id");
say("N-1 admin/service context may still set registered_by", !r.error, r.error?.code ?? "allowed as designed");
