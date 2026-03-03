/* ═══════════════════════════════════════════════════════
   ⚙️  CONFIG
═══════════════════════════════════════════════════════ */
const CONFIG = {
  supabaseUrl:  "https://supabase-proxy.aswinram40011.workers.dev/",
  supabaseKey:  "sb_publishable_QDbEbRxszCMK_bRpfKhjmQ_tzFKjXrK",
  adminPass:    "cricket1982"
};

const IS_CONFIGURED = CONFIG.supabaseUrl !== "YOUR_SUPABASE_URL";

const saveGroqKey = (key) => { localStorage.setItem('GROQ_API_KEY', key); alert("Key saved locally!"); };
const getGroqKey  = () => localStorage.getItem('GROQ_API_KEY');

/* ═══════════════════════════════════════════════════════
   SUPABASE REST HELPERS
═══════════════════════════════════════════════════════ */
const SB = {
  hdrs(extra={}) {
    return { "apikey": CONFIG.supabaseKey, "Authorization": `Bearer ${CONFIG.supabaseKey}`, "Content-Type": "application/json", ...extra };
  },
  async getAll() {
    const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/matches?select=*&order=created_at.desc`, { headers: SB.hdrs() });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).map(row => ({ id: row.id, ...row.data }));
  },
  async upsert(match) {
    const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/matches`, { method:"POST", headers: SB.hdrs({ "Prefer":"resolution=merge-duplicates,return=minimal" }), body: JSON.stringify({ id: match.id, data: match }) });
    if (!r.ok) throw new Error(await r.text());
  },
  async remove(id) {
    const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/matches?id=eq.${id}`, { method:"DELETE", headers: SB.hdrs() });
    if (!r.ok) throw new Error(await r.text());
  }
};

/* ═══════════════════════════════════════════════════════
   APP STATE
═══════════════════════════════════════════════════════ */
const S = {
  page: "home", matchId: null,
  isAdmin: false, loading: true,
  matches: [],
  playTab: "batting", sortField: "bat_runs", sortDir: "desc", search: "",
  innTabs: {},
  // NEW
  pcSort: "overall_rating", pcTypeFilter: "all",
  compareP1: "", compareP2: ""
};

let REVIEW = null, REVIEW_TAB = 0, REVIEW_INN_TABS = {};

/* ═══════════════════════════════════════════════════════
   CHART REGISTRY
═══════════════════════════════════════════════════════ */
const CHARTS = {};
const _chartQ = {};

function destroyChart(id) {
  if (CHARTS[id]) { try { CHARTS[id].destroy(); } catch(e){} delete CHARTS[id]; }
}
function scheduleChart(id, config) { _chartQ[id] = config; }
function flushCharts() {
  const entries = Object.entries(_chartQ);
  if (!entries.length) return;
  setTimeout(() => {
    entries.forEach(([id, cfg]) => {
      try {
        const el = document.getElementById(id);
        if (el) { destroyChart(id); CHARTS[id] = new Chart(el, cfg); }
      } catch(e) { console.warn('Chart init failed:', id, e); }
      delete _chartQ[id];
    });
  }, 90);
}

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
const nid    = () => Math.random().toString(36).slice(2, 10);
const esc    = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const fmtOv  = v => { if(v==null)return"0.0"; const n=parseFloat(v),f=Math.floor(n),b=Math.round((n-f)*10);return`${f}.${b}`; };
const ovDec  = v => { if(!v)return 0;const[o,b="0"]=String(v).split(".");return parseInt(o)+parseInt(b)/6; };
const decOv  = d => { const f=Math.floor(d),b=Math.round((d-f)*6);return`${f}.${b}`; };
const fmtDate= d => { if(!d)return""; try{return new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}catch(e){return d;} };
const clamp  = (v,min,max) => Math.max(min, Math.min(max, v));
const norm   = (v,min,max) => max<=min ? 0 : clamp((v-min)/(max-min),0,1);
const initials = name => String(name||"?").trim().split(/\s+/).map(w=>w[0]?.toUpperCase()||"").slice(0,2).join("");

const CHART_DEFAULTS = {
  grid: 'rgba(255,255,255,0.05)',
  ticks: '#6b7280',
  legend: '#9ca3af',
  font: { family: "'DM Sans', sans-serif", size: 11 }
};

function parseDism(txt="") {
  const t=txt.trim().toLowerCase();
  if(!t||t==="not out"||t==="did not bat")return{type:"not_out",bowler:null,fielder:null};
  if(t.startsWith("b "))return{type:"bowled",bowler:txt.slice(2).trim(),fielder:null};
  if(t.startsWith("lbw")){const bw=txt.replace(/lbw\s*(b\s*)?/i,"").trim();return{type:"lbw",bowler:bw||null,fielder:null};}
  if(t.startsWith("hit wicket")){const bw=txt.replace(/hit wicket\s*(b\s*)?/i,"").trim();return{type:"hit_wicket",bowler:bw||null,fielder:null};}
  if(t.startsWith("run out")){const f=(txt.match(/\(([^)]+)\)/)||[])[1]||null;return{type:"run_out",bowler:null,fielder:f};}
  if(t.startsWith("st ")){const rest=txt.slice(3);const p=rest.split(/\s+b\s+/i);return{type:"stumped",fielder:p[0]?.trim()||null,bowler:p[1]?.trim()||null};}
  if(/^c\s*(&|and)\s*b\s*/i.test(t)){const bw=txt.replace(/c\s*(&|and)\s*b\s*/i,"").trim();return{type:"caught",fielder:bw,bowler:bw};}
  if(t.startsWith("c ")){const rest=txt.slice(2);const p=rest.split(/\s+b\s+/i);return{type:"caught",fielder:p[0]?.trim()||null,bowler:p[1]?.trim()||null};}
  return{type:"unknown",bowler:null,fielder:null};
}
const DL={bowled:"b",caught:"c",stumped:"st",run_out:"ro",lbw:"lbw",hit_wicket:"hw",not_out:"no",unknown:"?"};
const DC={bowled:"dt-b",caught:"dt-c",stumped:"dt-st",run_out:"dt-ro",lbw:"dt-lbw",hit_wicket:"dt-hw",not_out:"dt-no",unknown:"dt-no"};

/* ═══════════════════════════════════════════════════════
   COMPUTE STATS
═══════════════════════════════════════════════════════ */
function computeStats(matches) {
  const pl = {};
  const g = name => {
    if (!pl[name]) pl[name] = {
      name, mids: new Set(),
      bi:0, bno:0, br:0, bb:0, b4:0, b6:0, bhs:0, bhsno:false,
      wbl:0, wm:0, wr:0, ww:0, fc:0, fro:0, fst:0,
      wt:{ bowled:0, caught:0, lbw:0, stumped:0, hit_wicket:0 }
    };
    return pl[name];
  };

  for (const m of matches) {
    for (const inn of (m.innings||[])) {
      for (const b of (inn.batting||[])) {
        if (!b.name) continue;
        const dText = (b.dismissalText||"").toLowerCase();
        const hasBatted = (b.balls>0||b.runs>0||(dText!==""&&dText!=="did not bat"));
        if (hasBatted) {
          const p = g(b.name);
          p.mids.add(m.id);
          const isNotOut = (b.dismissalType==="not_out"||dText==="not out"||dText==="retired hurt");
          p.bi++;
          if (isNotOut) p.bno++;
          p.br += +b.runs||0; p.bb += +b.balls||0;
          p.b4 += +b.fours||0; p.b6 += +b.sixes||0;
          const cr = +b.runs||0;
          if (cr>p.bhs){p.bhs=cr;p.bhsno=isNotOut;}
          else if (cr===p.bhs&&isNotOut){p.bhsno=true;}
        }
      }
      for (const bw of (inn.bowling||[])) {
        if (!bw.name) continue;
        const p = g(bw.name);
        p.mids.add(m.id);
        p.wbl += Math.round(ovDec(bw.overs)*6);
        p.wm  += +bw.maidens||0;
        p.wr  += +bw.runs||0;
        p.ww  += +bw.wickets||0;
      }
      for (const b of (inn.batting||[])) {
        const {type,fielder,bowler} = parseDism(b.dismissalText||"");
        if (type==="caught"&&fielder){const p=g(fielder);p.mids.add(m.id);p.fc++;}
        if (type==="stumped"&&fielder){const p=g(fielder);p.mids.add(m.id);p.fst++;}
        if (type==="run_out"&&fielder){const p=g(fielder);p.mids.add(m.id);p.fro++;}
        if (bowler&&["bowled","caught","lbw","stumped","hit_wicket"].includes(type)){
          const p=g(bowler);p.mids.add(m.id);
          if(p.wt[type]!==undefined)p.wt[type]++;
        }
      }
    }
  }

  return Object.values(pl).map(p => {
    const od = p.wbl/6;
    const dis = p.bi-p.bno;
    return {
      ...p,
      matches: p.mids.size,
      bat_runs:p.br, bat_balls:p.bb, bat_innings:p.bi, bat_notout:p.bno,
      bat_4s:p.b4, bat_6s:p.b6, bat_hs:p.bhs, bat_hs_no:p.bhsno,
      bowl_wkts:p.ww, bowl_runs:p.wr, bowl_maidens:p.wm, bowl_balls:p.wbl,
      field_catches:p.fc, field_runouts:p.fro, field_stumpings:p.fst, wkt_types:p.wt,
      bat_avg:  dis>0 ? p.br/dis : (p.bi>0?p.br:null),
      bat_sr:   p.bb>0 ? (p.br/p.bb)*100 : null,
      bowl_overs: decOv(od),
      bowl_econ:  od>0 ? p.wr/od : null,
      bowl_avg:   p.ww>0 ? p.wr/p.ww : null,
      bowl_sr:    p.ww>0 ? p.wbl/p.ww : null
    };
  });
}

/* ═══════════════════════════════════════════════════════
   ★ Gravity Norm 
═══════════════════════════════════════════════════════ */
const gravityNorm = (val, elite, k = 2.5) => {
  if (val <= 0) return 0;
  // This formula creates a steep climb initially (40-60) 
  // and flattens out significantly as it approaches 100 (Elite)
  const score = 1 - Math.exp(-k * (val / elite));
  return clamp(score, 0, 1);
};

/**
 * Volume Scorer: Rewards total counts (runs/wickets) with diminishing returns.
 * Ensures 20 wickets in 25 matches is valued for volume, 
 * but 15 in 17 wins on "per match" impact.
 */
const volumeScore = (val, target) => {
  if (val <= 0) return 0;
  return Math.log10(val + 1) / Math.log10(target + 1);
};

/* ═══════════════════════════════════════════════════════
   ★ FIXED COMPUTE RATINGS (Corrected Logic)
═══════════════════════════════════════════════════════ */
function computeRatings(stats) {
  const pl = stats.filter(p => p.matches > 0 && /^[a-zA-Z]/.test(p.name.trim()));
  if (!pl.length) return [];

  return pl.map(p => {
    /* ─── BATTING RATING (Weights total 100%) ─── */
    let batScore = 0;
    if (p.bat_innings > 0) {
      // Efficiency (70%): Hard to reach 20 Avg / 150 SR
      const avgN = gravityNorm(p.bat_avg || 0, 20); 
      const srN  = gravityNorm(p.bat_sr || 0, 125);
      const bndPct = p.bat_runs > 0 ? (p.bat_4s * 4 + p.bat_6s * 6) / p.bat_runs : 0;

      // Consistency/Volume (30%): Rewards total runs and innings
      const volN = (volumeScore(p.bat_runs, 500) * 0.7) + (volumeScore(p.bat_innings, 25) * 0.3);

      batScore = (avgN * 30) + (srN * 30) + (bndPct * 10) + (volN * 30);
    }

/* ─── BOWLING RATING (Weights total 100%) ─── */
let bowlScore = 0;
if (p.bowl_balls > 0) {
  // 1. Total Wickets (Volume/Consistency) - 20%
  // Using volumeScore ensures 20 wkts > 15 wkts here
  const wN = volumeScore(p.bowl_wkts, 40); 

  // 2. Economy (Inverted) - 18%
  // Target: 4.5 is elite, 12 is baseline
  const econInv = 1 - gravityNorm(p.bowl_econ || 12, 4.5, 1.2); 

  // 3. Bowling Average (Inverted) - 17%
  // Target: 15 is elite, 90 is baseline
  const avgInv = 1 - gravityNorm(p.bowl_avg || 90, 25, 1.2);

  // 4. Strike Rate (Inverted) - 17%
  // Target: 12 is elite, 35 is baseline
  const srInv = 1 - gravityNorm(p.bowl_sr || 35, 15, 1.2);

  // 5. Wickets Per Match (Primary Impact) - 30%
  // Target: 1.2 wickets per match is elite
  const wpm = p.matches > 0 ? p.bowl_wkts / p.matches : 0;
  const wpmN = gravityNorm(wpm, 0.8);

  // 6. Maidens Per Match - 5%
  const mpm = p.matches > 0 ? p.bowl_maidens / p.matches : 0;
  const mpmN = gravityNorm(mpm, 0.5);

  // Combine using your exact weightage
  bowlScore = (
    wN * 50 + 
    econInv * 20 + 
    avgInv * 15 + 
    srInv * 15 + 
    mpmN * 5 + 
    wpmN * 25
  );
}

    /* ─── FIELDING RATING (Weights total 100%) ─── */
    // Impact (60%) + Volume (40%)
    const dpm = (p.field_catches + p.field_runouts + p.field_stumpings) / p.matches;
    const dpmN = gravityNorm(dpm, 0.8); // 0.8 dismissals per match is elite
    const volN = volumeScore(p.field_catches + p.field_runouts + p.field_stumpings, 20);

    const fieldScore = (dpmN * 60) + (volN * 40);

   /* ─── CALCULATE IMPACTS ─── */
    // Batting Impact: Scaling Strike Rate
    const batImpact = (p.bat_sr || 0) / 10;

    // Bowling Impact: Wickets Per Over (Wkts / (Balls/6))
    const oversBowled = (p.bowl_balls || 0) / 6;
    const wpo = oversBowled > 0 ? (p.bowl_wkts / oversBowled) : 0;
    const bowlImpact = wpo * 10; 

    /* ─── NEW TAGGING LOGIC ─── */
    let tags = [];
    const sr = p.bat_sr || 0;
    const avg = p.bat_avg || 0;
    const econ = p.bowl_econ || 99;

    // Batting Tags (Can satisfy both)
    if (p.bat_innings >= 1) {
      if (sr > 120) tags.push("Hitter");
      if (avg > 15) tags.push("Consistent");
    }

    // Bowling Tags (Can satisfy both)
    if (p.bowl_balls >= 12) {
      if (wpo > 0.7) tags.push("Strike Bowler");
      if (econ < 4) tags.push("Economical Bowler");
    }

    // Optional: All-Rounder fallback if they do both but met no elite criteria
    if (tags.length === 0 && p.bat_innings >= 1 && p.bowl_balls >= 12) {
      tags.push("All-Rounder");
    }

    // Join tags with a comma for display, or leave empty if no conditions met
    const tagDisplay = tags.length > 0 ? tags.join(", ") : "";

    const overall = Math.round(batScore * 0.5 + bowlScore * 0.5);

    return { 
      ...p, 
      bat_rating: Math.round(batScore * 10) / 10, 
      bowl_rating: Math.round(bowlScore * 10) / 10, 
      bat_impact: Math.round(batImpact * 10) / 10,
      bowl_impact: Math.round(bowlImpact * 10) / 10,
      overall_rating: Math.round(overall),
      player_tag: tagDisplay // Now returns "Hitter, Consistent" or "" 
    };
  });
}


/* ═══════════════════════════════════════════════════════
   ★ UPDATED RADAR HELPERS
═══════════════════════════════════════════════════════ */
function getBatRadarData(p, allStats) {
  const allRuns = allStats.map(player => player.bat_runs || 0);
  const maxRunsOverall = Math.max(...allRuns, 1);
  // 1. Average (Benchmark 45)
  const avgN = norm(p.bat_avg || 0, 0, 20) * 100;
  // 2. Strike Rate (Benchmark 180)
  const srN  = norm(p.bat_sr || 0, 0, 180) * 100;
  // 3. High Score (Benchmark 80)
  const hsN  = norm(p.bat_hs || 0, 0, 80) * 100;
  // 4. Total Runs (Benchmark 300 - adjusts based on your season length)
  const runsN = norm(p.bat_runs || 0, 0, maxRunsOverall) * 100;
  // 5. Boundary % (Benchmark 25% of balls being boundaries)
  // Logic: (4s + 6s) / Balls Faced * 100
  const foursPerInn = p.bat_innings-p.bno > 0 ? (p.bat_4s || 0) / (p.bat_innings-p.bno) : 0;
  const fourN = norm(foursPerInn, 0, 1.3) * 100;

  // 6. Sixes per Innings (Benchmark 1.5 sixes per match)
  const sixesPerInn = p.bat_innings-p.bno > 0 ? (p.bat_6s || 0) / (p.bat_innings-p.bno) : 0;
  const sixN = norm(sixesPerInn, 0, 1.3) * 100;

  return [avgN, srN, hsN, runsN, fourN, sixN].map(v => Math.round(clamp(v, 5, 100)));
}

function getBowlRadarData(p, allStats) {
  const maxWktsOverall = Math.max(...allStats.map(x => x.bowl_wkts || 0), 1);
  // 1. Wickets (Total Volume - Benchmark 20)
  const wktN = norm(p.bowl_wkts || 0, 0, maxWktsOverall) * 100;
  // 2. Economy (Lower is better - Bench: 4.0 to 10.0)
  const econN = (1 - norm(p.bowl_econ || 10, 4, 10)) * 100;
  // 3. Average (Lower is better - Bench: 15 to 45)
  const avgN = (1 - norm(p.bowl_avg || 45, 15, 45)) * 100;
  // 4. Strike Rate (Lower is better - Bench: 12 to 30)
  const srN = (1 - norm(p.bowl_sr || 30, 12, 30)) * 100;
  // 5. Maidens per Match (Benchmark 0.5)
  const mpm = p.matches > 0 ? (p.bowl_maidens || 0) / p.matches : 0;
  const mdnN = norm(mpm, 0, 0.1) * 100;
  // 6. Normalized Wickets Per Match (Benchmark 2.0 per match is elite)
  const wpm = p.matches > 0 ? (p.bowl_wkts || 0) / p.matches : 0;
  const wpmN = norm(wpm, 0, 1.0) * 100;

  return [wktN, econN, avgN, srN, mdnN, wpmN].map(v => Math.round(clamp(v, 5, 100)));
}


/* ═══════════════════════════════════════════════════════
   ★ GET PLAYER MATCH HISTORY (NEW)
═══════════════════════════════════════════════════════ */
function getPlayerHistory(name, matches) {
  const map = {};
  const ordered = [...matches].reverse(); // oldest first
  for (const m of ordered) {
    const mid = m.id;
    if (!map[mid]) map[mid] = { matchId:mid, label:`${m.team1} vs ${m.team2}`.slice(0,18), date:m.date, bat_runs:null, bat_balls:null, bowl_wkts:0, bowl_runs:0 };
    for (const inn of (m.innings||[])) {
      const bat = (inn.batting||[]).find(b=>b.name===name);
      if (bat) {
        const dt = (bat.dismissalText||"").toLowerCase();
        const hasBatted = (bat.balls>0||bat.runs>0||(dt&&dt!=="did not bat"));
        if (hasBatted) { map[mid].bat_runs = bat.runs||0; map[mid].bat_balls = bat.balls||0; }
      }
      const bowl = (inn.bowling||[]).find(b=>b.name===name);
      if (bowl) { map[mid].bowl_wkts += bowl.wickets||0; map[mid].bowl_runs += bowl.runs||0; }
    }
  }
  return Object.values(map);
}


function getFieldRadarData(p, allStats) {
  const maxC  = Math.max(...allStats.map(x=>x.field_catches||0), 1);
  const maxRO = Math.max(...allStats.map(x=>x.field_runouts||0), 1);
  const maxSt = Math.max(...allStats.map(x=>x.field_stumpings||0), 1);
  const total = p.field_catches + p.field_runouts + p.field_stumpings;
  const dpm   = p.matches > 0 ? total/p.matches : 0;
  return [
    norm(p.field_catches||0, 0, maxC)*100,
    norm(p.field_runouts||0, 0, maxRO)*100,
    norm(p.field_stumpings||0, 0, maxSt)*100,
    norm(dpm, 0, 3)*100,
    norm(total, 0, Math.max(maxC+maxRO+maxSt,1))*100
  ].map(v => Math.round(clamp(v,0,100)));
}

/* ═══════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════ */
let _tt;
function toast(msg){const el=document.getElementById("toast");el.textContent=msg;el.classList.add("show");clearTimeout(_tt);_tt=setTimeout(()=>el.classList.remove("show"),3000);}

/* ═══════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════ */
function nav(page,matchId=null){S.page=page;S.matchId=matchId;render();window.scrollTo({top:0,behavior:"smooth"});}
window.nav=nav;

window.toggleEdit = async () => {
  if (S.isEditing) {
    const m = S.matches.find(x => x.id === S.matchId);
    if (!m) return;
    try {
      await SB.upsert(m); 
      toast("✅ Match updated successfully!");
      S.isEditing = false;
      // Re-load data to ensure ratings/stats are re-calculated
      await loadData(); 
    } catch (e) {
      toast("❌ Save failed: " + e.message);
      return;
    }
  } else {
    S.isEditing = true;
    renderMain();
  }
};

/* ═══════════════════════════════════════════════════════
   LOAD DATA FROM SUPABASE
═══════════════════════════════════════════════════════ */
async function loadData(){
  if(!IS_CONFIGURED){S.loading=false;render();return;}
  try{S.matches=await SB.getAll();}catch(e){console.error("Load failed:",e);}
  S.loading=false;render();
}

/* ═══════════════════════════════════════════════════════
   RENDER NAV (updated)
═══════════════════════════════════════════════════════ */
function renderNav(){
  const p=S.page,a=S.isAdmin;
  document.getElementById("nav-links").innerHTML=`
    <button class="nav-btn ${p==="home"?"active":""}" onclick="nav('home')">Home</button>
    <button class="nav-btn ${p==="matches"?"active":""}" onclick="nav('matches')">Matches</button>
    <button class="nav-btn ${p==="players"?"active":""}" onclick="nav('players')">Stats</button>
    <button class="nav-btn ${p==="playercards"?"active":""}" onclick="nav('playercards')">Players</button>
    <button class="nav-btn ${p==="compare"?"active":""}" onclick="nav('compare')">Compare</button>
    ${a?`<button class="nav-btn ${p==="upload"?"active":""}" onclick="nav('upload')">Upload</button>`:""}
    ${a?`<button class="nav-btn danger" onclick="doLogout()">🔓 Logout</button>`:`<button class="nav-btn cta" onclick="showLoginModal()">Admin</button>`}
  `;
}

/* ═══════════════════════════════════════════════════════
   SETUP SCREEN
═══════════════════════════════════════════════════════ */
function renderSetup(){
  return `<div class="setup">
    <div style="font-size:3rem;margin-bottom:16px">🏏</div>
    <h2>Welcome to CricStat</h2>
    <p>Connect a Supabase backend to get started.</p>
    <div class="setup-steps">
      <h4>🔧 One-Time Setup</h4>
      <div class="step"><div class="step-num">1</div><div class="step-txt">Go to <strong>supabase.com</strong>, create a free account and a new project.</div></div>
      <div class="step"><div class="step-num">2</div><div class="step-txt">Run this SQL in the SQL Editor:
        <div class="sql-block">CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read"   ON matches FOR SELECT USING (true);
CREATE POLICY "public_insert" ON matches FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update" ON matches FOR UPDATE USING (true);
CREATE POLICY "public_delete" ON matches FOR DELETE USING (true);</div>
      </div></div>
      <div class="step"><div class="step-num">3</div><div class="step-txt">Go to <strong>Project Settings → API</strong> and copy your URL and anon key.</div></div>
      <div class="step"><div class="step-num">4</div><div class="step-txt">Paste into the <strong>CONFIG</strong> block in <code>js/script.js</code>.</div></div>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════
   HOME PAGE (updated with new glimpse)
═══════════════════════════════════════════════════════ */
function renderHome(){
  if(!IS_CONFIGURED) return renderSetup();
  const stats   = computeStats(S.matches);
  const ratings = computeRatings(stats);
  const topBat  = [...stats].sort((a,b)=>b.bat_runs-a.bat_runs)[0];
  const topBowl = [...stats].filter(p=>p.bowl_wkts>0).sort((a,b)=>b.bowl_wkts-a.bowl_wkts)[0];
  const recent  = [...S.matches].slice(0,3);
  const npl     = stats.filter(p=>p.matches>0).length;

  // Top 3 rated players for glimpse
  const top3 = [...ratings].sort((a,b)=>b.overall_rating-a.overall_rating).slice(0,3);

  const top3Html = top3.length ? top3.map(p=>`
    <div class="home-pc-mini" onclick="nav('playercards')">
      <div class="home-pc-av">${initials(p.name)}</div>
      <div class="home-pc-info">
        <div class="home-pc-name">${esc(p.name)}</div>
        <div class="home-pc-ovr">⭐ ${p.overall_rating} Overall</div>
      </div>
    </div>`).join("") : `<p style="color:var(--muted);font-size:.82rem">No player data yet.</p>`;

return `
    <div class="hero">
      <div class="hero-glow"></div><div class="hero-ring"></div>
      <div class="hero-title">CRIC&nbsp;<span class="acc">STAT</span></div>
      <div class="hero-sub">Local cricket. Proper stats. Every match, every run, every wicket.</div>
      <div class="hero-btns">
        <button class="btn btn-orange" onclick="nav('matches')">View Matches</button>
        <button class="btn btn-sky" onclick="nav('players')">Player Stats</button>
      </div>
    </div>
    <div class="page" style="padding-top:32px">

      <div class="sg">
        <div class="sc" onclick="nav('players')" style="cursor:pointer"><div class="sn">${S.matches.length}</div><div class="sl">Matches</div></div>
        <div class="sc" onclick="nav('players')" style="cursor:pointer"><div class="sn">${npl}</div><div class="sl">Players</div></div>
        <div class="sc" onclick="nav('players')" style="cursor:pointer"><div class="sn">${topBat?.bat_runs||"—"}</div><div class="sl">Top Runs${topBat?" · "+esc(topBat.name):""}</div></div>
        <div class="sc" onclick="nav('players')" style="cursor:pointer"><div class="sn">${topBowl?.bowl_wkts||"—"}</div><div class="sl">Top Wickets${topBowl?" · "+esc(topBowl.name):""}</div></div>
        <div class="sc" onclick="nav('compare')" style="cursor:pointer"><div class="sn" style="font-size:1.2rem">Compare</div><div class="sl">Head-to-Head</div></div>
      </div>

      <!-- TOP RATED PLAYERS -->
      <div style="margin-top:36px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div class="sec-title" style="margin-bottom:0">🃏 Top Rated Players</div>
          <button class="btn btn-outline btn-sm" onclick="nav('playercards')" style="font-size:.75rem">View All →</button>
        </div>
        <p class="sec-sub" style="margin-bottom:14px">Based on batting, bowling &amp; fielding performance</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
          ${top3.length ? top3.map((p, idx) => {
            const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
            const barW = Math.max(10, p.overall_rating);
            const barColor = "var(--orange)";
            return `
            <div onclick="nav('playercards')" style="cursor:pointer;background:var(--bg3);border:1px solid var(--border);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;transition:border-color .2s,transform .15s;position:relative;overflow:hidden"
              onmouseover="this.style.borderColor='${barColor}';this.style.transform='translateY(-2px)'"
              onmouseout="this.style.borderColor='var(--border)';this.style.transform='translateY(0)'">
              <div style="position:absolute;top:0;left:0;width:4px;height:100%;background:${barColor};border-radius:4px 0 0 4px"></div>
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:42px;height:42px;border-radius:50%;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.95rem;color:var(--text);flex-shrink:0;border:2px solid ${barColor}">${initials(p.name)}</div>
                <div style="min-width:0">
                  <div style="font-weight:700;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</div>
                  <div style="font-size:.72rem;color:var(--muted);margin-top:2px">${medal} Rank #${idx+1}</div>
                </div>
              </div>
              <div>
                <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted);margin-bottom:5px">
                  <span>Overall Rating</span><span style="color:${barColor};font-weight:700">${p.overall_rating}</span>
                </div>
                <div style="height:5px;background:var(--bg4);border-radius:99px;overflow:hidden">
                  <div style="height:100%;width:${barW}%;background:${barColor};border-radius:99px;transition:width .6s ease"></div>
                </div>
              </div>
              <div style="display:flex;gap:8px;font-size:.72rem">
                <span style="background:var(--bg4);padding:3px 8px;border-radius:6px;color:var(--text2)">🏏 ${p.bat_rating ?? "—"}</span>
                <span style="background:var(--bg4);padding:3px 8px;border-radius:6px;color:var(--text2)">🎳 ${p.bowl_rating ?? "—"}</span>
              </div>
            </div>`;
          }).join("") : `<p style="color:var(--muted);font-size:.85rem;padding:12px 0">No player data yet.</p>`}
        </div>
      </div>

      <!-- EXPLORE -->
      <div style="margin-top:36px">
        <div class="sec-title" style="margin-bottom:4px">✨ Explore</div>
        <p class="sec-sub" style="margin-bottom:14px">Dive deeper into the stats</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
          ${[
            { icon:"🃏", title:"Player Cards",    sub:"Ratings, types & full profiles with charts",   page:"playercards", color:"var(--orange)" },
            { icon:"⚖️", title:"Player Compare",  sub:"Head-to-head radar chart comparison",           page:"compare",     color:"var(--sky)" },
            { icon:"📊", title:"Match Analysis",  sub:"Over-by-over charts & run progression",         page:"matches",     color:"var(--orange)" }
          ].map(c => `
          <div onclick="nav('${c.page}')" style="cursor:pointer;background:var(--bg3);border:1px solid var(--border);border-radius:14px;padding:18px 20px;display:flex;align-items:center;gap:16px;transition:border-color .2s,transform .15s"
            onmouseover="this.style.borderColor='${c.color}';this.style.transform='translateY(-2px)'"
            onmouseout="this.style.borderColor='var(--border)';this.style.transform='translateY(0)'">
            <div style="font-size:1.8rem;flex-shrink:0;width:44px;height:44px;background:var(--bg4);border-radius:12px;display:flex;align-items:center;justify-content:center">${c.icon}</div>
            <div>
              <div style="font-weight:700;font-size:.9rem;margin-bottom:3px">${c.title}</div>
              <div style="font-size:.75rem;color:var(--muted);line-height:1.4">${c.sub}</div>
            </div>
          </div>`).join("")}
        </div>
      </div>

      <!-- RECENT MATCHES -->
      ${recent.length ? `
      <div style="margin-top:36px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="sec-title" style="margin-bottom:0">🕐 Recent Matches</div>
          <button class="btn btn-outline btn-sm" onclick="nav('matches')" style="font-size:.75rem">All Matches →</button>
        </div>
        <div class="ml">${recent.map(m=>matchCardHtml(m,false)).join("")}</div>
      </div>` : ""}

    </div>`;
}

