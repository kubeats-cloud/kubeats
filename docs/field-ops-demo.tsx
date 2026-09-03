import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, MapPin, Calendar, User, Search, X, Stamp, TrendingUp, Clock,
  CheckCircle2, Trash2, Sunrise, Target, ListChecks, LayoutDashboard,
  AlertCircle, Building2, Camera, Navigation, ChevronRight, LogOut
} from "lucide-react";

const COLORS = { ink: "#1C2B39", cream: "#FAF6EE", teal: "#2F6F62", tealBg: "#E1EFEA", gold: "#C99A2E", goldBg: "#FBF3DA", rust: "#A13D2B", rustBg: "#FBE6DF", line: "#E3DBC9" };

const ACTIVITIES = [
  { key: "meeting", label: "Meeting", lifecycle: false },
  { key: "session", label: "Session", lifecycle: true },
  { key: "campusVisit", label: "Campus Visit", lifecycle: true },
  { key: "olympiad", label: "Olympiad Registration", lifecycle: false },
  { key: "application", label: "Application Form", lifecycle: false },
  { key: "admission", label: "Admission", lifecycle: false },
];
const ACT_MAP = Object.fromEntries(ACTIVITIES.map(a => [a.key, a]));

const WEEKLY_FIELDS = [
  { key: "meetings", label: "Meetings" },
  { key: "sessionsSet", label: "Sessions Set" },
  { key: "sessionsDone", label: "Sessions Done" },
  { key: "campusVisitsSet", label: "Campus Visits Set" },
  { key: "campusVisitsDone", label: "Campus Visits Done" },
  { key: "olympiad", label: "Olympiad Registrations" },
  { key: "application", label: "Application Forms" },
  { key: "admission", label: "Admissions" },
];

// Purpose of meeting is now an admin-managed list (like Locations) — this is just the seed.
const PURPOSE_SEED = ["Fix a session", "Fix a campus visit", "Complete a session", "Complete a campus visit", "Other"];

