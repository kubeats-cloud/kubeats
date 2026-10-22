import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

process.loadEnvFile(".env.local");
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56321") {
  throw new Error("This harness only supports the isolated reconciliation sandbox on port 56321.");
}
const container = "supabase_db_free_lance_reconcile";
const sql = (input) => execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const files = readdirSync("supabase/migrations").filter(f=>f.endsWith(".sql")).sort();
const numbers = files.map(f=>f.split("_")[0]);
if(new Set(numbers).size !== numbers.length)throw new Error("Duplicate migration versions");
const count=sql("select count(*) from pg_tables where schemaname='public';");
if(!/\b0\b/.test(count))throw new Error("Fresh public schema required. This script never resets an existing database.");
const results=[];
for(const name of files){
  let input=readFileSync(`supabase/migrations/${name}`,"utf8");
  if(name==="0004_photo_retention_schedule.sql"){
    input=input.replace("v_url text := 'paste project URL between these quotes';","v_url text := 'https://local.supabase.test';")
      .replace("v_key text := 'paste service_role key between these quotes';",`v_key text := '${process.env.SUPABASE_SERVICE_ROLE_KEY}';`);
  }
  try{sql(input);results.push({migration:name,status:"passed"});console.log("PASS",name);}
  catch(error){console.error("FAIL",name,String(error.stderr).replaceAll(process.env.SUPABASE_SERVICE_ROLE_KEY,"[local key]"));process.exitCode=1;break;}
}
mkdirSync(".local-reconcile",{recursive:true});
writeFileSync(".local-reconcile/migrations.json",JSON.stringify(results,null,2));
console.log(`${results.length}/${files.length} ordered migrations applied to fresh isolated local database`);
