import fs from "node:fs";
import {createRequire} from "node:module";
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE??"D:/devcache/npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json")("playwright");
process.loadEnvFile(".env.local");
if(process.env.NEXT_PUBLIC_SUPABASE_URL!=="http://127.0.0.1:56321")throw Error("Local sandbox only");
const f=JSON.parse(fs.readFileSync(".local-reconcile/fixtures.json"));
fs.mkdirSync("output/reconcile/screenshots",{recursive:true});
fs.mkdirSync(".local-reconcile/sessions",{recursive:true});
const browser=await chromium.launch({args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
const results=[];
for(const [role,routes] of [
 ["admin",["/","/team","/team/hierarchy","/settings","/slabs","/review","/targets","/pending/follow-ups","/institutes","/team/report"]],
 ["alice",["/","/institutes","/targets","/pending","/report",`/slabs?institute=${f.schools.alpha.id}`]],
 ["lead",["/","/team/hierarchy","/institutes"]],
]){
 const context=await browser.newContext({viewport:{width:1440,height:1100},geolocation:{latitude:23.03,longitude:72.58},permissions:["geolocation","camera"]});
 const page=await context.newPage();
 await page.goto("http://127.0.0.1:3100/login");
 await page.locator("input[name=email]").fill(f.accounts[role].email);
 await page.locator("input[name=password]").fill("Local-reconcile-2026!");
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await page.waitForURL(role==="lead"?"**/team":"http://127.0.0.1:3100/");
 await page.locator("h1").waitFor();
 await context.storageState({path:`.local-reconcile/sessions/${role}.json`});
 for(const route of routes){
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  const response=await page.goto("http://127.0.0.1:3100"+route);
  if(role==="lead"&&route==="/")await page.waitForURL("**/team");
  await page.locator("h1").waitFor();await page.waitForTimeout(300);
  const text=await page.locator("body").innerText();
  const key=role+route.replace(/[^a-zA-Z0-9]/g,"-");
  fs.writeFileSync(`.local-reconcile/${key}.txt`,text);
  await page.screenshot({path:`output/reconcile/screenshots/${key}.png`,fullPage:false});
  results.push({role,route,url:page.url(),status:response.status(),errors,text});
  console.log(role,route,response.status(),text.length,"characters",errors.length,"browser errors");
 }
 await context.close();
}
await browser.close();
fs.writeFileSync(".local-reconcile/browser-audit.json",JSON.stringify(results,null,2));