/* ═══════════════════════════════════════════════════════
   MATCH CARD
═══════════════════════════════════════════════════════ */
function matchCardHtml(m,del=false){
  const i1=m.innings?.[0],i2=m.innings?.[1];
  return `<div class="mc" onclick="nav('match','${m.id}')">
    <div>
      <div class="m-team">${esc(m.team1)} <span style="color:var(--muted);font-size:.7em;font-style:italic">vs</span> ${esc(m.team2)}</div>
      <div class="m-res">${esc(m.result)}</div>
      ${m.date?`<div class="m-date">${fmtDate(m.date)}${m.venue?" · "+esc(m.venue):""}</div>`:""}
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <div class="mscores">
        ${i1?`<div class="msb"><div class="s1">${esc(i1.team)}: ${i1.total}/${i1.wickets}</div><div class="s2">(${fmtOv(i1.overs)} ov)</div></div>`:""}
        ${i2?`<div class="msb"><div class="s1">${esc(i2.team)}: ${i2.total}/${i2.wickets}</div><div class="s2">(${fmtOv(i2.overs)} ov)</div></div>`:""}
      </div>
      ${del&&S.isAdmin?`<button class="btn btn-danger btn-sm" onclick="delMatch(event,'${m.id}')">✕</button>`:""}
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════
   MATCHES PAGE
═══════════════════════════════════════════════════════ */
function renderMatches(){
  if(!S.matches.length) return `<div class="page"><div class="empty"><div class="ei">🏟️</div>No matches yet. ${S.isAdmin?"Upload a scorecard to get started!":"Ask the admin to add matches."}</div></div>`;
  return `<div class="page">
    <div class="sec-title">🏆 All Matches</div>
    <p class="sec-sub">${S.matches.length} match${S.matches.length!==1?"es":""} played</p>
    <div class="ml">${S.matches.map(m=>matchCardHtml(m,true)).join("")}</div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════
   INNINGS TABLE HTML (Updated: Removed Tabs & FOW)
═══════════════════════════════════════════════════════ */
function innTableHtml(inn, innIdx, activeTab, editable) {
  // We force a check on the global state here
  const isEditing = S.isEditing;

  // --- BATTING SECTION ---
  const batRows = (inn.batting || []).map((b, i) => {
    const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0";
    
    // If Editing is active, we MUST return <input> tags
    if (isEditing) {
      return `<tr>
        <td><input class="edit-in" value="${esc(b.name)}" onchange="rvBat(${innIdx},${i},'name',this.value)"></td>
        <td><input class="edit-in" style="min-width:140px" value="${esc(b.dismissalText || '')}" onchange="rvBat(${innIdx},${i},'dismissalText',this.value)"></td>
        <td class="r"><input class="edit-in r" type="number" style="width:60px" value="${b.runs||0}" onchange="rvBat(${innIdx},${i},'runs',+this.value)"></td>
        <td class="r"><input class="edit-in r" type="number" style="width:60px" value="${b.balls||0}" onchange="rvBat(${innIdx},${i},'balls',+this.value)"></td>
        <td class="r"><input class="edit-in r" type="number" style="width:50px" value="${b.fours||0}" onchange="rvBat(${innIdx},${i},'fours',+this.value)"></td>
        <td class="r"><input class="edit-in r" type="number" style="width:50px" value="${b.sixes||0}" onchange="rvBat(${innIdx},${i},'sixes',+this.value)"></td>
        <td class="r tm">${sr}</td>
      </tr>`;
    }

    // Default View
    return `<tr>
      <td class="tb">${esc(b.name)}</td>
      <td class="tsm" style="color:var(--text3); font-style:italic;">${esc(b.dismissalText || "not out")}</td>
      <td class="r tb" style="color:var(--orange); font-size:1.05rem;">${b.runs || 0}</td>
      <td class="r">${b.balls || 0}</td><td class="r">${b.fours || 0}</td><td class="r">${b.sixes || 0}</td>
      <td class="r tm">${sr}</td>
    </tr>`;
  }).join("");

  // --- BOWLING SECTION ---
  const bowlRows = (inn.bowling || []).map((b, i) => {
    const er = (b.runs / (ovDec(b.overs) || 1)).toFixed(2);
    
    if (isEditing) {
      return `<tr>
        <td><input class="edit-in" value="${esc(b.name)}" onchange="rvBowl(${innIdx},${i},'name',this.value)"></td>
        <td class="r"><input class="edit-in r" style="width:60px" value="${b.overs||''}" onchange="rvBowl(${innIdx},${i},'overs',this.value)"></td>
        <td class="r"><input class="edit-in r" type="number" style="width:50px" value="${b.maidens||0}" onchange="rvBowl(${innIdx},${i},'maidens',+this.value)"></td>
        <td class="r"><input class="edit-in r" type="number" style="width:60px" value="${b.runs||0}" onchange="rvBowl(${innIdx},${i},'runs',+this.value)"></td>
        <td class="r"><input class="edit-in r" type="number" style="width:50px" value="${b.wickets||0}" onchange="rvBowl(${innIdx},${i},'wickets',+this.value)"></td>
        <td class="r tm">${er}</td>
      </tr>`;
    }

    return `<tr>
      <td class="tb">${esc(b.name)}</td>
      <td class="r">${fmtOv(b.overs)}</td><td class="r">${b.maidens || 0}</td>
      <td class="r">${b.runs || 0}</td><td class="r tb" style="color:var(--sky); font-size:1.05rem;">${b.wickets || 0}</td>
      <td class="r tm">${er}</td>
    </tr>`;
  }).join("");

  return `
    <div class="stats-section batting-bg" style="margin-bottom:24px; border-radius:8px; overflow:hidden; border:1px solid rgba(249,115,22,0.1);">
      <div style="background:linear-gradient(90deg, rgba(249,115,22,0.15) 0%, transparent 100%); padding:10px 15px; border-bottom:1px solid rgba(249,115,22,0.2); display:flex; justify-content:space-between; align-items:center;">
        <span style="color:var(--orange); font-weight:800; font-size:0.85rem; letter-spacing:1px;">🏏 BATTING</span>
        <span style="font-size:0.7rem; color:var(--text3);">Extras: ${inn.extras?.total || 0}</span>
      </div>
      <div style="padding:0 8px;"><table class="tbl">
          <thead><tr><th>Batsman</th><th>Status</th><th class="r">R</th><th class="r">B</th><th class="r">4s</th><th class="r">6s</th><th class="r">SR</th></tr></thead>
          <tbody>${batRows}</tbody>
      </table></div>
    </div>
    <div class="stats-section bowling-bg" style="border-radius:8px; overflow:hidden; border:1px solid rgba(56,189,248,0.1);">
      <div style="background:linear-gradient(90deg, rgba(56,189,248,0.15) 0%, transparent 100%); padding:10px 15px; border-bottom:1px solid rgba(56,189,248,0.2);">
        <span style="color:var(--sky); font-weight:800; font-size:0.85rem; letter-spacing:1px;">🥎 BOWLING</span>
      </div>
      <div style="padding:0 8px;"><table class="tbl">
          <thead><tr><th>Bowler</th><th class="r">O</th><th class="r">M</th><th class="r">R</th><th class="r">W</th><th class="r">ER</th></tr></thead>
          <tbody>${bowlRows}</tbody>
      </table></div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   ★ MATCH DETAIL (updated with over charts)
═══════════════════════════════════════════════════════ */
function renderMatchDetail() {
  const m = S.matches.find(x => x.id === S.matchId);
  if (!m) return `<div class="page"><div class="empty"><div class="ei">❌</div>Match not found.</div></div>`;

  const colors = ['#f97316', '#38bdf8', '#22c55e', '#a855f7'];

  // 1. Chart IDs
  const rpo1Id = `rpo-left-${m.id}`;
  const rpo2Id = `rpo-right-${m.id}`;
  const progressionId = `cumul-center-${m.id}`;

  // 2. Analysis Charts (TOP)
  const chartsLayoutHtml = `
    <div class="match-analysis-row" style="display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap;">
      <div class="chart-col" style="flex: 1; min-width: 180px; background: var(--bg3); padding: 10px; border-radius: var(--r); border: 1px solid var(--border);">
        <div style="font-size: 0.65rem; color: var(--orange); margin-bottom: 6px; text-align: center; font-weight: bold;">${esc(m.team1)} RPO</div>
        <div style="height: 140px;"><canvas id="${rpo1Id}"></canvas></div>
      </div>
      <div class="chart-col" style="flex: 2; min-width: 280px; background: var(--bg3); padding: 10px; border-radius: var(--r); border: 1px solid var(--border);">
        <div style="font-size: 0.65rem; color: var(--text2); margin-bottom: 6px; text-align: center; font-weight: bold;">RUN PROGRESSION</div>
        <div style="height: 140px;"><canvas id="${progressionId}"></canvas></div>
      </div>
      <div class="chart-col" style="flex: 1; min-width: 180px; background: var(--bg3); padding: 10px; border-radius: var(--r); border: 1px solid var(--border);">
        <div style="font-size: 0.65rem; color: var(--sky); margin-bottom: 6px; text-align: center; font-weight: bold;">${esc(m.team2)} RPO</div>
        <div style="height: 140px;"><canvas id="${rpo2Id}"></canvas></div>
      </div>
    </div>`;

  // 3. Innings Tables (No Tabs)
  const innsH = (m.innings || []).map((inn, i) => `
    <div class="card mb4">
      <div class="inn-hd">
        <div class="inn-team">${esc(inn.team)}</div>
        <div>
          <span class="inn-score">${inn.total}/${inn.wickets}</span>
          <span class="inn-rr">(${fmtOv(inn.overs)} ov)</span>
        </div>
      </div>
      <div class="re" style="padding:16px 12px">
        ${innTableHtml(inn, i, null, false)}
      </div>
    </div>`).join("");

  setTimeout(() => {
    scheduleMatchCharts(m, colors);
    flushCharts();
  }, 50);

  return `
  <div class="page">
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:15px">
      <button class="btn btn-outline btn-sm" onclick="nav('matches')">← Back</button>
      ${S.isAdmin ? `<button class="btn btn-sky btn-sm" onclick="showEditModal('${m.id}')">✏️ Edit</button>` : ""}
    </div>
    
    <div class="mdh">
      <div class="mdt"><span class="to2">${esc(m.team1)}</span><span class="vs">vs</span><span class="to2">${esc(m.team2)}</span></div>
      <span class="badge bo">${esc(m.result)}</span>
    </div>

    ${chartsLayoutHtml}
    ${innsH}
  </div>`;
}




window.mdTab=(innIdx,tab)=>{const m=S.matches.find(x=>x.id===S.matchId);if(!m)return;S.innTabs[`${m.id}-${innIdx}`]=tab;renderMain();};

/* ═══════════════════════════════════════════════════════
   ★ SCHEDULE MATCH OVER CHARTS (NEW)
═══════════════════════════════════════════════════════ */
function scheduleMatchCharts(m, colors) {
  if (!m.innings || m.innings.length === 0) return;

  const rpo1Id = `rpo-left-${m.id}`;
  const rpo2Id = `rpo-right-${m.id}`;
  const progressionId = `cumul-center-${m.id}`;

  // Helper to extract data from bowling records
  // We now also extract the bowler names to use in the tooltips
  const getOverRuns = (inn) => (inn.bowling || []).map(b => b.runs || 0);
  const getOverWickets = (inn) => (inn.bowling || []).map(b => b.wickets || 0);
  const getBowlerNames = (inn) => (inn.bowling || []).map(b => b.name || "Unknown");

  // 1. LEFT COLUMN: Team 1 RPO (Bars) + Wickets (Dots)
  if (m.innings[0]) {
    const runs = getOverRuns(m.innings[0]);
    const wkts = getOverWickets(m.innings[0]);
    const bowlers = getBowlerNames(m.innings[0]);

    scheduleChart(rpo1Id, {
      type: 'bar',
      data: {
        labels: runs.map((_, i) => i + 1),
        datasets: [
          {
            label: 'Runs',
            data: runs,
            backgroundColor: 'rgba(249,115,22,0.65)',
            borderColor: '#f97316',
            borderWidth: 1,
            borderRadius: 3,
            order: 2,
            // Custom property to store bowler names for tooltip access
            bowlerList: bowlers 
          },
          {
            label: 'Wickets',
            data: wkts.map((w, i) => w > 0 ? runs[i] : null),
            type: 'scatter',
            backgroundColor: '#ef4444',
            pointRadius: 4,
            pointStyle: 'circle',
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (ctx) => `Over ${ctx[0].label}`,
              label: (ctx) => {
                // If hovering over the scatter point, we skip or handle differently
                // Here we focus on the Bar dataset (index 0 in 'order' logic can vary, check datasetIndex)
                const bowler = ctx.dataset.bowlerList ? ctx.dataset.bowlerList[ctx.dataIndex] : "";
                const val = ctx.raw;
                if (ctx.dataset.label === 'Wickets') return `Wicket Fallen!`;
                return [`Runs: ${val}`, `Bowler: ${bowler}`];
              }
            }
          }
        },
        scales: {
          x: { display: false },
          y: { beginAtZero: true, ticks: { color: CHART_DEFAULTS.ticks, font: { size: 9 } }, grid: { color: CHART_DEFAULTS.grid } }
        }
      }
    });
  }

  // 2. RIGHT COLUMN: Team 2 RPO (Bars) + Wickets (Dots)
  if (m.innings[1]) {
    const runs = getOverRuns(m.innings[1]);
    const wkts = getOverWickets(m.innings[1]);
    const bowlers = getBowlerNames(m.innings[1]);

    scheduleChart(rpo2Id, {
      type: 'bar',
      data: {
        labels: runs.map((_, i) => i + 1),
        datasets: [
          {
            label: 'Runs',
            data: runs,
            backgroundColor: 'rgba(56,189,248,0.65)',
            borderColor: '#38bdf8',
            borderWidth: 1,
            borderRadius: 3,
            order: 2,
            bowlerList: bowlers
          },
          {
            label: 'Wickets',
            data: wkts.map((w, i) => w > 0 ? runs[i] : null),
            type: 'scatter',
            backgroundColor: '#ef4444',
            pointRadius: 4,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (ctx) => `Over ${ctx[0].label}`,
              label: (ctx) => {
                const bowler = ctx.dataset.bowlerList ? ctx.dataset.bowlerList[ctx.dataIndex] : "";
                if (ctx.dataset.label === 'Wickets') return `Wicket Fallen!`;
                return [`Runs: ${ctx.raw}`, `Bowler: ${bowler}`];
              }
            }
          }
        },
        scales: {
          x: { display: false },
          y: { beginAtZero: true, ticks: { color: CHART_DEFAULTS.ticks, font: { size: 9 } }, grid: { color: CHART_DEFAULTS.grid } }
        }
      }
    });
  }

  // 3. CENTER COLUMN: Cumulative Progression
  const r1 = getOverRuns(m.innings[0] || {});
  const w1 = getOverWickets(m.innings[0] || {});
  const b1 = getBowlerNames(m.innings[0] || {});
  
  const r2 = getOverRuns(m.innings[1] || {});
  const w2 = getOverWickets(m.innings[1] || {});
  const b2 = getBowlerNames(m.innings[1] || {});
  
  const maxLen = Math.max(r1.length, r2.length);
  
  let c1 = 0, c2 = 0;
  const cum1 = r1.map(r => (c1 += r, c1));
  const cum2 = r2.map(r => (c2 += r, c2));

  scheduleChart(progressionId, {
    type: 'line',
    data: {
      labels: Array.from({ length: maxLen }, (_, i) => i + 1),
      datasets: [
        {
          label: esc(m.innings[0]?.team || 'Inn 1'),
          data: cum1,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249,115,22,0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: w1.map(w => w > 0 ? 4 : 0),
          pointBackgroundColor: '#ef4444',
          pointBorderColor: '#fff',
          pointBorderWidth: 1,
          bowlerList: b1
        },
        {
          label: esc(m.innings[1]?.team || 'Inn 2'),
          data: cum2,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: w2.map(w => w > 0 ? 4 : 0),
          pointBackgroundColor: '#ef4444',
          pointBorderColor: '#fff',
          pointBorderWidth: 1,
          bowlerList: b2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { 
          callbacks: { 
            title: ctx => `After Over ${ctx[0].dataIndex + 1}`,
            label: (ctx) => {
              const innIdx = ctx.datasetIndex;
              const ovIdx = ctx.dataIndex;
              const wkts = innIdx === 0 ? w1[ovIdx] : w2[ovIdx];
              const bowler = innIdx === 0 ? b1[ovIdx] : b2[ovIdx];
              
              let out = `${ctx.dataset.label}: ${ctx.parsed.y} (Bowler: ${bowler})`;
              if (wkts > 0) out += ` — ${wkts} Wkt!`;
              return out;
            }
          } 
        }
      },
      scales: {
        x: { ticks: { color: CHART_DEFAULTS.ticks, font: { size: 9 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: CHART_DEFAULTS.ticks, font: { size: 9 } }, grid: { color: CHART_DEFAULTS.grid } }
      }
    }
  });
}
/* ═══════════════════════════════════════════════════════
   PLAYERS PAGE (existing stats tables — unchanged)
═══════════════════════════════════════════════════════ */
function renderPlayers() {
  const all = computeStats(S.matches);
  const tab = S.playTab, sf = S.sortField, sd = S.sortDir, q = S.search.toLowerCase();
  const filtered = all.filter(p => p.matches>0 && p.name.toLowerCase().includes(q) && /^[a-zA-Z]/.test(p.name.trim()));
  const isInv = ["bowl_avg","bowl_econ","bowl_sr"].includes(sf);
  const sorted = [...filtered].sort((a,b)=>{
    let va=a[sf],vb=b[sf];
    if(sf==="name"){const na=String(va||"").trim(),nb=String(vb||"").trim();return sd==="asc"?na.localeCompare(nb):nb.localeCompare(na);}
    if(va==null&&vb==null)return 0;if(va==null)return 1;if(vb==null)return-1;
    return isInv?(sd==="asc"?vb-va:va-vb):(sd==="asc"?va-vb:vb-va);
  });
  const SC=f=>sf===f?"to":"";
  const SH=(f,l,r=true)=>`<th class="${r?"r":""} ${sf===f?"sorted":""}" onclick="plSort('${f}')">${l}<span class="sort-icon">${sf===f?(sd==="asc"?"▲":"▼"):"↕"}</span></th>`;
  let tbl="";
  if(tab==="batting"){
    tbl=`<div class="tw"><table class="tbl"><thead><tr><th style="width:40px">Rank</th>${SH("name","Player",false)}${SH("matches","M")}${SH("bat_innings","Inn")}${SH("bat_notout","NO")}${SH("bat_runs","Runs")}${SH("bat_balls","Balls")}${SH("bat_hs","HS")}${SH("bat_avg","Avg")}${SH("bat_sr","SR")}${SH("bat_4s","4s")}${SH("bat_6s","6s")}</tr></thead>
    <tbody>${sorted.map((p,i)=>`<tr><td class="r" style="color:var(--muted);font-size:.85em">${i+1}</td><td class="tb ${SC("name")}" style="cursor:pointer;color:var(--orange)" onclick="showPlayerProfile('${esc(p.name)}')">${esc(p.name)}</td><td class="r ${SC("matches")}">${p.matches}</td><td class="r ${SC("bat_innings")}">${p.bat_innings}</td><td class="r tm ${SC("bat_notout")}">${p.bat_notout}</td><td class="r ${SC("bat_runs")}">${p.bat_runs}</td><td class="r ${SC("bat_balls")}">${p.bat_balls}</td><td class="r ${SC("bat_hs")}">${p.bat_hs}${p.bat_hs_no?"*":""}</td><td class="r ${SC("bat_avg")}">${p.bat_avg!=null?p.bat_avg.toFixed(2):"-"}</td><td class="r ${SC("bat_sr")}">${p.bat_sr!=null?p.bat_sr.toFixed(1):"-"}</td><td class="r ${SC("bat_4s")}">${p.bat_4s}</td><td class="r ${SC("bat_6s")}">${p.bat_6s}</td></tr>`).join("")}</tbody></table></div>`;
  }
  if(tab==="bowling"){
    const bp=sorted.filter(p=>p.bowl_balls>0);
    tbl=`<div class="tw"><table class="tbl"><thead><tr><th style="width:40px">Rank</th>${SH("name","Player",false)}${SH("matches","M")}<th>Ov</th>${SH("bowl_maidens","M")}${SH("bowl_runs","R")}${SH("bowl_wkts","W")}${SH("bowl_avg","Avg")}${SH("bowl_econ","Econ")}${SH("bowl_sr","SR")}<th class="c"><span class="dt dt-b">b</span></th><th class="c"><span class="dt dt-c">c</span></th><th class="c"><span class="dt dt-lbw">lbw</span></th><th class="c"><span class="dt dt-st">st</span></th><th class="c"><span class="dt dt-hw">hw</span></th></tr></thead>
    <tbody>${bp.map((p,i)=>`<tr><td class="r" style="color:var(--muted);font-size:.85em">${i+1}</td><td class="tb ${SC("name")}" style="cursor:pointer;color:var(--orange)" onclick="showPlayerProfile('${esc(p.name)}')">${esc(p.name)}</td><td class="r ${SC("matches")}">${p.matches}</td><td class="r">${p.bowl_overs}</td><td class="r ${SC("bowl_maidens")}">${p.bowl_maidens}</td><td class="r ${SC("bowl_runs")}">${p.bowl_runs}</td><td class="r ${SC("bowl_wkts")}">${p.bowl_wkts}</td><td class="r ${SC("bowl_avg")}">${p.bowl_avg!=null?p.bowl_avg.toFixed(2):"-"}</td><td class="r ${SC("bowl_econ")}">${p.bowl_econ!=null?p.bowl_econ.toFixed(2):"-"}</td><td class="r ${SC("bowl_sr")}">${p.bowl_sr!=null?p.bowl_sr.toFixed(1):"-"}</td><td class="c">${p.wkt_types.bowled||0}</td><td class="c">${p.wkt_types.caught||0}</td><td class="c">${p.wkt_types.lbw||0}</td><td class="c">${p.wkt_types.stumped||0}</td><td class="c">${p.wkt_types.hit_wicket||0}</td></tr>`).join("")||`<tr><td colspan="15" style="text-align:center;padding:24px;color:var(--muted)">No bowling data</td></tr>`}</tbody></table></div>`;
  }
  if(tab==="fielding"){
    tbl=`<div class="tw"><table class="tbl"><thead><tr><th style="width:40px">Rank</th>${SH("name","Player",false)}${SH("matches","M")}${SH("field_catches","Catches")}${SH("field_runouts","Run Outs")}${SH("field_stumpings","Stumpings")}</tr></thead>
    <tbody>${sorted.map((p,i)=>`<tr><td class="r" style="color:var(--muted);font-size:.85em">${i+1}</td><td class="tb ${SC("name")}" style="cursor:pointer;color:var(--orange)" onclick="showPlayerProfile('${esc(p.name)}')">${esc(p.name)}</td><td class="r ${SC("matches")}">${p.matches}</td><td class="r ${SC("field_catches")}">${p.field_catches}</td><td class="r ${SC("field_runouts")}">${p.field_runouts}</td><td class="r ${SC("field_stumpings")}">${p.field_stumpings}</td></tr>`).join("")}</tbody></table></div>`;
  }
  return `<div class="page">
    <div class="fb mb4">
      <div><div class="sec-title">👤 Player Statistics</div><p class="sec-sub">${filtered.length} players</p></div>
      <div style="display:flex;gap:8px">
        <input class="fi" id="psearch" placeholder="Search player…" value="${esc(S.search)}" style="max-width:200px" autocomplete="off" onkeydown="if(event.key==='Enter')plSearchExec()"/>
        <button class="btn btn-p btn-orange" onclick="plSearchExec()" style="padding:0 16px">Search</button>
      </div>
    </div>
    <div class="tabs">
      <button class="tab ${tab==="batting"?"active":""}" onclick="plTab('batting')">Batting</button>
      <button class="tab ${tab==="bowling"?"active":""}" onclick="plTab('bowling')">Bowling</button>
      <button class="tab ${tab==="fielding"?"active":""}" onclick="plTab('fielding')">Fielding</button>
    </div>
    <div class="card">${tbl}</div>
  </div>`;
}

window.plSort=(f)=>{if(S.sortField===f)S.sortDir=S.sortDir==="asc"?"desc":"asc";else{S.sortField=f;S.sortDir="desc";}render();};
window.plTab=(t)=>{S.playTab=t;S.sortField=t==="batting"?"bat_runs":t==="bowling"?"bowl_wkts":"field_catches";S.sortDir="desc";render();};
window.plSearchExec=()=>{S.search=document.getElementById("psearch").value;render();};

/* ═══════════════════════════════════════════════════════
   ★ PLAYER CARDS PAGE (NEW)
═══════════════════════════════════════════════════════ */
function renderPlayerCards() {
  if (!S.matches.length) return `<div class="page"><div class="empty"><div class="ei">🃏</div>No match data yet.</div></div>`;
  
  const stats = computeStats(S.matches);
  const ratings = computeRatings(stats);
  
  if (!ratings.length) return `<div class="page"><div class="empty"><div class="ei">🃏</div>No players found.</div></div>`;

  // 1. Collect all unique Player Types (Original Logic)
  const allBatTypes = [...new Set(ratings.map(p => p.bat_type).filter(Boolean))];
  const allBowlTypes = [...new Set(ratings.map(p => p.bowl_type).filter(Boolean))];

  // 2. Collect all unique Performance Tags (New Logic)
  // We split the comma-separated strings and flatten them into one unique list
  const allPerfTags = [...new Set(ratings.flatMap(p => 
    p.player_tag ? p.player_tag.split(', ').filter(t => t !== "All-Rounder") : []
  ))].map(t => t === "Economical Bowler" ? "Economical" : t);

  // 3. Filter Logic
  let filtered = ratings;
  if (S.pcTypeFilter !== "all") {
    filtered = ratings.filter(p => {
      // Check original types
      const matchType = p.bat_type === S.pcTypeFilter || p.bowl_type === S.pcTypeFilter;
      
      // Check performance tags (handle the Economical renaming)
      const pTags = p.player_tag ? p.player_tag.split(', ') : [];
      const matchPerf = pTags.some(t => {
        const displayT = (t === "Economical Bowler") ? "Economical" : t;
        return displayT === S.pcTypeFilter;
      });

      return matchType || matchPerf;
    });
  }

  // Sort
  const sorted = [...filtered].sort((a, b) => (b[S.pcSort] || 0) - (a[S.pcSort] || 0));

  // Sort Buttons
  const sortBtns = [
    ["overall_rating", "Overall"], ["bat_rating", "Batting"], ["bowl_rating", "Bowling"]
  ].map(([k, l]) => `<button class="pc-sort-btn ${S.pcSort === k ? "active" : ""}" onclick="pcSetSort('${k}')">${l}</button>`).join("");

  // Filter Buttons (Combined Types and Performance Tags)
  const filterTags = [
    ["all", "All"],
    ...allBatTypes.map(t => [t, t]),
    ...allBowlTypes.map(t => [t, t]),
    ...allPerfTags.map(t => [t, t]) // Adds Hitter, Consistent, etc. to the filter row
  ].map(([k, l]) => `<button class="pc-tag-filter ${S.pcTypeFilter === k ? "active" : ""}" onclick="pcSetFilter('${k}')">${l}</button>`).join("");

  const cards = sorted.map(p => playerCardHtml(p)).join("");

  return `<div class="page">
    <div class="fb" style="margin-bottom:8px">
      <div><div class="sec-title">🃏 Player Profiles</div><p class="sec-sub">${sorted.length} of ${ratings.length} players</p></div>
    </div>
    <div class="pc-controls">
      <div class="pc-sort-row">
        <span class="pc-sort-label">Sort:</span>${sortBtns}
      </div>
      <div class="pc-filter-row" style="display:flex; flex-wrap:wrap; gap:4px;">
        <span class="pc-sort-label" style="margin-right:2px">Type:</span>${filterTags}
      </div>
    </div>
    <div class="pc-grid">${cards || `<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--muted)">No players match this filter.</div>`}</div>
  </div>`;
}

function playerCardHtml(p) {
  // 1. Helper to determine text color (Black or White) based on background brightness
  const getContrastColor = (hex) => {
    if (!hex) return '#000000';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // YIQ formula: standard way to check if a color is 'light' or 'dark'
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
  };

  // 2. Define background colors for each specific tag
  const tagSettings = {
    "Hitter":           "#e63946", // Red
    "Consistent":       "#2a9d8f", // Teal/Green
    "Strike Bowler":    "#3c5ae0", // Steel Blue
    "Economical":       "#6a4c93", // Purple
    "Default":          "#e0e0e0"  // Light Gray
  };

  // 3. Process Performance Tags (Filtered to exclude All-Rounder and handle renaming)
  const performanceTagsHtml = p.player_tag 
    ? p.player_tag.split(', ')
        .filter(t => t !== "All-Rounder") // Completely remove All-Rounder tag
        .map(t => {
          // Map "Economical Bowler" to "Economical" for display
          const displayTag = t === "Economical Bowler" ? "Economical" : t;
          const bgColor = tagSettings[displayTag] || tagSettings["Default"];
          const textColor = getContrastColor(bgColor);
          
          return `<span class="tag-perf" style="
            background: ${bgColor}; 
            color: ${textColor}; 
            padding: 3px 10px; 
            border-radius: 6px; 
            font-size: 0.65rem; 
            font-weight: 700; 
            text-transform: uppercase; 
            display: inline-block;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
          ">${esc(displayTag)}</span>`;
        }).join('') 
    : "";

  // 4. Original Type Tags (RHB, RAM, etc.) - Standard Dark Gray
  const typeTagsHtml = [
    p.bat_type  ? `<span class="type-tag" style="background:#333; color:#fff; padding: 3px 8px; border-radius: 4px; font-size: 0.65rem; font-weight: 600;">${esc(p.bat_type)}</span>`  : "",
    p.bowl_type ? `<span class="type-tag" style="background:#333; color:#fff; padding: 3px 8px; border-radius: 4px; font-size: 0.65rem; font-weight: 600;">${esc(p.bowl_type)}</span>` : ""
  ].filter(Boolean).join("");

  const ovrClass = p.overall_rating >= 75 ? 'color:var(--green)' : p.overall_rating >= 50 ? 'color:var(--orange)' : 'color:var(--muted2)';

  return `<div class="pc" onclick="showPlayerProfile('${esc(p.name)}')">
    <div class="pc-head">
      <div class="pc-avatar">${initials(p.name)}</div>
      <div class="pc-info">
        <div class="pc-name">${esc(p.name)}</div>
        <div class="pc-tags" style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; align-items: center;">
          ${typeTagsHtml}${performanceTagsHtml}
        </div>
      </div>
      <div class="pc-ovr">
        <div class="pc-ovr-num" style="${ovrClass}">${p.overall_rating}</div>
        <div class="pc-ovr-label">OVR</div>
      </div>
    </div>
    <div class="pc-ratings">
      <div class="pc-rat-row"><span class="pc-rat-label">BAT</span><div class="pc-rat-track"><div class="pc-rat-fill rat-bat" style="width:${p.bat_rating}%"></div></div><span class="pc-rat-num">${p.bat_rating}</span></div>
      <div class="pc-rat-row"><span class="pc-rat-label">BWL</span><div class="pc-rat-track"><div class="pc-rat-fill rat-bowl" style="width:${p.bowl_rating}%"></div></div><span class="pc-rat-num">${p.bowl_rating}</span></div>
    </div>
    <div class="pc-quick">
      <div class="pc-quick-stat"><div class="pc-qs-val">${p.matches}</div><div class="pc-qs-key">Matches</div></div>
      <div class="pc-quick-stat"><div class="pc-qs-val">${p.bat_runs}</div><div class="pc-qs-key">Runs</div></div>
      <div class="pc-quick-stat"><div class="pc-qs-val">${p.bowl_wkts}</div><div class="pc-qs-key">Wickets</div></div>
      <div class="pc-quick-stat"><div class="pc-qs-val">${p.field_catches}</div><div class="pc-qs-key">Catches</div></div>
    </div>
  </div>`;
}