function weekEndISO(weekStart) {
  const dt = new Date(weekStart);
  dt.setDate(dt.getDate() + 5); // Monday -> Saturday
  return dt.toISOString().slice(0, 10);
}
function fmtShort(d) {
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function shiftWeek(weekStart, dir) {
  const dt = new Date(weekStart);
  dt.setDate(dt.getDate() + dir * 7);
  return dt.toISOString().slice(0, 10);
}

const STREAMS = ["science", "commerce", "humanities"];
const BOARDS = ["CBSE", "ICSE", "State Board", "IB", "Cambridge", "Others"];
const INSTITUTE_STATUSES = [
  "First meeting done",
  "Session scheduled",
  "Session done",
  "Campus visit scheduled",
  "Campus visit done",
  "Pending for management approval",
];

// Starter location list covering every Indian state/UT with major cities — admin can add/edit/remove
// states, cities and areas from the Locations tab. This is name-based, not full PIN-code granular;
// the real production app should import the official India Post PIN code dataset for full accuracy.
const LOCATIONS_SEED = {
  "Andhra Pradesh": { "Visakhapatnam": ["Dwaraka Nagar", "MVP Colony"], "Vijayawada": ["Governorpet"], "Guntur": ["Brodipet"], "Tirupati": ["Renigunta Road"] },
  "Arunachal Pradesh": { "Itanagar": ["Naharlagun"] },
  "Assam": { "Guwahati": ["Dispur", "Paltan Bazaar"], "Silchar": ["Tarapur"], "Dibrugarh": ["Chowkidinghee"] },
  "Bihar": { "Patna": ["Boring Road", "Kankarbagh"], "Gaya": ["Civil Lines"], "Muzaffarpur": ["Club Road"] },
  "Chhattisgarh": { "Raipur": ["Shankar Nagar"], "Bhilai": ["Nehru Nagar"], "Bilaspur": ["Vyapar Vihar"] },
  "Goa": { "Panaji": ["Miramar", "Dona Paula"], "Margao": ["Fatorda"] },
  "Gujarat": { "Ahmedabad": ["Navrangpura", "Satellite", "Bopal", "Maninagar"], "Surat": ["Adajan", "Vesu"], "Vadodara": ["Alkapuri", "Gotri"], "Rajkot": ["Kalawad Road"] },
  "Haryana": { "Gurugram": ["DLF Phase 1", "Sector 29"], "Faridabad": ["Sector 15"], "Panipat": ["Model Town"] },
  "Himachal Pradesh": { "Shimla": ["Mall Road"], "Dharamshala": ["McLeod Ganj"] },
  "Jharkhand": { "Ranchi": ["Lalpur", "Harmu"], "Jamshedpur": ["Sakchi"], "Dhanbad": ["Bank More"] },
  "Karnataka": { "Bengaluru": ["Koramangala", "Whitefield", "Indiranagar", "Jayanagar"], "Mysuru": ["Vijayanagar"], "Mangaluru": ["Kadri"], "Hubballi": ["Vidyanagar"] },
  "Kerala": { "Kochi": ["Kakkanad", "Edappally"], "Thiruvananthapuram": ["Kowdiar"], "Kozhikode": ["Mavoor Road"] },
  "Madhya Pradesh": { "Indore": ["Vijay Nagar", "Palasia"], "Bhopal": ["Arera Colony", "MP Nagar"], "Gwalior": ["City Centre"], "Jabalpur": ["Napier Town"] },
  "Maharashtra": { "Mumbai": ["Andheri", "Bandra", "Borivali", "Dadar"], "Pune": ["Kothrud", "Viman Nagar", "Baner"], "Nagpur": ["Sadar", "Dharampeth"], "Nashik": ["College Road"] },
  "Manipur": { "Imphal": ["Thangal Bazar"] },
  "Meghalaya": { "Shillong": ["Laitumkhrah"] },
  "Mizoram": { "Aizawl": ["Chanmari"] },
  "Nagaland": { "Kohima": ["Midland"] },
  "Odisha": { "Bhubaneswar": ["Saheed Nagar", "Patia"], "Cuttack": ["Buxi Bazar"], "Rourkela": ["Sector 5"] },
  "Punjab": { "Ludhiana": ["Model Town", "Sarabha Nagar"], "Amritsar": ["Ranjit Avenue"], "Jalandhar": ["Model Town"] },
  "Rajasthan": { "Jaipur": ["Malviya Nagar", "Vaishali Nagar", "C Scheme"], "Udaipur": ["Hiran Magri"], "Jodhpur": ["Ratanada"], "Kota": ["Talwandi"] },
  "Sikkim": { "Gangtok": ["MG Marg"] },
  "Tamil Nadu": { "Chennai": ["Adyar", "T Nagar", "Anna Nagar", "Velachery"], "Coimbatore": ["RS Puram"], "Madurai": ["KK Nagar"], "Tiruchirappalli": ["Thillai Nagar"] },
  "Telangana": { "Hyderabad": ["Banjara Hills", "Gachibowli", "Madhapur", "Kukatpally"], "Warangal": ["Hanamkonda"] },
  "Tripura": { "Agartala": ["Ramnagar"] },
  "Uttar Pradesh": { "Lucknow": ["Gomti Nagar", "Hazratganj"], "Noida": ["Sector 62", "Sector 18"], "Kanpur": ["Civil Lines"], "Varanasi": ["Sigra"], "Agra": ["Sadar"], "Ghaziabad": ["Vaishali"] },
  "Uttarakhand": { "Dehradun": ["Rajpur Road"], "Haridwar": ["Jwalapur"] },
  "West Bengal": { "Kolkata": ["Salt Lake", "Park Street", "Ballygunge"], "Howrah": ["Shibpur"], "Siliguri": ["Sevoke Road"] },
  "Andaman and Nicobar Islands": { "Port Blair": ["Aberdeen Bazaar"] },
  "Chandigarh": { "Chandigarh": ["Sector 17", "Sector 22"] },
  "Dadra and Nagar Haveli and Daman and Diu": { "Daman": ["Nani Daman"] },
  "Delhi": { "New Delhi": ["Dwarka", "Rohini", "Saket", "Vasant Kunj"] },
  "Jammu and Kashmir": { "Srinagar": ["Rajbagh"], "Jammu": ["Gandhi Nagar"] },
  "Ladakh": { "Leh": ["Leh Town"] },
  "Lakshadweep": { "Kavaratti": ["Kavaratti Town"] },
  "Puducherry": { "Puducherry": ["White Town"] },
};

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function digitsOnly(v, max) { const d = String(v).replace(/\D/g, ""); return max ? d.slice(0, max) : d; }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function weekStartISO(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  dt.setDate(dt.getDate() + diff);
  return dt.toISOString().slice(0, 10);
}
async function sGet(key) { try { const r = await window.storage.get(key, true); return r ? JSON.parse(r.value) : null; } catch (e) { return null; } }
async function sSet(key, val) { try { await window.storage.set(key, JSON.stringify(val), true); } catch (e) {} }

function compressImage(file, maxW = 500, quality = 0.5) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [myRole, setMyRole] = useState("rep");
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState({});
  const [institutes, setInstitutes] = useState([]);
  const [visits, setVisits] = useState([]);
  const [dailyTargets, setDailyTargets] = useState([]);
  const [weeklyTargets, setWeeklyTargets] = useState([]);
  const [locations, setLocations] = useState({});
  const [purposes, setPurposes] = useState([]);
  const [tab, setTab] = useState("dashboard");

  useEffect(() => {
    (async () => {
      setMembers((await sGet("demo_members")) || []);
      setRoles((await sGet("demo_roles")) || {});
      setInstitutes((await sGet("demo_institutes")) || []);
      setVisits((await sGet("demo_visits")) || []);
      setDailyTargets((await sGet("demo_daily")) || []);
      setWeeklyTargets((await sGet("demo_weekly")) || []);
      const loc = await sGet("demo_locations");
      if (loc) {
        // Merge in any new seed states without touching admin's existing edits.
        const merged = { ...loc };
        let changed = false;
        Object.keys(LOCATIONS_SEED).forEach(state => {
          if (!(state in merged)) { merged[state] = LOCATIONS_SEED[state]; changed = true; }
        });
        setLocations(merged);
        if (changed) sSet("demo_locations", merged);
      } else {
        setLocations(LOCATIONS_SEED);
        sSet("demo_locations", LOCATIONS_SEED);
      }
      const purp = await sGet("demo_purposes");
      if (purp) { setPurposes(purp); } else { setPurposes(PURPOSE_SEED); sSet("demo_purposes", PURPOSE_SEED); }
      setLoading(false);
    })();
  }, []);

  function addMember(name) {
    const n = name.trim();
    if (n && !members.includes(n)) { const next = [...members, n]; setMembers(next); sSet("demo_members", next); }
  }
  function setRole(name, role) {
    const next = { ...roles, [name]: role };
    setRoles(next);
    sSet("demo_roles", next);
  }
  function handleLogin(name, role) {
    addMember(name);
    setRole(name, role);
    setMe(name);
    setMyRole(role);
  }
  function saveInstitutes(next) { setInstitutes(next); sSet("demo_institutes", next); }
  function saveVisits(next) { setVisits(next); sSet("demo_visits", next); }
  function saveDaily(next) { setDailyTargets(next); sSet("demo_daily", next); }
  function saveWeekly(next) { setWeeklyTargets(next); sSet("demo_weekly", next); }
  function saveLocations(next) { setLocations(next); sSet("demo_locations", next); }
  function savePurposes(next) { setPurposes(next); sSet("demo_purposes", next); }

  if (loading) return <div style={{ background: COLORS.cream, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif" }}>Loading…</div>;

  const GlobalStyle = () => (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap');
      * { box-sizing: border-box; }
      body { margin: 0; }
      .btn { cursor: pointer; border: none; border-radius: 8px; font-family: inherit; font-weight: 600; transition: transform .1s ease; }
      .btn:active { transform: scale(0.97); }
      input, select, textarea { font-family: inherit; width: 100%; padding: 9px 10px; border-radius: 8px; border: 1px solid ${COLORS.line}; font-size: 13px; background: #fff; }
      label { font-size: 11px; font-weight: 600; opacity: 0.6; text-transform: uppercase; display: block; margin-bottom: 4px; }
    `}</style>
  );

  if (!me) return (<><GlobalStyle /><LoginScreen members={members} roles={roles} onLogin={handleLogin} /></>);

  const TABS = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "institutes", label: "Institutes", icon: Building2 },
    { key: "log", label: "Log Visit", icon: Plus },
    { key: "pending", label: "Pending", icon: AlertCircle },
    { key: "targets", label: "Targets", icon: Target },
    ...(myRole === "admin" ? [{ key: "locations", label: "Settings", icon: ListChecks }] : []),
  ];

  return (
    <div style={{ minHeight: "100vh", background: COLORS.cream, fontFamily: "'Inter', system-ui, sans-serif", color: COLORS.ink, paddingBottom: 70 }}>
      <GlobalStyle />
      <header style={{ background: COLORS.ink, color: COLORS.cream, padding: "18px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Stamp size={18} color={COLORS.gold} />
              <span style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: COLORS.gold, fontWeight: 600 }}>Field Ops · Demo <span style={{ opacity: 0.5 }}>· build 10</span></span>
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 18, marginTop: 2 }}>Hi, {me}</div>
          </div>
          <button onClick={() => setMe(null)} style={{ background: "none", border: "none", color: COLORS.cream, opacity: 0.6, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
            <LogOut size={14} /> switch
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "14px 16px 0" }}>
        <div style={{ background: COLORS.goldBg, color: "#7a5d16", fontSize: 11.5, padding: "8px 12px", borderRadius: 8, marginBottom: 14 }}>
          This is a click-through demo for testing the workflow — login here is just a name picker, not real secure auth.
        </div>
        {tab === "dashboard" && <Dashboard me={me} myRole={myRole} members={members} institutes={institutes} visits={visits} dailyTargets={dailyTargets} weeklyTargets={weeklyTargets} />}
        {tab === "institutes" && <Institutes institutes={institutes} saveInstitutes={saveInstitutes} me={me} visits={visits} setTab={setTab} locations={locations} saveLocations={saveLocations} />}
        {tab === "log" && <LogVisit me={me} institutes={institutes} saveVisits={saveVisits} visits={visits} setTab={setTab} dailyTargets={dailyTargets} saveDaily={saveDaily} saveInstitutes={saveInstitutes} purposes={purposes} />}
        {tab === "pending" && <Pending visits={visits} saveVisits={saveVisits} institutes={institutes} />}
        {tab === "targets" && <Targets me={me} members={members} addMember={addMember} institutes={institutes} dailyTargets={dailyTargets} saveDaily={saveDaily} weeklyTargets={weeklyTargets} saveWeekly={saveWeekly} visits={visits} setTab={setTab} purposes={purposes} />}
        {tab === "locations" && myRole === "admin" && <LocationsAdmin locations={locations} saveLocations={saveLocations} purposes={purposes} savePurposes={savePurposes} />}
      </div>

      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: `1px solid ${COLORS.line}`, display: "flex", justifyContent: "space-around", padding: "6px 4px" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 4px", color: tab === t.key ? COLORS.teal : "#9a948a" }}>
            <t.icon size={18} />
            <span style={{ fontSize: 9, fontWeight: 600 }}>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function LoginScreen({ members, roles, onLogin }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("rep");
  return (
    <div style={{ minHeight: "100vh", background: COLORS.ink, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 340, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, justifyContent: "center" }}>
          <Stamp size={20} color={COLORS.gold} />
          <span style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: COLORS.gold, fontWeight: 600 }}>Field Ops Demo</span>
        </div>
        <h1 style={{ fontFamily: "'Fraunces', serif", color: COLORS.cream, textAlign: "center", fontSize: 24, marginBottom: 20 }}>Who's testing?</h1>
        <div style={{ background: "#fff", borderRadius: 12, padding: 16 }}>
          <label>Your name</label>
          <input list="member-names" value={name} onChange={e => setName(e.target.value)} placeholder="Type your name" />
          <datalist id="member-names">{members.map(m => <option key={m} value={m} />)}</datalist>
          <div style={{ marginTop: 10 }}>
            <label>Role (demo only — real app assigns this securely)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn" onClick={() => setRole("rep")} style={{ flex: 1, padding: 8, fontSize: 12, background: role === "rep" ? COLORS.teal : "#fff", color: role === "rep" ? "#fff" : COLORS.ink, border: `1px solid ${COLORS.line}` }}>Rep</button>
              <button type="button" className="btn" onClick={() => setRole("admin")} style={{ flex: 1, padding: 8, fontSize: 12, background: role === "admin" ? COLORS.teal : "#fff", color: role === "admin" ? "#fff" : COLORS.ink, border: `1px solid ${COLORS.line}` }}>Admin</button>
            </div>
          </div>
          <button className="btn" onClick={() => name.trim() && onLogin(name.trim(), role)} style={{ width: "100%", background: COLORS.teal, color: "#fff", padding: 11, marginTop: 10 }}>Continue</button>
          {members.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 6 }}>OR PICK AN EXISTING TESTER</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {members.map(m => (
                  <button key={m} className="btn" onClick={() => onLogin(m, roles[m] || "rep")} style={{ background: COLORS.tealBg, color: COLORS.teal, padding: "6px 10px", fontSize: 12 }}>{m}{roles[m] === "admin" ? " (admin)" : ""}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ children, style, onClick }) { return <div onClick={onClick} style={{ background: "#fff", borderRadius: 12, padding: 14, boxShadow: "0 2px 8px rgba(28,43,57,0.08)", ...style }}>{children}</div>; }
function SectionTitle({ children }) { return <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 17, margin: "4px 0 10px" }}>{children}</div>; }
function Bar({ pct, color }) { return <div style={{ height: 6, background: COLORS.line, borderRadius: 4, overflow: "hidden", marginTop: 4 }}><div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color }} /></div>; }

function Dashboard({ me, myRole, members, institutes, visits, dailyTargets, weeklyTargets }) {
  const isAdmin = myRole === "admin";
  const [repFilter, setRepFilter] = useState("all");
  const today = todayISO();
  const wStart = weekStartISO(today);

  // Reps only ever see their own data. Admins see the whole team, optionally narrowed to one rep.
  const scopeMembers = isAdmin ? (repFilter === "all" ? members : [repFilter]) : [me];

  const todayDaily = dailyTargets.filter(d => d.date === today && scopeMembers.includes(d.member));
  const todayTargetSum = todayDaily.length;
  const todayActualSum = todayDaily.filter(d => d.meetingsActual !== null).length;
  const pendingCount = visits.filter(v => v.lifecycleStatus === "Set" && scopeMembers.includes(v.member)).length;
  const scopedWeekly = weeklyTargets.filter(w => w.weekStart === wStart && scopeMembers.includes(w.member));

  function achievedFor(member, key) {
    if (key === "meetings") {
      return dailyTargets.filter(d => d.member === member && weekStartISO(d.date) === wStart && d.meetingsActual !== null).length;
    }
    const map = {
      sessionsSet: v => v.activity === "session" && v.lifecycleStatus === "Set",
      sessionsDone: v => v.activity === "session" && v.lifecycleStatus === "Done",
      campusVisitsSet: v => v.activity === "campusVisit" && v.lifecycleStatus === "Set",
      campusVisitsDone: v => v.activity === "campusVisit" && v.lifecycleStatus === "Done",
      olympiad: v => v.activity === "olympiad",
      application: v => v.activity === "application",
      admission: v => v.activity === "admission",
    };
    return visits.filter(v => v.member === member && weekStartISO(v.date) === wStart && map[key](v)).length;
  }

  function overallPct(w) {
    const withTarget = WEEKLY_FIELDS.filter(f => Number(w[f.key]) > 0);
    if (withTarget.length === 0) return null;
    const total = withTarget.reduce((s, f) => s + Math.min(1, achievedFor(w.member, f.key) / Number(w[f.key])), 0);
    return Math.round((total / withTarget.length) * 100);
  }

  return (
    <div>
      {isAdmin && (
        <div style={{ background: COLORS.ink, color: COLORS.cream, borderRadius: 10, padding: "6px 12px", fontSize: 11, marginBottom: 12, display: "inline-block" }}>
          Team dashboard — viewing {repFilter === "all" ? `all ${members.length} rep(s)` : repFilter}
        </div>
      )}
      <SectionTitle>Today</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
        <Card><TrendingUp size={15} color={COLORS.teal} /><div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, marginTop: 4 }}>{todayTargetSum}</div><div style={{ fontSize: 10, opacity: 0.6 }}>Visits planned today</div></Card>
        <Card><CheckCircle2 size={15} color={COLORS.teal} /><div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, marginTop: 4 }}>{todayActualSum}</div><div style={{ fontSize: 10, opacity: 0.6 }}>Visits held today</div></Card>
        <Card><Clock size={15} color={COLORS.rust} /><div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, marginTop: 4 }}>{pendingCount}</div><div style={{ fontSize: 10, opacity: 0.6 }}>Open loops</div></Card>
      </div>

      {isAdmin && members.length > 0 && (
        <>
          <SectionTitle>Team snapshot — this week</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
            {members.map(m => {
              const w = weeklyTargets.find(x => x.weekStart === wStart && x.member === m);
              const pct = w ? overallPct(w) : null;
              const openLoops = visits.filter(v => v.lifecycleStatus === "Set" && v.member === m).length;
              return (
                <Card key={m} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setRepFilter(m)}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{m}</div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>{w ? `Weekly commitment ${w.locked ? "submitted" : "in progress"}` : "No weekly commitment yet"} · {openLoops} open loop(s)</div>
                  </div>
                  {pct !== null ? (
                    <div style={{ fontWeight: 700, fontSize: 15, color: pct >= 100 ? COLORS.teal : pct >= 50 ? "#a67e1e" : COLORS.rust }}>{pct}%</div>
                  ) : <div style={{ fontSize: 11, opacity: 0.4 }}>—</div>}
                </Card>
              );
            })}
          </div>
          {repFilter !== "all" && (
            <button className="btn" onClick={() => setRepFilter("all")} style={{ background: "#fff", border: `1px solid ${COLORS.line}`, color: COLORS.ink, padding: "6px 12px", fontSize: 11.5, marginBottom: 12 }}>← Back to whole team</button>
          )}
        </>
      )}

      <SectionTitle>{isAdmin ? "Target vs achieved" : "This week — target vs achieved"}</SectionTitle>
      {scopedWeekly.length === 0 ? <Card style={{ opacity: 0.6, fontSize: 13 }}>No weekly commitments logged yet. Add one in Targets.</Card> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {scopedWeekly.map(w => (
            <Card key={w.id}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{w.member}</div>
              {WEEKLY_FIELDS.map(f => {
                const target = Number(w[f.key]) || 0;
                const achieved = achievedFor(w.member, f.key);
                const pct = target > 0 ? (achieved / target) * 100 : 0;
                return (
                  <div key={f.key} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                      <span style={{ opacity: 0.7 }}>{f.label}</span>
                      <span style={{ fontWeight: 600 }}>{achieved} / {target}</span>
                    </div>
                    <Bar pct={pct} color={pct >= 100 ? COLORS.teal : pct >= 50 ? COLORS.gold : COLORS.rust} />
                  </div>
                );
              })}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Institutes({ institutes, saveInstitutes, me, visits, setTab, locations, saveLocations }) {
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null);
  const [fState, setFState] = useState("all");
  const [fCity, setFCity] = useState("all");
  const [fType, setFType] = useState("all");
  const [fBoards, setFBoards] = useState([]);

  function toggleFBoard(b) {
    setFBoards(f => f.includes(b) ? f.filter(x => x !== b) : [...f, b]);
  }

  const availableStates = [...new Set(institutes.map(i => i.state).filter(Boolean))].sort();
  const availableCities = [...new Set(institutes.filter(i => fState === "all" || i.state === fState).map(i => i.city).filter(Boolean))].sort();
  const availableBoards = [...new Set(institutes.flatMap(i => i.boards || []))].sort();

  const filtered = institutes
    .filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || (i.city || "").toLowerCase().includes(search.toLowerCase()))
    .filter(i => fState === "all" || i.state === fState)
    .filter(i => fCity === "all" || i.city === fCity)
    .filter(i => fType === "all" || i.type === fType)
    .filter(i => fBoards.length === 0 || (i.boards || []).some(b => fBoards.includes(b)));

  function addInstitute(entry) {
    const next = [{ id: uid(), ...entry, registeredBy: me, createdAt: new Date().toISOString() }, ...institutes];
    saveInstitutes(next);
    setShowForm(false);
    setTab("institutes"); // stay on / return to the institute home page after registering
  }

  const history = open ? visits.filter(v => v.instituteId === open.id).sort((a, b) => new Date(b.date) - new Date(a.date)) : [];

  function streamCount(i) {
    return new Set([...(i.class11 || []), ...Object.keys(i.class12 || {})]).size;
  }
  function studentCount(i) {
    return Object.values(i.class12 || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  }
  function keyPerson(i) {
    if (i.decisionMaker) return `${i.decisionMaker}${i.designation ? ` (${i.designation})` : ""}`;
    if (i.principal) return i.principal;
    return "—";
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <SectionTitle>Institutes</SectionTitle>
        <button className="btn" onClick={() => setShowForm(true)} style={{ background: COLORS.teal, color: "#fff", padding: "8px 12px", fontSize: 12 }}>+ Register</button>
      </div>
      <div style={{ position: "relative", marginBottom: 10 }}>
        <Search size={14} style={{ position: "absolute", left: 9, top: 10, opacity: 0.4 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or city" style={{ paddingLeft: 28 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
        <select value={fState} onChange={e => { setFState(e.target.value); setFCity("all"); }} style={{ fontSize: 12 }}>
          <option value="all">All states</option>
          {availableStates.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fCity} onChange={e => setFCity(e.target.value)} style={{ fontSize: 12 }}>
          <option value="all">All cities</option>
          {availableCities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fType} onChange={e => setFType(e.target.value)} style={{ fontSize: 12 }}>
          <option value="all">All types</option>
          <option value="school">School</option><option value="coaching">Coaching</option><option value="consultant">Consultant</option>
        </select>
      </div>
      {availableBoards.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {availableBoards.map(b => (
            <button key={b} type="button" onClick={() => toggleFBoard(b)} className="btn" style={{ fontSize: 11, padding: "4px 10px", background: fBoards.includes(b) ? COLORS.teal : "#fff", color: fBoards.includes(b) ? "#fff" : COLORS.ink, border: `1px solid ${COLORS.line}` }}>{b}</button>
          ))}
        </div>
      )}

      {open && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700 }}>{open.name}</div>
            <button onClick={() => setOpen(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={16} /></button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>{open.area}, {open.city}, {open.state} · {(open.boards || []).join(", ")} · Visited {history.length} time(s)</div>
          {open.status && (
            <div style={{ display: "inline-block", background: open.status === "Pending for management approval" ? COLORS.rustBg : COLORS.goldBg, color: open.status === "Pending for management approval" ? COLORS.rust : "#7a5d16", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, marginBottom: 8 }}>
              {open.status}
            </div>
          )}
          <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 8 }}>
            {open.principal && <>Principal/Owner: {open.principal}{open.principalMobile ? ` (${open.principalMobile})` : ""}<br /></>}
            {open.decisionMaker && <>Decision maker: {open.decisionMaker}{open.designation ? `, ${open.designation}` : ""}{open.decisionMakerMobile ? ` (${open.decisionMakerMobile})` : ""}<br /></>}
            Streams: {streamCount(open)} · Approx Class 12 students: {studentCount(open)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
            {history.map(h => (
              <div key={h.id} style={{ fontSize: 12, borderLeft: `3px solid ${COLORS.teal}`, paddingLeft: 8 }}>
                <b>{ACT_MAP[h.activity].label}</b>{h.lifecycleStatus ? ` (${h.lifecycleStatus})` : ""} — {h.member} — {new Date(h.date).toLocaleDateString()}
              </div>
            ))}
            {history.length === 0 && <div style={{ fontSize: 12, opacity: 0.5 }}>No visits yet.</div>}
          </div>
        </Card>
      )}

      <div style={{ fontSize: 11.5, opacity: 0.5, marginBottom: 8 }}>{filtered.length} institute(s)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map(i => (
          <Card key={i.id} style={{ cursor: "pointer" }} onClick={() => setOpen(i)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{i.name}</div>
                <div style={{ fontSize: 11.5, opacity: 0.6, textTransform: "capitalize" }}>{i.type} · {i.area}, {i.city}</div>
              </div>
              <ChevronRight size={16} opacity={0.3} />
            </div>
            {i.status && (
              <div style={{ display: "inline-block", background: i.status === "Pending for management approval" ? COLORS.rustBg : COLORS.goldBg, color: i.status === "Pending for management approval" ? COLORS.rust : "#7a5d16", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20, marginTop: 6 }}>
                {i.status}
              </div>
            )}
            <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11.5 }}>
              <span style={{ opacity: 0.7 }}>Key person: <b>{keyPerson(i)}</b></span>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 11.5 }}>
              <span style={{ background: COLORS.tealBg, color: COLORS.teal, borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>{streamCount(i)} stream(s)</span>
              <span style={{ background: COLORS.goldBg, color: "#7a5d16", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>{studentCount(i)} students (Cl.12)</span>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <Card style={{ opacity: 0.6, fontSize: 13, textAlign: "center" }}>No institutes match.</Card>}
      </div>

      {showForm && <InstituteForm onClose={() => setShowForm(false)} onSubmit={addInstitute} locations={locations} saveLocations={saveLocations} />}
    </div>
  );
}

function CascadingLocation({ form, set, locations, onAddArea }) {
  const [addingArea, setAddingArea] = useState(false);
  const [manualArea, setManualArea] = useState("");

  const states = Object.keys(locations).sort();
  const cities = form.state ? Object.keys(locations[form.state] || {}).sort() : [];
  const areas = form.state && form.city ? (locations[form.state]?.[form.city] || []) : [];

  function confirmManualArea() {
    const a = manualArea.trim();
    if (!a) return;
    set("area", a);
    onAddArea(form.state, form.city, a);
    setAddingArea(false);
    setManualArea("");
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div>
          <label>State</label>
          <select value={form.state} onChange={e => { set("state", e.target.value); set("city", ""); set("area", ""); setAddingArea(false); }}>
            <option value="">— Select —</option>
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label>City</label>
          <select value={form.city} disabled={!form.state} onChange={e => { set("city", e.target.value); set("area", ""); setAddingArea(false); }}>
            <option value="">{form.state ? "— Select —" : "Pick state first"}</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label>Area</label>
          {!addingArea ? (
            <select
              value={form.area}
              disabled={!form.city}
              onChange={e => { if (e.target.value === "__manual__") { setAddingArea(true); } else { set("area", e.target.value); } }}
            >
              <option value="">{form.city ? "— Select —" : "Pick city first"}</option>
              {areas.map(a => <option key={a} value={a}>{a}</option>)}
              {form.city && <option value="__manual__">+ Add area not listed</option>}
            </select>
          ) : (
            <div style={{ display: "flex", gap: 4 }}>
              <input autoFocus value={manualArea} onChange={e => setManualArea(e.target.value)} placeholder="Type area name" onKeyDown={e => e.key === "Enter" && (e.preventDefault(), confirmManualArea())} />
              <button type="button" className="btn" onClick={confirmManualArea} style={{ background: COLORS.teal, color: "#fff", padding: "0 10px", fontSize: 12, whiteSpace: "nowrap" }}>Add</button>
            </div>
          )}
        </div>
      </div>
      {addingArea && <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 4 }}>This adds "{manualArea || "…"}" to {form.city}'s area list for future use too.</div>}
    </div>
  );
}

function InstituteForm({ onClose, onSubmit, locations, saveLocations }) {
  const [form, setForm] = useState({
    name: "", type: "school", address: "", area: "", city: "", state: "", board: "CBSE", boardOther: "",
    principal: "", principalMobile: "", decisionMaker: "", decisionMakerMobile: "", designation: "",
    class11: [], // e.g. ["science","commerce"]
    class12: {}, // e.g. { science: "40", commerce: "30" }
    boards: [], // e.g. ["CBSE", "State Board"]
  });
  const [customBoard, setCustomBoard] = useState("");
  const [error, setError] = useState("");

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function addAreaToLocations(state, city, area) {
    if (!state || !city) return;
    const current = locations[state]?.[city] || [];
    if (current.includes(area)) return;
    saveLocations({ ...locations, [state]: { ...locations[state], [city]: [...current, area] } });
  }
  function toggle11(s) {
    setForm(f => ({ ...f, class11: f.class11.includes(s) ? f.class11.filter(x => x !== s) : [...f.class11, s] }));
  }
  function toggle12(s) {
    setForm(f => {
      const next = { ...f.class12 };
      if (s in next) delete next[s]; else next[s] = "";
      return { ...f, class12: next };
    });
  }
  function toggleBoard(b) {
    setForm(f => ({ ...f, boards: f.boards.includes(b) ? f.boards.filter(x => x !== b) : [...f.boards, b] }));
  }
  function addCustomBoard() {
    const b = customBoard.trim();
    if (!b || form.boards.includes(b)) return;
    setForm(f => ({ ...f, boards: [...f.boards, b] }));
    setCustomBoard("");
  }

  function submit(e) {
    e.preventDefault();
    try {
      if (!form.name.trim()) { setError("Institute name is required."); return; }
      if (!form.state || !form.city || !form.area) { setError("Please select state, city and area."); return; }
      if (form.boards.length === 0) { setError("Select at least one board."); return; }
      setError("");
      onSubmit(form);
    } catch (err) {
      setError("Something went wrong saving this: " + (err?.message || String(err)));
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,43,57,0.45)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit} style={{ background: COLORS.cream, width: "100%", maxWidth: 480, margin: "0 auto", maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "18px 20px 26px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 17 }}>Register institute</div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none" }}><X size={18} /></button>
        </div>
        <label>Type</label>
        <select value={form.type} onChange={e => set("type", e.target.value)} style={{ marginBottom: 10 }}>
          <option value="school">School</option><option value="coaching">Coaching</option><option value="consultant">Consultant</option>
        </select>
        <label>Name</label>
        <input value={form.name} onChange={e => set("name", e.target.value)} style={{ marginBottom: 10 }} />
        <label>Address</label>
        <input value={form.address} onChange={e => set("address", e.target.value)} style={{ marginBottom: 10 }} />

        <CascadingLocation form={form} set={set} locations={locations} onAddArea={addAreaToLocations} />
        {Object.keys(locations).length === 0 && (
          <div style={{ fontSize: 11.5, color: COLORS.rust, marginBottom: 10 }}>No locations set up yet — ask your admin to add states/cities/areas in the Locations tab.</div>
        )}

        <label>Board(s) — select all that apply</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {BOARDS.filter(b => b !== "Others").map(b => (
            <label key={b} onClick={() => toggleBoard(b)} style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 20, border: `1px solid ${form.boards.includes(b) ? COLORS.teal : COLORS.line}`, background: form.boards.includes(b) ? COLORS.tealBg : "#fff", color: form.boards.includes(b) ? COLORS.teal : COLORS.ink }}>
              {b}
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input placeholder="Add another board (e.g. NIOS)" value={customBoard} onChange={e => setCustomBoard(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomBoard(); } }} />
          <button type="button" className="btn" onClick={addCustomBoard} style={{ background: COLORS.goldBg, color: "#7a5d16", padding: "0 14px", whiteSpace: "nowrap" }}>Add</button>
        </div>
        {form.boards.filter(b => !BOARDS.includes(b)).length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {form.boards.filter(b => !BOARDS.includes(b)).map(b => (
              <span key={b} style={{ background: COLORS.tealBg, color: COLORS.teal, borderRadius: 20, padding: "4px 10px", fontSize: 11.5, display: "flex", alignItems: "center", gap: 5 }}>
                {b} <X size={11} style={{ cursor: "pointer" }} onClick={() => toggleBoard(b)} />
              </span>
            ))}
          </div>
        )}

        <label>Principal / Owner name</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <input value={form.principal} onChange={e => set("principal", e.target.value)} placeholder="Name" />
          <input value={form.principalMobile} onChange={e => set("principalMobile", digitsOnly(e.target.value, 10))} placeholder="Mobile number" type="tel" inputMode="numeric" maxLength={10} />
        </div>

        <label>Decision maker</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
          <input value={form.decisionMaker} onChange={e => set("decisionMaker", e.target.value)} placeholder="Name" />
          <input value={form.designation} onChange={e => set("designation", e.target.value)} placeholder="Designation" />
          <input value={form.decisionMakerMobile} onChange={e => set("decisionMakerMobile", digitsOnly(e.target.value, 10))} placeholder="Mobile number" type="tel" inputMode="numeric" maxLength={10} />
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, textTransform: "uppercase", marginBottom: 6 }}>Class 11 — tick streams present (no count)</div>
        <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
          {STREAMS.map(s => (
            <label key={s} style={{ display: "flex", alignItems: "center", gap: 5, textTransform: "capitalize", fontSize: 12.5, fontWeight: 500, opacity: 1, cursor: "pointer" }}>
              <input type="checkbox" checked={form.class11.includes(s)} onChange={() => toggle11(s)} style={{ width: "auto" }} /> {s}
            </label>
          ))}
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, textTransform: "uppercase", marginBottom: 6 }}>Class 12 — tick streams present + approx student count</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {STREAMS.map(s => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, textTransform: "capitalize", fontSize: 12.5, fontWeight: 500, width: 100, cursor: "pointer" }}>
                <input type="checkbox" checked={s in form.class12} onChange={() => toggle12(s)} style={{ width: "auto" }} /> {s}
              </label>
              {s in form.class12 && (
                <input type="text" inputMode="numeric" placeholder="Approx students" value={form.class12[s]} onChange={e => setForm(f => ({ ...f, class12: { ...f.class12, [s]: digitsOnly(e.target.value) } }))} style={{ flex: 1 }} />
              )}
            </div>
          ))}
        </div>

        <button className="btn" type="submit" style={{ width: "100%", background: COLORS.teal, color: "#fff", padding: 12, fontSize: 14 }}>Register</button>
        {error && <div style={{ color: COLORS.rust, fontSize: 12.5, fontWeight: 600, textAlign: "center", marginTop: 4 }}>{error}</div>}
      </form>
    </div>
  );
}

function LocationsAdmin({ locations, saveLocations, purposes, savePurposes }) {
  const [newPurpose, setNewPurpose] = useState("");
  const [newState, setNewState] = useState("");
  const [expandedState, setExpandedState] = useState(null);
  const [newCity, setNewCity] = useState("");
  const [expandedCity, setExpandedCity] = useState(null);
  const [newArea, setNewArea] = useState("");

  function addState() {
    const s = newState.trim();
    if (!s || locations[s]) return;
    saveLocations({ ...locations, [s]: {} });
    setNewState("");
  }
  function deleteState(s) {
    const next = { ...locations };
    delete next[s];
    saveLocations(next);
    if (expandedState === s) setExpandedState(null);
  }
  function addCity(state) {
    const c = newCity.trim();
    if (!c || locations[state][c]) return;
    saveLocations({ ...locations, [state]: { ...locations[state], [c]: [] } });
    setNewCity("");
  }
  function deleteCity(state, city) {
    const next = { ...locations, [state]: { ...locations[state] } };
    delete next[state][city];
    saveLocations(next);
    if (expandedCity === city) setExpandedCity(null);
  }
  function addArea(state, city) {
    const a = newArea.trim();
    if (!a || locations[state][city].includes(a)) return;
    saveLocations({ ...locations, [state]: { ...locations[state], [city]: [...locations[state][city], a] } });
    setNewArea("");
  }
  function deleteArea(state, city, area) {
    saveLocations({ ...locations, [state]: { ...locations[state], [city]: locations[state][city].filter(x => x !== area) } });
  }

  function addPurpose() {
    const p = newPurpose.trim();
    if (!p || purposes.includes(p)) return;
    savePurposes([...purposes, p]);
    setNewPurpose("");
  }
  function deletePurpose(p) {
    savePurposes(purposes.filter(x => x !== p));
  }

  return (
    <div>
      <SectionTitle>Settings (admin)</SectionTitle>

      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, marginBottom: 8 }}>Purpose of meeting — options</div>
      <Card style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input value={newPurpose} onChange={e => setNewPurpose(e.target.value)} placeholder="Add a new purpose" onKeyDown={e => e.key === "Enter" && addPurpose()} />
          <button className="btn" onClick={addPurpose} style={{ background: COLORS.teal, color: "#fff", padding: "0 16px", whiteSpace: "nowrap" }}>Add</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {purposes.map(p => (
            <span key={p} style={{ background: COLORS.tealBg, color: COLORS.teal, borderRadius: 20, padding: "4px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              {p} <X size={12} style={{ cursor: "pointer", opacity: 0.6 }} onClick={() => deletePurpose(p)} />
            </span>
          ))}
          {purposes.length === 0 && <span style={{ fontSize: 12, opacity: 0.4 }}>No purposes yet — reps won't be able to plan a visit until at least one exists.</span>}
        </div>
      </Card>

      <SectionTitle>Locations</SectionTitle>
      <Card style={{ marginBottom: 14, display: "flex", gap: 8 }}>
        <input value={newState} onChange={e => setNewState(e.target.value)} placeholder="Add a new state" onKeyDown={e => e.key === "Enter" && addState()} />
        <button className="btn" onClick={addState} style={{ background: COLORS.teal, color: "#fff", padding: "0 16px", whiteSpace: "nowrap" }}>Add</button>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.keys(locations).sort().map(state => (
          <Card key={state}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setExpandedState(expandedState === state ? null : state)}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{state} <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 11.5 }}>({Object.keys(locations[state]).length} cities)</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Trash2 size={14} style={{ opacity: 0.4 }} onClick={e => { e.stopPropagation(); deleteState(state); }} />
                <ChevronRight size={16} style={{ opacity: 0.3, transform: expandedState === state ? "rotate(90deg)" : "none" }} />
              </div>
            </div>

            {expandedState === state && (
              <div style={{ marginTop: 10, paddingLeft: 10, borderLeft: `2px solid ${COLORS.line}` }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <input value={newCity} onChange={e => setNewCity(e.target.value)} placeholder="Add a city" onKeyDown={e => e.key === "Enter" && addCity(state)} style={{ fontSize: 12 }} />
                  <button className="btn" onClick={() => addCity(state)} style={{ background: COLORS.tealBg, color: COLORS.teal, padding: "0 12px", fontSize: 12, whiteSpace: "nowrap" }}>Add</button>
                </div>
                {Object.keys(locations[state]).sort().map(city => (
                  <div key={city} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", fontSize: 12.5 }} onClick={() => setExpandedCity(expandedCity === city ? null : city)}>
                      <div style={{ fontWeight: 600 }}>{city} <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 11 }}>({locations[state][city].length} areas)</span></div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Trash2 size={12} style={{ opacity: 0.4 }} onClick={e => { e.stopPropagation(); deleteCity(state, city); }} />
                        <ChevronRight size={13} style={{ opacity: 0.3, transform: expandedCity === city ? "rotate(90deg)" : "none" }} />
                      </div>
                    </div>
                    {expandedCity === city && (
                      <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: `2px solid ${COLORS.line}` }}>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                          <input value={newArea} onChange={e => setNewArea(e.target.value)} placeholder="Add an area" onKeyDown={e => e.key === "Enter" && addArea(state, city)} style={{ fontSize: 11.5 }} />
                          <button className="btn" onClick={() => addArea(state, city)} style={{ background: COLORS.goldBg, color: "#7a5d16", padding: "0 10px", fontSize: 11.5, whiteSpace: "nowrap" }}>Add</button>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {locations[state][city].map(area => (
                            <span key={area} style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}`, borderRadius: 20, padding: "3px 8px", fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
                              {area} <X size={11} style={{ cursor: "pointer", opacity: 0.5 }} onClick={() => deleteArea(state, city, area)} />
                            </span>
                          ))}
                          {locations[state][city].length === 0 && <span style={{ fontSize: 11, opacity: 0.4 }}>No areas yet.</span>}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {Object.keys(locations[state]).length === 0 && <div style={{ fontSize: 11.5, opacity: 0.4 }}>No cities yet.</div>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function LogVisit({ me, institutes, saveVisits, visits, setTab, dailyTargets, saveDaily, saveInstitutes, purposes }) {
  const [instituteId, setInstituteId] = useState("");
  const [linkedDailyId, setLinkedDailyId] = useState(""); // which daily plan row this meeting completes
  const [activity, setActivity] = useState("meeting");
  const [lifecycleStatus, setLifecycleStatus] = useState("Done");
  const [scheduledDate, setScheduledDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [geo, setGeo] = useState(null);
  const [geoStatus, setGeoStatus] = useState("idle");
  const [photo, setPhoto] = useState(null);
  const [newStatus, setNewStatus] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");
  const [error, setError] = useState("");

  const [showAddToPlan, setShowAddToPlan] = useState(false);
  const [planInstituteId, setPlanInstituteId] = useState("");
  const [planPurpose, setPlanPurpose] = useState(purposes[0] || "");

  const act = ACT_MAP[activity];
  const today = todayISO();
  const openToday = dailyTargets.filter(d => d.member === me && d.date === today && d.meetingsActual === null && d.instituteId);

  // Session/Campus visit "scheduled" statuses already carry their own Expected date (the lifecycle Set date above),
  // so the follow-up section is hidden there to avoid asking for the same date twice.
  const FOLLOWUP_HIDDEN_FOR = ["Session scheduled", "Campus visit scheduled"];
  const followUpRequired = newStatus === "Pending for management approval";
  const followUpHidden = FOLLOWUP_HIDDEN_FOR.includes(newStatus);

  function pickOpenPlan(row) {
    setLinkedDailyId(row.id);
    setInstituteId(row.instituteId);
    setError("");
  }

  function addToPlanAndSelect() {
    if (!planInstituteId) { setError("Pick an institute to add to today's plan."); return; }
    if (!planPurpose) { setError("Pick a purpose for today's plan."); return; }
    const entry = { id: uid(), member: me, date: today, instituteId: planInstituteId, purpose: planPurpose, meetingsActual: null, followUpDate: null };
    saveDaily([entry, ...dailyTargets]);
    setLinkedDailyId(entry.id);
    setInstituteId(planInstituteId);
    setShowAddToPlan(false);
    setPlanInstituteId("");
    setError("");
  }

  function captureLocation() {
    setGeoStatus("locating");
    if (!navigator.geolocation) { setGeoStatus("unsupported"); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoStatus("done"); },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
  async function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await compressImage(file);
    setPhoto(dataUrl);
  }

  function submit(e) {
    e.preventDefault();
    try {
      if (activity === "meeting" && !linkedDailyId) { setError("A meeting can only be marked done from today's plan. Pick one above, or add this institute to today's plan first."); return; }
      if (activity !== "meeting" && !instituteId) { setError("Select an institute first."); return; }
      if (followUpRequired && !followUpDate) { setError("Follow-up date is required for \"Pending for management approval\"."); return; }

      const entry = {
        id: uid(), instituteId, member: me, activity, lifecycle: act.lifecycle,
        lifecycleStatus: act.lifecycle ? lifecycleStatus : null,
        date: act.lifecycle && lifecycleStatus === "Set" ? scheduledDate : today,
        loggedAt: new Date().toISOString(), geo, photo, notes,
        followUpDate: followUpHidden ? null : (followUpDate || null),
        followUpTime: followUpHidden ? null : (followUpTime || null),
        statusSetTo: newStatus || null,
      };
      saveVisits([entry, ...visits]);

      if (activity === "meeting" && linkedDailyId) {
        saveDaily(dailyTargets.map(d => d.id === linkedDailyId ? { ...d, meetingsActual: 1, followUpDate: entry.followUpDate || d.followUpDate } : d));
      }
      if (newStatus && instituteId) {
        saveInstitutes(institutes.map(i => i.id === instituteId ? { ...i, status: newStatus, statusUpdatedAt: new Date().toISOString(), statusUpdatedBy: me } : i));
      }
      setTab("dashboard");
    } catch (err) {
      setError("Something went wrong saving this: " + (err?.message || String(err)));
    }
  }

  return (
    <div>
      <SectionTitle>Log a visit</SectionTitle>

      {activity === "meeting" && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 14 }}>Open for today</div>
            <div style={{ background: COLORS.tealBg, color: COLORS.teal, fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20 }}>{openToday.length} open</div>
          </div>
          <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 8 }}>A meeting can only be marked done if it's on today's plan. Pick one below, or add a new one now.</div>
          {openToday.length === 0 && !showAddToPlan && (
            <div style={{ fontSize: 12.5, opacity: 0.6, marginBottom: 8 }}>Everything planned for today is logged.</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {openToday.map(row => (
              <button key={row.id} type="button" onClick={() => pickOpenPlan(row)} className="btn" style={{
                textAlign: "left", padding: "8px 10px", fontSize: 12.5,
                background: linkedDailyId === row.id ? COLORS.teal : "#fff", color: linkedDailyId === row.id ? "#fff" : COLORS.ink,
                border: `1px solid ${COLORS.line}`,
              }}>
                <b>{institutes.find(i => i.id === row.instituteId)?.name || "Unknown"}</b> — {row.purpose}
              </button>
            ))}
          </div>
          {!showAddToPlan ? (
            <button type="button" className="btn" onClick={() => setShowAddToPlan(true)} style={{ background: COLORS.goldBg, color: "#7a5d16", padding: "7px 10px", fontSize: 12 }}>+ Add an institute to today's plan</button>
          ) : (
            <div style={{ background: COLORS.cream, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <select value={planInstituteId} onChange={e => setPlanInstituteId(e.target.value)}>
                <option value="">— Select institute —</option>
                {institutes.map(i => <option key={i.id} value={i.id}>{i.name} ({i.city})</option>)}
              </select>
              <select value={planPurpose} onChange={e => setPlanPurpose(e.target.value)}>
                <option value="">— Select purpose —</option>
                {purposes.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <button type="button" className="btn" onClick={addToPlanAndSelect} style={{ background: COLORS.teal, color: "#fff", padding: "8px 10px", fontSize: 12 }}>Add & select</button>
            </div>
          )}
        </Card>
      )}

      <Card>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label>Activity</label>
            <select value={activity} onChange={e => { setActivity(e.target.value); setLifecycleStatus("Done"); setLinkedDailyId(""); setInstituteId(""); }}>
              {ACTIVITIES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>

          {activity !== "meeting" && (
            <div>
              <label>Institute (must be registered)</label>
              <select value={instituteId} onChange={e => setInstituteId(e.target.value)}>
                <option value="">— Select —</option>
                {institutes.map(i => <option key={i.id} value={i.id}>{i.name} ({i.city})</option>)}
              </select>
              {institutes.length === 0 && <div style={{ fontSize: 11.5, marginTop: 4, color: COLORS.rust }}>No institutes registered yet — go to Institutes tab first.</div>}
            </div>
          )}
          {activity === "meeting" && instituteId && (
            <div style={{ fontSize: 12.5, background: COLORS.tealBg, color: COLORS.teal, padding: "7px 10px", borderRadius: 8 }}>
              Completing: <b>{institutes.find(i => i.id === instituteId)?.name}</b>
            </div>
          )}

          {act.lifecycle && (
            <div>
              <label>Status</label>
              <select value={lifecycleStatus} onChange={e => setLifecycleStatus(e.target.value)}>
                <option value="Set">Set (pending — closes later)</option>
                <option value="Done">Done (already happened)</option>
              </select>
            </div>
          )}
          {act.lifecycle && lifecycleStatus === "Set" && (
            <div><label>Expected date</label><input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} /></div>
          )}

          <div>
            <label>Geo-tag</label>
            <button type="button" className="btn" onClick={captureLocation} style={{ width: "100%", background: geoStatus === "done" ? COLORS.tealBg : "#fff", border: `1px solid ${COLORS.line}`, padding: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Navigation size={14} />
              {geoStatus === "done" ? `Captured (${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)})` : geoStatus === "locating" ? "Locating…" : geoStatus === "denied" ? "Denied — tap to retry" : "Capture current location"}
            </button>
          </div>
          <div>
            <label>Photo</label>
            <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} />
            {photo && <img src={photo} alt="preview" style={{ marginTop: 8, borderRadius: 8, maxWidth: "100%", maxHeight: 160 }} />}
          </div>
          <div><label>Notes</label><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></div>

          {instituteId && (
            <>
              <div>
                <label>Update institute status (optional)</label>
                <select value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                  <option value="">No change</option>
                  {INSTITUTE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {!followUpHidden && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label>Follow-up date {followUpRequired ? "(required)" : "(optional)"}</label>
                    <input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} />
                  </div>
                  <div>
                    <label>Follow-up time (optional)</label>
                    <input type="time" value={followUpTime} onChange={e => setFollowUpTime(e.target.value)} />
                  </div>
                </div>
              )}
              {followUpHidden && (
                <div style={{ fontSize: 11.5, opacity: 0.55 }}>No separate follow-up needed — the Expected date above already covers this.</div>
              )}
            </>
          )}

          {error && <div style={{ color: COLORS.rust, fontSize: 12.5, fontWeight: 600 }}>{error}</div>}
          <button className="btn" type="submit" style={{ background: COLORS.teal, color: "#fff", padding: 12, fontSize: 14 }}>Save visit</button>
          <div style={{ fontSize: 11, opacity: 0.5 }}>Recorded by {me} · {new Date().toLocaleString()}</div>
        </form>
      </Card>
    </div>
  );
}

function Pending({ visits, saveVisits, institutes }) {
  const pending = visits.filter(v => v.lifecycleStatus === "Set").sort((a, b) => new Date(a.date) - new Date(b.date));
  const [closing, setClosing] = useState(null);
  const [form, setForm] = useState({ studentsAttended: "", sessionTopic: "", facultyPresent: "", facultyCount: "" });

  function instName(id) { return institutes.find(i => i.id === id)?.name || "Unknown"; }
  function close(e) {
    e.preventDefault();
    saveVisits(visits.map(v => v.id === closing.id ? { ...v, lifecycleStatus: "Done", closedAt: todayISO(), ...form } : v));
    setClosing(null);
    setForm({ studentsAttended: "", sessionTopic: "", facultyPresent: "", facultyCount: "" });
  }

  return (
    <div>
      <SectionTitle>Open loops</SectionTitle>
      {pending.length === 0 ? <Card style={{ opacity: 0.6, fontSize: 13, textAlign: "center" }}>Nothing pending.</Card> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pending.map(v => {
            const age = Math.floor((new Date(todayISO()) - new Date(v.date)) / 86400000);
            return (
              <Card key={v.id} style={{ borderLeft: `4px solid ${age > 0 ? COLORS.rust : COLORS.gold}` }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{instName(v.instituteId)}</div>
                <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 6 }}>{ACT_MAP[v.activity].label} · {v.member} · expected {new Date(v.date).toLocaleDateString()}</div>
                <button className="btn" onClick={() => setClosing(v)} style={{ background: COLORS.teal, color: "#fff", padding: "6px 10px", fontSize: 11 }}>Mark done & add summary</button>
              </Card>
            );
          })}
        </div>
      )}
      {closing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(28,43,57,0.45)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={() => setClosing(null)}>
          <form onClick={e => e.stopPropagation()} onSubmit={close} style={{ background: COLORS.cream, width: "100%", maxWidth: 480, margin: "0 auto", maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16 }}>Completion summary — {instName(closing.instituteId)}</div>
            <div><label>Students attended</label><input type="text" inputMode="numeric" value={form.studentsAttended} onChange={e => setForm({ ...form, studentsAttended: digitsOnly(e.target.value) })} /></div>
            <div><label>Session / topic taken</label><input value={form.sessionTopic} onChange={e => setForm({ ...form, sessionTopic: e.target.value })} /></div>
            <div><label>Other faculty present</label><input value={form.facultyPresent} onChange={e => setForm({ ...form, facultyPresent: e.target.value })} /></div>
            <div><label>Number of other faculty</label><input type="text" inputMode="numeric" value={form.facultyCount} onChange={e => setForm({ ...form, facultyCount: digitsOnly(e.target.value) })} /></div>
            <button className="btn" type="submit" style={{ background: COLORS.teal, color: "#fff", padding: 12 }}>Close loop</button>
          </form>
        </div>
      )}
    </div>
  );
}