window.pcSetSort   = k => { S.pcSort = k; renderMain(); };
window.pcSetFilter = k => { S.pcTypeFilter = k; renderMain(); };

/* ═══════════════════════════════════════════════════════
   ★ PLAYER PROFILE MODAL (NEW)
═══════════════════════════════════════════════════════ */
function showPlayerProfile(name) {
  const allStats = computeStats(S.matches);
  const ratings  = computeRatings(allStats);
  const p = ratings.find(x => x.name === name);
  if (!p) return;
  const history = getPlayerHistory(name, S.matches);
  const hasBat   = p.bat_innings > 0;
  const hasBowl  = p.bowl_balls > 0;

  // Helper for formatting decimals
  const f = (v, d = 0) => (v != null && !isNaN(v)) ? v.toFixed(d).replace(/\.0$/, '') : "0";

  const typeTagsHtml = [
    p.bat_type  ? `<span class="type-tag tag-bat">${esc(p.bat_type)}</span>`  : "",
    p.bowl_type ? `<span class="type-tag tag-bowl">${esc(p.bowl_type)}</span>` : ""
  ].filter(Boolean).join("");

  // BATTING SECTION (Left Side)
  const batGrid = `
    <div class="s-item"><div class="s-label">Runs</div><div class="s-val">${p.bat_runs}</div></div>
    <div class="s-item"><div class="s-label">Avg</div><div class="s-val">${f(p.bat_avg, 1)}</div></div>
    <div class="s-item"><div class="s-label">S/R</div><div class="s-val">${f(p.bat_sr, 1)}</div></div>
    <div class="s-item"><div class="s-label">H.S</div><div class="s-val">${p.bat_hs}${p.bat_hs_no?"*":""}</div></div>
    <div class="s-item"><div class="s-label">Inns</div><div class="s-val">${p.bat_innings}</div></div>
    <div class="s-item"><div class="s-label">N.O</div><div class="s-val">${p.bno}</div></div>
    <div class="s-item"><div class="s-label">4s</div><div class="s-val">${p.bat_4s}</div></div>
    <div class="s-item"><div class="s-label">6s</div><div class="s-val">${p.bat_6s}</div></div>
  `;

  // BOWLING SECTION (Right Side)
  const bowlGrid = `
    <div class="s-item"><div class="s-label">Overs</div><div class="s-val">${f(p.bowl_balls / 6, 1)}</div></div>
    <div class="s-item"><div class="s-label">Wkts</div><div class="s-val">${p.bowl_wkts}</div></div>
    <div class="s-item"><div class="s-label">Runs Conceded</div><div class="s-val">${p.bowl_runs}</div></div>
    <div class="s-item"><div class="s-label">Econ</div><div class="s-val">${f(p.bowl_econ, 2)}</div></div>
    <div class="s-item"><div class="s-label">Avg</div><div class="s-val">${f(p.bowl_avg, 1)}</div></div>
    <div class="s-item"><div class="s-label">S/R</div><div class="s-val">${f(p.bowl_sr, 1)}</div></div>
    <div class="s-item"><div class="s-label">Catches</div><div class="s-val">${p.field_catches}</div></div>
    <div class="s-item"><div class="s-label">Run Outs</div><div class="s-val">${(p.field_runouts || 0) + (p.field_stumpings || 0)}</div></div>
  `;

  const batHistId  = `ph-bat-hist-${name.replace(/\s+/g,'-')}`;
  const bowlHistId = `ph-bowl-hist-${name.replace(/\s+/g,'-')}`;
  const batRadId   = `ph-bat-rad-${name.replace(/\s+/g,'-')}`;
  const bowlRadId  = `ph-bowl-rad-${name.replace(/\s+/g,'-')}`;

  document.getElementById("modal-root").innerHTML = `
    <div class="mo" onclick="closeModal()">
      <div class="md md-profile" onclick="event.stopPropagation()" style="max-width:850px">
        <div class="md-head">
          <h3>🏏 Player Profile</h3>
          <button class="btn btn-outline btn-sm" onclick="closeModal()">✕ Close</button>
        </div>
        <div class="md-body">
          <div class="profile-hero" style="display:flex; align-items:center; gap:15px; margin-bottom:20px;">
            <div class="profile-avatar-lg">${initials(p.name)}</div>
            <div>
              <div class="profile-name" style="font-size:1.6rem; font-weight:800; font-family:var(--font-head);">${esc(p.name)}</div>
              <div class="profile-tags">${typeTagsHtml}</div>
            </div>
            <div class="profile-ovr-badge" style="margin-left:auto; text-align:center;">
              <div class="profile-ovr-num" style="font-size:1.8rem; font-weight:800; color:var(--orange);">${p.overall_rating}</div>
              <div class="profile-ovr-label" style="font-size:0.7rem; text-transform:uppercase; color:var(--muted);">Overall</div>
            </div>
          </div>

          <div class="stats-split-layout" style="display:flex; gap:20px; flex-wrap:wrap; margin-bottom:25px;">
            <div class="stats-column" style="flex:1; min-width:300px;">
              <h4 style="font-size:0.8rem; color:var(--orange); margin-bottom:10px; border-bottom:1px solid var(--border); padding-bottom:5px;">BATTING STATS</h4>
              <div class="stats-grid" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:6px;">${batGrid}</div>
            </div>
            <div class="stats-column" style="flex:1; min-width:300px;">
              <h4 style="font-size:0.8rem; color:var(--sky); margin-bottom:10px; border-bottom:1px solid var(--border); padding-bottom:5px;">BOWLING STATS</h4>
              <div class="stats-grid" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:6px;">${bowlGrid}</div>
            </div>
          </div>

          <div class="profile-charts-row">
            <div class="profile-chart-box">
              <h4>🏏 Batting Scores</h4>
              ${hasBat&&history.some(h=>h.bat_runs!==null)?`<canvas id="${batHistId}" height="130"></canvas>`:`<div class="chart-empty">No batting data</div>`}
            </div>
            <div class="profile-chart-box">
              <h4>🎳 Wickets</h4>
              ${hasBowl&&history.some(h=>h.bowl_wkts>0)?`<canvas id="${bowlHistId}" height="130"></canvas>`:`<div class="chart-empty">No bowling data</div>`}
            </div>
          </div>

          <div class="profile-radars-row">
            <div class="profile-chart-box">
              <h4>🕸️ Batting Profile</h4>
              ${hasBat?`<canvas id="${batRadId}" height="210"></canvas>`:`<div class="chart-empty">No batting data</div>`}
            </div>
            <div class="profile-chart-box">
              <h4>🕸️ Bowling Profile</h4>
              ${hasBowl?`<canvas id="${bowlRadId}" height="210"></canvas>`:`<div class="chart-empty">No bowling data</div>`}
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // --- CHARTS LOGIC (UNCHANGED) ---
  const batMatches  = history.filter(h=>h.bat_runs!==null);
  const bowlMatches = history.filter(h=>h.bowl_wkts>0||h.bowl_runs>0);

  if (hasBat && batMatches.length) {
    scheduleChart(batHistId, {
      type:'bar',
      data:{
        labels: batMatches.map(h=>h.label),
        datasets:[{
          label:'Runs', data:batMatches.map(h=>h.bat_runs),
          backgroundColor:'rgba(249,115,22,0.65)', borderColor:'#f97316', borderWidth:1, borderRadius:4
        }]
      },
      options:{
        responsive:true,
        plugins:{ legend:{display:false} },
        scales:{
          x:{ ticks:{ color:CHART_DEFAULTS.ticks, font:{size:9}, maxRotation:50 }, grid:{ color:CHART_DEFAULTS.grid } },
          y:{ ticks:{ color:CHART_DEFAULTS.ticks, font:CHART_DEFAULTS.font }, grid:{ color:CHART_DEFAULTS.grid }, beginAtZero:true }
        }
      }
    });
  }

  if (hasBowl && bowlMatches.length) {
    scheduleChart(bowlHistId, {
      type:'bar',
      data:{
        labels: bowlMatches.map(h=>h.label),
        datasets:[{
          label:'Wickets', data:bowlMatches.map(h=>h.bowl_wkts),
          backgroundColor:'rgba(56,189,248,0.65)', borderColor:'#38bdf8', borderWidth:1, borderRadius:4
        }]
      },
      options:{
        responsive:true,
        plugins:{ legend:{display:false} },
        scales:{
          x:{ ticks:{ color:CHART_DEFAULTS.ticks, font:{size:9}, maxRotation:50 }, grid:{ color:CHART_DEFAULTS.grid } },
          y:{ ticks:{ color:CHART_DEFAULTS.ticks, font:CHART_DEFAULTS.font }, grid:{ color:CHART_DEFAULTS.grid }, beginAtZero:true, ticks:{ stepSize:1 } }
        }
      }
    });
  }

 // --- UPDATED RADAR CHARTS LOGIC (FIXED LABELS & NORMALIZED) ---
  const radarOpts = {
    responsive: true,
    maintainAspectRatio: true, 
    aspectRatio: 1, 
    scales: {
      r: {
        min: 0,
        max: 100,
        beginAtZero: true,
        ticks: { display: false, stepSize: 25 },
        grid: { color: 'rgba(255,255,255,0.12)' },
        angleLines: { color: 'rgba(255,255,255,0.15)' },
        pointLabels: { 
          color: '#cbd5e1', 
          font: { size: 9, weight: '600' },
          padding: 15 // Increased padding to ensure outer labels are visible
        }
      }
    },
    plugins: { 
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `Score: ${ctx.raw.toFixed(1)}/100`
        }
      }
    }
  };

  if (hasBat) {
    const bdVals = getBatRadarData(p, allStats);
    scheduleChart(batRadId, {
      type: 'radar',
      data: { 
        // Ensure labels match the array order in getBatRadarData
        labels: ['Avg', 'SR', 'HS', 'Runs', '4s', '6s'], 
        datasets: [{ 
          label: p.name, 
          data: bdVals, 
          backgroundColor: 'rgba(249,115,22,0.25)', 
          borderColor: '#f97316', 
          borderWidth: 2, 
          pointBackgroundColor: '#f97316', 
          pointRadius: 2
        }] 
      },
      options: radarOpts
    });
  }

  if (hasBowl) {
    const bwVals = getBowlRadarData(p, allStats);
    scheduleChart(bowlRadId, {
      type: 'radar',
      data: { 
        // Normalized W/M included as the 6th point
        labels: ['Wkt', 'Eco', 'Avg', 'SR', 'Mdn', 'W/M'], 
        datasets: [{ 
          label: p.name, 
          data: bwVals, 
          backgroundColor: 'rgba(56,189,248,0.2)', 
          borderColor: '#38bdf8', 
          borderWidth: 2, 
          pointBackgroundColor: '#38bdf8', 
          pointRadius: 2
        }] 
      },
      options: radarOpts
    });
  }

  flushCharts();
}



window.showPlayerProfile = showPlayerProfile;

/* ═══════════════════════════════════════════════════════
   ★ COMPARE PAGE (NEW)
═══════════════════════════════════════════════════════ */
function renderCompare() {
  const stats   = computeStats(S.matches);
  const ratings = computeRatings(stats);
  if (!ratings.length) return `<div class="page"><div class="empty"><div class="ei">⚖️</div>No player data available yet.</div></div>`;

  const playerOptions = ratings.sort((a,b)=>a.name.localeCompare(b.name))
    .map(p=>`<option value="${esc(p.name)}" ${S.compareP1===p.name?"selected":""}>${esc(p.name)}</option>`).join("");
  const playerOptions2 = ratings.sort((a,b)=>a.name.localeCompare(b.name))
    .map(p=>`<option value="${esc(p.name)}" ${S.compareP2===p.name?"selected":""}>${esc(p.name)}</option>`).join("");

  const p1 = ratings.find(x=>x.name===S.compareP1);
  const p2 = ratings.find(x=>x.name===S.compareP2);

  const batRadId  = `cmp-bat-rad`;
  const bowlRadId = `cmp-bowl-rad`;
  const fldRadId  = `cmp-fld-rad`;

  // Stat comparison table
  function statRow(label, v1, v2, higherBetter=true) {
    const n1 = parseFloat(v1), n2 = parseFloat(v2);
    let winner = "";
    if (!isNaN(n1) && !isNaN(n2) && n1!==n2) {
      const p1Wins = higherBetter ? n1>n2 : n1<n2;
      winner = p1Wins ? '<td class="stat-winner">★</td><td></td>' : '<td></td><td class="stat-winner">★</td>';
    } else { winner = '<td></td><td></td>'; }
    return `<tr><td class="stat-label">${label}</td><td class="stat-p1">${v1??"-"}</td>${winner}<td class="stat-p2">${v2??"-"}</td></tr>`;
  }

  const hasBoth = p1 && p2;
  let chartsHtml = "";
  let statTablesHtml = "";

if (hasBoth) {
  const fmt1 = (v, dec=2) => v!=null ? Number(v).toFixed(dec) : "-";

  const radarBase = {
    responsive: true,
    maintainAspectRatio: true,
    scales: { r: { min:0, max:100, ticks:{display:false}, grid:{color:'rgba(255,255,255,0.06)'}, angleLines:{color:'rgba(255,255,255,0.08)'}, pointLabels:{color:CHART_DEFAULTS.legend, font:{size:10}} } },
    plugins: { legend: { labels: { color:CHART_DEFAULTS.legend, font:CHART_DEFAULTS.font, boxWidth:12 } } }
  };

  const ph = `<thead><tr>
    <td class="stat-label"></td>
    <td class="stat-p1">${esc(p1.name.split(' ')[0])}</td>
    <td></td>
    <td class="stat-p2">${esc(p2.name.split(' ')[0])}</td>
  </tr></thead>`;

const row = (chartId, chartTitle, statsTitle, statsBody) => `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;align-items:stretch;min-width:0;overflow:hidden">
    <div class="cmp-chart-box" style="display:flex;flex-direction:column;min-width:0;overflow:hidden">
      <h3>${chartTitle}</h3>
      <canvas id="${chartId}"></canvas>
    </div>
    <div class="cmp-chart-box" style="display:flex;flex-direction:column;min-width:0;overflow:hidden">
      <h3>${statsTitle}</h3>
      <table class="cmp-stat-table">${ph}<tbody>${statsBody}</tbody></table>
    </div>
  </div>`;

  chartsHtml =
    row(batRadId, "🏏 Batting Radar", "🏏 Batting Stats",
      statRow("Matches",     p1.matches,                          p2.matches)           +
      statRow("Innings",     p1.bat_innings,                      p2.bat_innings)       +
      statRow("Runs",        p1.bat_runs,                         p2.bat_runs)          +
      statRow("Average",     fmt1(p1.bat_avg),                    fmt1(p2.bat_avg))     +
      statRow("Strike Rate", fmt1(p1.bat_sr,1),                   fmt1(p2.bat_sr,1))   +
      statRow("High Score",  p1.bat_hs+(p1.bat_hs_no?"*":""),     p2.bat_hs+(p2.bat_hs_no?"*":"")) +
      statRow("Fours",       p1.bat_4s,                           p2.bat_4s)            +
      statRow("Sixes",       p1.bat_6s,                           p2.bat_6s)
    ) +
    row(bowlRadId, "🎳 Bowling Radar", "🎳 Bowling Stats",
      statRow("Wickets",       p1.bowl_wkts,              p2.bowl_wkts)               +
      statRow("Overs",         p1.bowl_overs,             p2.bowl_overs)              +
      statRow("Runs Conceded", p1.bowl_runs,              p2.bowl_runs,        false)  +
      statRow("Average",       fmt1(p1.bowl_avg),         fmt1(p2.bowl_avg),   false)  +
      statRow("Economy",       fmt1(p1.bowl_econ),        fmt1(p2.bowl_econ),  false)  +
      statRow("Strike Rate",   fmt1(p1.bowl_sr,1),        fmt1(p2.bowl_sr,1),  false)  +
      statRow("Maidens",       p1.bowl_maidens,           p2.bowl_maidens)
    ) +
    row(fldRadId, "🧤 Fielding Radar", "🧤 Fielding Stats",
      statRow("Catches",    p1.field_catches,    p2.field_catches)   +
      statRow("Run Outs",   p1.field_runouts,    p2.field_runouts)   +
      statRow("Stumpings",  p1.field_stumpings,  p2.field_stumpings) +
      statRow("Total Disml",
        p1.field_catches+p1.field_runouts+p1.field_stumpings,
        p2.field_catches+p2.field_runouts+p2.field_stumpings)
    );

  statTablesHtml = "";

  scheduleChart(batRadId, {
    type:'radar',
    data:{ labels:['Average','Strike Rate','High Score','Runs','Boundary%','Sixes'],
           datasets:[
             { label:p1.name, data:getBatRadarData(p1,stats), backgroundColor:'rgba(249,115,22,0.2)', borderColor:'#f97316', borderWidth:2, pointBackgroundColor:'#f97316', pointRadius:3 },
             { label:p2.name, data:getBatRadarData(p2,stats), backgroundColor:'rgba(56,189,248,0.15)', borderColor:'#38bdf8', borderWidth:2, pointBackgroundColor:'#38bdf8', pointRadius:3 }
           ]},
    options: radarBase
  });
  scheduleChart(bowlRadId, {
    type:'radar',
    data:{ labels:['Wickets','Economy','Average','Strike Rate','Maidens','W/Match'],
           datasets:[
             { label:p1.name, data:getBowlRadarData(p1,stats), backgroundColor:'rgba(249,115,22,0.2)', borderColor:'#f97316', borderWidth:2, pointBackgroundColor:'#f97316', pointRadius:3 },
             { label:p2.name, data:getBowlRadarData(p2,stats), backgroundColor:'rgba(56,189,248,0.15)', borderColor:'#38bdf8', borderWidth:2, pointBackgroundColor:'#38bdf8', pointRadius:3 }
           ]},
    options: radarBase
  });
  scheduleChart(fldRadId, {
    type:'radar',
    data:{ labels:['Catches','Run Outs','Stumpings','Disml/Match','Total'],
           datasets:[
             { label:p1.name, data:getFieldRadarData(p1,stats), backgroundColor:'rgba(249,115,22,0.2)', borderColor:'#f97316', borderWidth:2, pointBackgroundColor:'#f97316', pointRadius:3 },
             { label:p2.name, data:getFieldRadarData(p2,stats), backgroundColor:'rgba(56,189,248,0.15)', borderColor:'#38bdf8', borderWidth:2, pointBackgroundColor:'#38bdf8', pointRadius:3 }
           ]},
    options: radarBase
  });
  flushCharts();
}

  return `<div class="page">
    <div class="sec-title">⚖️ Player Comparison</div>
    <p class="sec-sub">Select two players to compare their stats head-to-head</p>

    <div class="cmp-selectors">
      <div class="cmp-sel-box">
        <h4 style="color:#f97316">🟠 Player 1</h4>
        <select class="cmp-select" onchange="cmpSetP1(this.value)">
          <option value="">-- Select Player --</option>${playerOptions}
        </select>
        ${p1?`<div class="cmp-player-badge"><div class="cmp-badge-dot" style="background:#f97316"></div><div class="cmp-badge-name" style="color:#f97316">${esc(p1.name)}</div><div style="margin-left:auto;font-family:var(--font-head);color:var(--muted2)">OVR ${p1.overall_rating}</div></div>`:""}
      </div>
      <div class="cmp-sel-box">
        <h4 style="color:#38bdf8">🔵 Player 2</h4>
        <select class="cmp-select" onchange="cmpSetP2(this.value)">
          <option value="">-- Select Player --</option>${playerOptions2}
        </select>
        ${p2?`<div class="cmp-player-badge"><div class="cmp-badge-dot" style="background:#38bdf8"></div><div class="cmp-badge-name" style="color:#38bdf8">${esc(p2.name)}</div><div style="margin-left:auto;font-family:var(--font-head);color:var(--muted2)">OVR ${p2.overall_rating}</div></div>`:""}
      </div>
    </div>

    ${!hasBoth ? `<div class="cmp-no-player"><div style="font-size:2.5rem">⚖️</div><div>Select two players above to see the comparison</div></div>` : ""}
    ${chartsHtml}
  </div>`;
}

window.cmpSetP1 = v => { S.compareP1 = v; renderMain(); };
window.cmpSetP2 = v => { S.compareP2 = v; renderMain(); };

/* ═══════════════════════════════════════════════════════
   UPLOAD PAGE
═══════════════════════════════════════════════════════ */
function renderUpload() {
  const existingKey = getGroqKey();
  const statusHtml = existingKey
    ? `<div id="keyStatus" style="margin-top:10px;font-size:.75rem;color:var(--green);">⭐ Groq API Key is active.</div>`
    : `<div id="keyStatus" style="margin-top:10px;font-size:.75rem;color:var(--muted);">No key found. Please add one to enable AI extraction.</div>`;
  return `
    <div class="page">
      <div class="sec-title">📤 Upload Match Scorecard</div>
      <p class="sec-sub">Upload a PDF scorecard — AI will extract the data using your local API key.</p>
      <div class="settings-box" style="margin-bottom:24px;padding:20px;background:var(--bg3);border-radius:12px;border:1px solid var(--oBorder);">
        <h3 style="font-family:'Oswald';color:var(--orange);margin-bottom:10px;display:flex;align-items:center;gap:8px;">⚙️ API Configuration</h3>
        <p style="font-size:.85rem;color:#aaa;margin-bottom:15px;line-height:1.4;">
          To extract data, enter your <a href="https://console.groq.com/keys" target="_blank" style="color:var(--orange);">Groq API Key</a>.
          It is stored <strong>only</strong> in your browser and never reaches GitHub.
        </p>
        <div style="display:flex;gap:10px;">
          <input type="password" id="groqKeyInput" placeholder="Paste gsk_..." style="flex:1;padding:10px;border-radius:6px;border:1px solid var(--bg4);background:var(--bg);color:white;outline:none;">
          <button onclick="saveGroqKey(document.getElementById('groqKeyInput').value)" class="btn btn-orange" style="white-space:nowrap;">Save Key</button>
        </div>
        ${statusHtml}
      </div>
      <div class="uz" id="uzone" onclick="document.getElementById('pdf-input').click()" ondragover="event.preventDefault();this.classList.add('drag')" ondragleave="this.classList.remove('drag')" ondrop="handleDrop(event)">
        <span class="u-icon">🏏</span>
        <div class="u-title">Drop scorecard PDF here</div>
        <div class="u-hint">or click to browse &nbsp;·&nbsp; Data extracted locally via Groq</div>
      </div>
    </div>`;
}

window.handleDrop=e=>{e.preventDefault();document.getElementById("uzone")?.classList.remove("drag");const f=e.dataTransfer?.files?.[0];if(f)handlePdf(f);};
document.getElementById("pdf-input").addEventListener("change",e=>{const f=e.target.files?.[0];if(f)handlePdf(f);e.target.value="";});

/* ═══════════════════════════════════════════════════════
   PDF EXTRACTION
═══════════════════════════════════════════════════════ */
async function handlePdf(file){
  if(!file.name.endsWith(".pdf")){toast("❌ Please upload a PDF file.");return;}
  document.getElementById("main").innerHTML=`<div class="page" style="text-align:center;padding:80px 20px">
    <div style="font-size:3rem;margin-bottom:20px">📄</div>
    <div class="si" style="width:40px;height:40px;border-width:3px;margin:0 auto 18px"></div>
    <div class="tm" id="pstatus">Sending to AI…</div>
    <div style="max-width:280px;margin:14px auto"><div class="prog"><div class="prog-fill" id="pbar" style="width:10%"></div></div></div>
  </div>`;
  const setP=(v,s)=>{const pb=document.getElementById("pbar"),ps=document.getElementById("pstatus");if(pb)pb.style.width=v+"%";if(ps)ps.textContent=s;};
  try{
    setP(20,"Extracting PDF text…");
    await new Promise(r=>setTimeout(r,300));
    setP(50,"AI is reading & structuring the scorecard…");
    const data=await extractAndParseWithDocStrange(file);
    setP(100,"Done! Opening review…");
    setTimeout(()=>showReviewModal(data),350);
  }catch(e){nav("upload");setTimeout(()=>toast("❌ Extraction failed: "+e.message),100);}
}

async function extractAndParseWithDocStrange(file) {
  const userApiKey = getGroqKey();
  if (!userApiKey) throw new Error("Please set your Groq API Key in the settings box above first!");
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let rawText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    rawText += content.items.map(item => item.str).join(" ") + "\n";
  }
  const groq = new window.Groq({ apiKey: userApiKey, dangerouslyAllowBrowser: true });
  const instructions = `You are a cricket data specialist. Convert the raw text from a scorecard PDF into a single valid JSON object.
    JSON STRUCTURE: { "team1": "", "team2": "", "result": "", "winner": "", "date": "", "venue": "", "innings": [{ "team": "", "total": 0, "wickets": 0, "overs": "", "extras": {"wides": 0, "noballs": 0, "byes": 0, "legbyes": 0, "total": 0}, "batting": [{"name": "", "runs": 0, "balls": 0, "fours": 0, "sixes": 0, "dismissalText": ""}], "bowling": [{"name": "", "overs": "", "maidens": 0, "runs": 0, "wickets": 0}] }] }
    RULES: Return ONLY the JSON object. No markdown.`;
  const completion = await groq.chat.completions.create({
    messages:[{ role:"system", content:instructions },{ role:"user", content:"RAW SCORECARD TEXT:\n"+rawText }],
    model:"llama-3.3-70b-versatile", temperature:0.1, response_format:{ type:"json_object" }
  });
  return JSON.parse(completion.choices[0].message.content);
}

/* ═══════════════════════════════════════════════════════
   REVIEW MODAL
═══════════════════════════════════════════════════════ */
function showReviewModal(data){
  REVIEW=JSON.parse(JSON.stringify({...data,id:nid(),date:new Date().toISOString().slice(0,10),venue:""}));
  REVIEW_TAB=0;REVIEW_INN_TABS={};
  (REVIEW.innings||[]).forEach((_,i)=>REVIEW_INN_TABS[i]="batting");
  window._rvConfirm=async()=>{await doAddMatch(REVIEW);closeModal();};
  renderReviewModal();
}
function showEditModal(matchId){
  const m=S.matches.find(x=>x.id===matchId);if(!m)return;
  REVIEW=JSON.parse(JSON.stringify(m));
  REVIEW_TAB=0;REVIEW_INN_TABS={};
  (REVIEW.innings||[]).forEach((_,i)=>REVIEW_INN_TABS[i]="batting");
  window._rvConfirm=async()=>{await doUpdateMatch(REVIEW);closeModal();};
  renderReviewModal();
}
window.showEditModal=showEditModal;

function renderReviewModal(){
  const d = REVIEW;
  if(!d) return;

  // IMPORTANT: Force the edit mode to TRUE so innTableHtml shows textfields
  S.isEditing = true; 

  const innTabs = (d.innings||[]).map((inn, i) => `
    <button class="tab ${REVIEW_TAB === i ? "active" : ""}" onclick="rvInn(${i})">
      ${esc(inn.team)} — ${inn.total}/${inn.wickets} (${fmtOv(inn.overs)})
    </button>`).join("");

  const curInn = d.innings?.[REVIEW_TAB];
  const curTab = REVIEW_INN_TABS[REVIEW_TAB] || "batting";

  document.getElementById("modal-root").innerHTML = `
    <div class="mo">
      <div class="md md-xl">
        <div class="md-head">
          <h3>⚡ Review Match Data</h3>
          <div style="display:flex;gap:8px">
            <button class="btn btn-orange btn-sm" onclick="_rvConfirm()">✓ Confirm &amp; Save</button>
            <button class="btn btn-outline btn-sm" onclick="closeModal()">✕ Cancel</button>
          </div>
        </div>
        <div class="md-body re">
          <div class="al al-i">✏️ Review all parsed data. Edit any field before saving.</div>
          <div class="fr mb4">
            <div class="fg"><label class="fl">Team 1</label><input class="fi" value="${esc(d.team1||"")}" onchange="rvField('team1',this.value)"/></div>
            <div class="fg"><label class="fl">Team 2</label><input class="fi" value="${esc(d.team2||"")}" onchange="rvField('team2',this.value)"/></div>
            <div class="fg"><label class="fl">Result</label><input class="fi" value="${esc(d.result||"")}" onchange="rvField('result',this.value)"/></div>
            <div class="fg" style="max-width:155px"><label class="fl">Date</label><input class="fi" type="date" value="${esc(d.date||"")}" onchange="rvField('date',this.value)"/></div>
            <div class="fg"><label class="fl">Venue</label><input class="fi" value="${esc(d.venue||"")}" onchange="rvField('venue',this.value)"/></div>
          </div>
          <div class="tabs">${innTabs}</div>
          ${curInn ? innTableHtml(curInn, REVIEW_TAB, curTab, true) : ""}
        </div>
      </div>
    </div>`;
}

window.rvField=(k,v)=>{REVIEW[k]=v;};
window.rvInn=i=>{REVIEW_TAB=i;renderReviewModal();};
window.rvTab=(innIdx,tab)=>{REVIEW_INN_TABS[innIdx]=tab;renderReviewModal();};

// Add these to the "HELPERS" section of your script.js
window.rvBat = (innIdx, ri, field, val) => {
  // ✅ FIX: Write to REVIEW, not S.matches
  if (!REVIEW || !REVIEW.innings[innIdx] || !REVIEW.innings[innIdx].batting[ri]) return;

  const numericFields = ['runs', 'balls', 'fours', 'sixes'];
  if (numericFields.includes(field)) {
    REVIEW.innings[innIdx].batting[ri][field] = Number(val) || 0;
  } else {
    REVIEW.innings[innIdx].batting[ri][field] = val;
  }

  if (field === "dismissalText") {
    const { type, bowler, fielder } = parseDism(val);
    REVIEW.innings[innIdx].batting[ri].dismissalType = type;
    REVIEW.innings[innIdx].batting[ri].bowler = bowler;
    REVIEW.innings[innIdx].batting[ri].fielder = fielder;
  }
};

window.rvBowl = (innIdx, ri, field, val) => {
  // ✅ FIX: Write to REVIEW, not S.matches
  if (!REVIEW || !REVIEW.innings[innIdx] || !REVIEW.innings[innIdx].bowling[ri]) return;

  const numericFields = ['runs', 'wickets', 'maidens'];
  if (numericFields.includes(field)) {
    REVIEW.innings[innIdx].bowling[ri][field] = Number(val) || 0;
  } else {
    REVIEW.innings[innIdx].bowling[ri][field] = val;
  }
};

// 3. Modal Closer
window.closeModal = () => {
  // 1. Reset the editing state so regular views return to normal text
  S.isEditing = false; 

  // 2. Clear the modal content
  const modal = document.getElementById("modal-root");
  if (modal) modal.innerHTML = "";
  
  // 3. Optional: Re-render the background page to ensure it reflects the read-only state
  renderMain(); 
};
/* ═══════════════════════════════════════════════════════
   LOGIN MODAL
═══════════════════════════════════════════════════════ */
function showLoginModal(){
  document.getElementById("modal-root").innerHTML=`
    <div class="mo" onclick="closeModal()">
      <div class="md md-sm" onclick="event.stopPropagation()">
        <div class="md-head"><h3>🔐 Admin Login</h3><button class="btn btn-outline btn-sm" onclick="closeModal()">✕</button></div>
        <div class="md-body">
          <div id="lerr"></div>
          <div class="fg mb4"><label class="fl">Password</label>
            <input class="fi" type="password" id="lpw" placeholder="Admin password" onkeydown="if(event.key==='Enter')doLogin()" autofocus/>
          </div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-orange" onclick="doLogin()">Login</button>
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          </div>
        </div>
      </div>
    </div>`;
  setTimeout(()=>document.getElementById("lpw")?.focus(),40);
}
window.showLoginModal=showLoginModal;
window.doLogin=()=>{
  const pw=document.getElementById("lpw")?.value||"";
  if(pw===CONFIG.adminPass){S.isAdmin=true;closeModal();render();toast("✅ Logged in as admin");}
  else{const el=document.getElementById("lerr");if(el)el.innerHTML=`<div class="al al-e">Incorrect password.</div>`;}
};
window.doLogout=()=>{S.isAdmin=false;if(S.page==="upload")S.page="home";render();toast("Logged out.");};

/* ═══════════════════════════════════════════════════════
   CRUD WITH SUPABASE
═══════════════════════════════════════════════════════ */
async function doAddMatch(match){
  try{await SB.upsert(match);S.matches=[match,...S.matches];S.page="match";S.matchId=match.id;render();toast("✅ Match saved to Supabase!");}
  catch(e){toast("❌ Save failed: "+e.message);}
}
async function doUpdateMatch(match){
  try{await SB.upsert(match);S.matches=S.matches.map(m=>m.id===match.id?match:m);render();toast("✅ Match updated!");}
  catch(e){toast("❌ Update failed: "+e.message);}
}
window.delMatch=async(event,id)=>{
  event.stopPropagation();
  if(!confirm("Delete this match? This cannot be undone."))return;
  try{await SB.remove(id);S.matches=S.matches.filter(m=>m.id!==id);render();toast("🗑️ Match deleted.");}
  catch(e){toast("❌ Delete failed: "+e.message);}
};

/* ═══════════════════════════════════════════════════════
   RENDER (updated switch)
═══════════════════════════════════════════════════════ */
function renderMain(){
  if(S.loading){
    document.getElementById("main").innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:60vh"><div style="text-align:center"><div style="font-size:3rem;margin-bottom:16px">🏏</div><div class="si" style="margin:0 auto"></div></div></div>`;
    return;
  }
  switch(S.page){
    case "home":        document.getElementById("main").innerHTML=renderHome();break;
    case "matches":     document.getElementById("main").innerHTML=renderMatches();break;
    case "match":       document.getElementById("main").innerHTML=renderMatchDetail();break;
    case "players":     document.getElementById("main").innerHTML=renderPlayers();break;
    case "playercards": document.getElementById("main").innerHTML=renderPlayerCards();break;
    case "compare":     document.getElementById("main").innerHTML=renderCompare();break;
    case "upload":      document.getElementById("main").innerHTML=S.isAdmin?renderUpload():`<div class="page"><div class="empty"><div class="ei">🔒</div>Admin access required.</div></div>`;break;
    default:            document.getElementById("main").innerHTML=renderHome();
  }
}

function render(){ renderNav(); renderMain(); }

render();
loadData();