function Targets({ me, members, addMember, institutes, dailyTargets, saveDaily, weeklyTargets, saveWeekly, visits, setTab, purposes }) {
  const [sub, setSub] = useState("daily");
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn" onClick={() => setSub("daily")} style={{ flex: 1, padding: 8, fontSize: 12, background: sub === "daily" ? COLORS.teal : "#fff", color: sub === "daily" ? "#fff" : COLORS.ink, border: `1px solid ${COLORS.line}` }}>Daily</button>
        <button className="btn" onClick={() => setSub("weekly")} style={{ flex: 1, padding: 8, fontSize: 12, background: sub === "weekly" ? COLORS.teal : "#fff", color: sub === "weekly" ? "#fff" : COLORS.ink, border: `1px solid ${COLORS.line}` }}>Weekly</button>
      </div>
      {sub === "daily" ? <DailyTab me={me} institutes={institutes} dailyTargets={dailyTargets} saveDaily={saveDaily} setTab={setTab} purposes={purposes} /> : <WeeklyTab me={me} weeklyTargets={weeklyTargets} saveWeekly={saveWeekly} dailyTargets={dailyTargets} visits={visits} />}
    </div>
  );
}

// Each row here is one planned visit for the day: a registered institute + purpose.
// Completion (with geo/photo/status) now happens in Log Visit, not here — this stays the planning list.
function DailyTab({ me, institutes, dailyTargets, saveDaily, setTab, purposes }) {
  const date = todayISO();
  const [instituteId, setInstituteId] = useState("");
  const [purpose, setPurpose] = useState(purposes[0] || "");
  const [error, setError] = useState("");
  const rows = dailyTargets.filter(d => d.date === date && d.member === me);

  function addPlannedVisit() {
    if (!instituteId) { setError("Pick a registered institute for this planned visit."); return; }
    if (!purpose) { setError("Pick a purpose for this visit."); return; }
    setError("");
    const entry = { id: uid(), member: me, date, instituteId, purpose, meetingsActual: null, followUpDate: null };
    saveDaily([entry, ...dailyTargets]);
    setInstituteId("");
  }

  return (
    <div>
      <Card style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15 }}>Add a planned visit</div>
        <div>
          <label>Institute (registered schools only)</label>
          <select value={instituteId} onChange={e => setInstituteId(e.target.value)}>
            <option value="">— Select —</option>
            {institutes.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {institutes.length === 0 && <div style={{ fontSize: 11.5, marginTop: 4, color: COLORS.rust }}>No institutes registered yet — add one in the Institutes tab first.</div>}
        </div>
        <div>
          <label>Purpose of meeting</label>
          <select value={purpose} onChange={e => setPurpose(e.target.value)}>
            <option value="">— Select —</option>
            {purposes.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {purposes.length === 0 && <div style={{ fontSize: 11.5, marginTop: 4, color: COLORS.rust }}>No purpose options set up yet — ask your admin to add some in Settings.</div>}
        </div>
        {error && <div style={{ color: COLORS.rust, fontSize: 12 }}>{error}</div>}
        <button className="btn" onClick={addPlannedVisit} style={{ background: COLORS.teal, color: "#fff", padding: 11 }}>Add to today's plan</button>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15 }}>Today's planned visits</div>
        <div style={{ background: COLORS.tealBg, color: COLORS.teal, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>{rows.length} planned</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(r => (
          <Card key={r.id}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{institutes.find(i => i.id === r.instituteId)?.name || "Unknown"}</div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>{r.purpose}</div>
            {r.meetingsActual === null ? (
              <button className="btn" onClick={() => setTab("log")} style={{ background: COLORS.goldBg, color: "#7a5d16", fontSize: 11, padding: "5px 10px" }}>Complete in Log Visit →</button>
            ) : (
              <div style={{ fontSize: 11.5, color: COLORS.teal, fontWeight: 600 }}>✓ Held</div>
            )}
          </Card>
        ))}
        {rows.length === 0 && <Card style={{ opacity: 0.6, fontSize: 13, textAlign: "center" }}>No visits planned yet today.</Card>}
      </div>
    </div>
  );
}

function WeeklyTab({ me, weeklyTargets, saveWeekly, dailyTargets, visits }) {
  const [weekStart, setWeekStart] = useState(weekStartISO(todayISO()));
  const [form, setForm] = useState(Object.fromEntries(WEEKLY_FIELDS.map(f => [f.key, ""])));
  const existing = weeklyTargets.find(w => w.weekStart === weekStart && w.member === me);
  const locked = existing?.locked;

  useEffect(() => {
    setForm(existing ? Object.fromEntries(WEEKLY_FIELDS.map(f => [f.key, String(existing[f.key] ?? "")])) : Object.fromEntries(WEEKLY_FIELDS.map(f => [f.key, ""])));
  }, [weekStart]);

  function save() {
    const entry = { id: existing ? existing.id : uid(), member: me, weekStart, locked: true, submittedAt: new Date().toISOString(), ...Object.fromEntries(WEEKLY_FIELDS.map(f => [f.key, Number(form[f.key]) || 0])) };
    const next = existing ? weeklyTargets.map(w => w.id === existing.id ? entry : w) : [...weeklyTargets, entry];
    saveWeekly(next);
  }

  // Meetings achieved comes from daily commitment ("mark as held" entries) for this week.
  // The other parameters come from what's actually been logged in the Visit Log for this week.
  function achieved(key) {
    if (key === "meetings") {
      return dailyTargets.filter(d => d.member === me && weekStartISO(d.date) === weekStart && d.meetingsActual !== null).length;
    }
    const map = {
      sessionsSet: v => v.activity === "session" && v.lifecycleStatus === "Set",
      sessionsDone: v => v.activity === "session" && v.lifecycleStatus === "Done",
      campusVisitsSet: v => v.activity === "campusVisit" && v.lifecycleStatus === "Set",
      campusVisitsDone: v => v.activity === "campusVisit" && v.lifecycleStatus === "Done",
      olympiad: v => v.activity === "olympiad",
      application: v => v.activity === "application",
      admission: v => v.activity === "admission",
    };
    return visits.filter(v => v.member === me && weekStartISO(v.date) === weekStart && map[key](v)).length;
  }

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <label>Week</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" className="btn" onClick={() => setWeekStart(shiftWeek(weekStart, -1))} style={{ background: "#fff", border: `1px solid ${COLORS.line}`, padding: "8px 10px" }}>‹</button>
          <div style={{ flex: 1, textAlign: "center", background: COLORS.tealBg, color: COLORS.teal, borderRadius: 8, padding: "8px 6px", fontWeight: 700, fontSize: 13 }}>
            {fmtShort(weekStart)} – {fmtShort(weekEndISO(weekStart))}
          </div>
          <button type="button" className="btn" onClick={() => setWeekStart(shiftWeek(weekStart, 1))} style={{ background: "#fff", border: `1px solid ${COLORS.line}`, padding: "8px 10px" }}>›</button>
        </div>
        <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 4, textAlign: "center" }}>Monday to Saturday</div>
      </div>

      {locked && (
        <div style={{ background: COLORS.goldBg, color: "#7a5d16", fontSize: 12, padding: "8px 12px", borderRadius: 8 }}>
          Submitted {new Date(existing.submittedAt).toLocaleString()} — this commitment is locked and can't be edited. Contact your admin if it needs to change.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {WEEKLY_FIELDS.map(f => {
          const target = Number(form[f.key]) || 0;
          const ach = achieved(f.key);
          const pct = target > 0 ? (ach / target) * 100 : 0;
          return (
            <div key={f.key}>
              <label>{f.label}</label>
              <input type="text" inputMode="numeric" value={form[f.key]} disabled={locked} onChange={e => setForm({ ...form, [f.key]: digitsOnly(e.target.value) })} style={locked ? { background: "#f4f0e6", opacity: 0.75 } : undefined} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginTop: 3, opacity: 0.7 }}>
                <span>Achieved: {ach}</span>
                <span style={{ color: pct >= 100 ? COLORS.teal : pct >= 50 ? "#a67e1e" : COLORS.rust, fontWeight: 700 }}>{target > 0 ? `${Math.round(pct)}%` : "—"}</span>
              </div>
              <Bar pct={pct} color={pct >= 100 ? COLORS.teal : pct >= 50 ? COLORS.gold : COLORS.rust} />
            </div>
          );
        })}
      </div>
      {!locked && <button className="btn" onClick={save} style={{ background: COLORS.teal, color: "#fff", padding: 12 }}>Submit commitment (final)</button>}
    </Card>
  );
}

