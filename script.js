
/* ═══════════════════════════════════════════════════════
   ⚙️  CONFIG — Fill in your Supabase credentials below
   (See README.md for step-by-step setup instructions)
═══════════════════════════════════════════════════════ */
const CONFIG = {
  supabaseUrl:  "https://jeanvxfyqztuiyeqtyzh.supabase.co",
  supabaseKey:  "sb_publishable_QDbEbRxszCMK_bRpfKhjmQ_tzFKjXrK",
  adminPass:    "cricket1982"
};
// ─────────────────────────────────────────────────────

const IS_CONFIGURED = CONFIG.supabaseUrl !== "YOUR_SUPABASE_URL";

// Function to save the key
const saveGroqKey = (key) => {
  localStorage.setItem('GROQ_API_KEY', key);
  alert("Key saved locally!");
};

// Function to get the key
const getGroqKey = () => {
  return localStorage.getItem('GROQ_API_KEY');
};

/* ═══════════════════════════════════════════════════════
   SUPABASE REST HELPERS
═══════════════════════════════════════════════════════ */
const SB = {
  hdrs(extra={}) {
    return {
      "apikey": CONFIG.supabaseKey,
      "Authorization": `Bearer ${CONFIG.supabaseKey}`,
      "Content-Type": "application/json",
      ...extra
    };
  },
  async getAll() {
    const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/matches?select=*&order=created_at.desc`, { headers: SB.hdrs() });
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    return rows.map(row => ({ id: row.id, ...row.data }));
  },
  async upsert(match) {
    const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/matches`, {
      method: "POST",
      headers: SB.hdrs({ "Prefer": "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ id: match.id, data: match })
    });
    if (!r.ok) throw new Error(await r.text());
  },
  async remove(id) {
    const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/matches?id=eq.${id}`, {
      method: "DELETE",
      headers: SB.hdrs()
    });
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
  innTabs: {}
};

let REVIEW = null, REVIEW_TAB = 0, REVIEW_INN_TABS = {};

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
const nid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const fmtOv = v => { if(v==null)return"0.0"; const n=parseFloat(v),f=Math.floor(n),b=Math.round((n-f)*10);return`${f}.${b}`; };
const ovDec = v => { if(!v)return 0;const[o,b="0"]=String(v).split(".");return parseInt(o)+parseInt(b)/6; };
const decOv = d => { const f=Math.floor(d),b=Math.round((d-f)*6);return`${f}.${b}`; };
const fmtDate = d => { if(!d)return""; try{return new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}catch(e){return d;} };

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
      bi: 0, bno: 0, br: 0, bb: 0, b4: 0, b6: 0, bhs: 0, bhsno: false,
      wbl: 0, wm: 0, wr: 0, ww: 0, fc: 0, fro: 0, fst: 0,
      wt: { bowled: 0, caught: 0, lbw: 0, stumped: 0, hit_wicket: 0 }
    };
    return pl[name];
  };

  for (const m of matches) {
    for (const inn of (m.innings || [])) {
      // 1. Batting Stats
      for (const b of (inn.batting || [])) {
        if (!b.name) continue;

        // Only count as an innings if they actually faced a ball, scored a run, 
        // or have a dismissal that isn't "did not bat"
        const dText = (b.dismissalText || "").toLowerCase();
        const hasBatted = (b.balls > 0 || b.runs > 0 || (dText !== "" && dText !== "did not bat"));

        if (hasBatted) {
          const p = g(b.name);
          p.mids.add(m.id);

          // Correct "Not Out" check: 
          // A player is NOT OUT if type is explicitly 'not_out' OR if dismissal text is 'not out'
          const isNotOut = (b.dismissalType === "not_out" || dText === "not out" || dText === "retired hurt");

          p.bi++; // Increment Innings
          if (isNotOut) p.bno++; // Increment Not Out

          p.br += +b.runs || 0;
          p.bb += +b.balls || 0;
          p.b4 += +b.fours || 0;
          p.b6 += +b.sixes || 0;

          // High Score Logic
          const currentRuns = +b.runs || 0;
          if (currentRuns > p.bhs) {
            p.bhs = currentRuns;
            p.bhsno = isNotOut;
          } else if (currentRuns === p.bhs && isNotOut) {
            // If scores are equal, favor the Not Out record for the "*" display
            p.bhsno = true;
          }
        }
      }

      // 2. Bowling Stats
      for (const bw of (inn.bowling || [])) {
        if (!bw.name) continue;
        const p = g(bw.name);
        p.mids.add(m.id);
        p.wbl += Math.round(ovDec(bw.overs) * 6);
        p.wm += +bw.maidens || 0;
        p.wr += +bw.runs || 0;
        p.ww += +bw.wickets || 0;
      }

      // 3. Fielding & Wicket Types
      for (const b of (inn.batting || [])) {
        const { type, fielder, bowler } = parseDism(b.dismissalText || "");
        if (type === "caught" && fielder) { const p = g(fielder); p.mids.add(m.id); p.fc++; }
        if (type === "stumped" && fielder) { const p = g(fielder); p.mids.add(m.id); p.fst++; }
        if (type === "run_out" && fielder) { const p = g(fielder); p.mids.add(m.id); p.fro++; }
        if (bowler && ["bowled", "caught", "lbw", "stumped", "hit_wicket"].includes(type)) {
          const p = g(bowler);
          p.mids.add(m.id);
          if (p.wt[type] !== undefined) p.wt[type]++;
        }
      }
    }
  }

  return Object.values(pl).map(p => {
    const od = p.wbl / 6;
    const dis = p.bi - p.bno; // Total innings minus times remained not out = number of times out
    return {
      ...p,
      matches: p.mids.size,
      bat_runs: p.br, bat_balls: p.bb, bat_innings: p.bi, bat_notout: p.bno,
      bat_4s: p.b4, bat_6s: p.b6, bat_hs: p.bhs, bat_hs_no: p.bhsno,
      bowl_wkts: p.ww, bowl_runs: p.wr, bowl_maidens: p.wm, bowl_balls: p.wbl,
      field_catches: p.fc, field_runouts: p.fro, field_stumpings: p.fst, wkt_types: p.wt,
      bat_avg: dis > 0 ? p.br / dis : (p.bi > 0 ? p.br : null), // Average is Runs / Times Out
      bat_sr: p.bb > 0 ? (p.br / p.bb) * 100 : null,
      bowl_overs: decOv(od),
      bowl_econ: od > 0 ? p.wr / od : null,
      bowl_avg: p.ww > 0 ? p.wr / p.ww : null,
      bowl_sr: p.ww > 0 ? p.wbl / p.ww : null
    };
  });
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

/* ═══════════════════════════════════════════════════════
   LOAD DATA FROM SUPABASE
═══════════════════════════════════════════════════════ */
async function loadData(){
  if(!IS_CONFIGURED){S.loading=false;render();return;}
  try{S.matches=await SB.getAll();}catch(e){console.error("Load failed:",e);}
  S.loading=false;render();
}

/* ═══════════════════════════════════════════════════════
   RENDER NAV
═══════════════════════════════════════════════════════ */
function renderNav(){
  const p=S.page,a=S.isAdmin;
  document.getElementById("nav-links").innerHTML=`
    <button class="nav-btn ${p==="home"?"active":""}" onclick="nav('home')">Home</button>
    <button class="nav-btn ${p==="matches"?"active":""}" onclick="nav('matches')">Matches</button>
    <button class="nav-btn ${p==="players"?"active":""}" onclick="nav('players')">Stats</button>
    ${a?`<button class="nav-btn ${p==="upload"?"active":""}" onclick="nav('upload')">Upload</button>`:""}
    ${a?`<button class="nav-btn danger" onclick="doLogout()">🔓 Logout</button>`:`<button class="nav-btn cta" onclick="showLoginModal()">Admin Login</button>`}
  `;
}

/* ═══════════════════════════════════════════════════════
   SETUP SCREEN
═══════════════════════════════════════════════════════ */
function renderSetup(){
  return `<div class="setup">
    <div style="font-size:3rem;margin-bottom:16px">🏏</div>
    <h2>Welcome to The Crease</h2>
    <p>Connect a Supabase backend to get started. Your match data will be stored there and shared with everyone who visits this page.</p>
    <div class="setup-steps">
      <h4>🔧 One-Time Setup</h4>
      <div class="step"><div class="step-num">1</div><div class="step-txt">Go to <strong>supabase.com</strong>, create a free account and a new project.</div></div>
      <div class="step"><div class="step-num">2</div><div class="step-txt">In your project, go to <strong>SQL Editor</strong> and run this to create the matches table:
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
      <div class="step"><div class="step-num">3</div><div class="step-txt">Go to <strong>Project Settings → API</strong>. Copy your <code>Project URL</code> and <code>anon public</code> key.</div></div>
      <div class="step"><div class="step-num">4</div><div class="step-txt">Open <code>index.html</code> in a text editor, find the <strong>CONFIG</strong> block near the top, and paste your values into <code>supabaseUrl</code> and <code>supabaseKey</code>.</div></div>
      <div class="step"><div class="step-num">5</div><div class="step-txt">Push to GitHub and enable <strong>GitHub Pages</strong> (Settings → Pages → Deploy from main branch). Done — share the URL with your friends!</div></div>
    </div>
    <div style="color:var(--muted);font-size:.85rem">See <strong>README.md</strong> in the repo for full instructions.</div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════
   HOME PAGE
═══════════════════════════════════════════════════════ */
function renderHome(){
  if(!IS_CONFIGURED) return renderSetup();
  const stats=computeStats(S.matches);
  const topBat=[...stats].sort((a,b)=>b.bat_runs-a.bat_runs)[0];
  const topBowl=[...stats].filter(p=>p.bowl_wkts>0).sort((a,b)=>b.bowl_wkts-a.bowl_wkts)[0];
  const recent=[...S.matches].slice(0,3);
  const npl=stats.filter(p=>p.matches>0).length;
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
        <div class="sc" onclick="nav('players')" style="cursor: pointer; "><div class="sn">${S.matches.length}</div><div class="sl">Matches</div></div>
        <div class="sc" onclick="nav('players')" style="cursor: pointer; "><div class="sn">${npl}</div><div class="sl">Players</div></div>
        <div class="sc" onclick="nav('players')" style="cursor: pointer; "><div class="sn">${topBat?.bat_runs||"—"}</div><div class="sl">Top Runs${topBat?" · "+esc(topBat.name):""}</div></div>
        <div class="sc" onclick="nav('players')" style="cursor: pointer; "><div class="sn">${topBowl?.bowl_wkts||"—"}</div><div class="sl">Top Wickets${topBowl?" · "+esc(topBowl.name):""}</div></div>
        <div class="sc" onclick="nav('players')" style="cursor: pointer; "><div class="sn">More stats</div><div class="sl"></div></div>  
      </div>
      ${recent.length?`<div class="sec-title">🕐 Recent Matches</div><div class="ml mt3">${recent.map(m=>matchCardHtml(m,false)).join("")}</div>`:""}
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
   INNINGS TABLE
═══════════════════════════════════════════════════════ */
function innTableHtml(inn,innIdx,activeTab,editable){
  const tbH=["batting","bowling","fow"].map((t,i)=>`
    <button class="tab ${t===activeTab?"active":""}" onclick="${editable?`rvTab(${innIdx},'${t}')`:`mdTab(${innIdx},'${t}')`}">${["Batting","Bowling","Fall of Wickets"][i]}</button>`).join("");
  let body="";
  if(activeTab==="batting"){
    const rows=(inn.batting||[]).map((b,i)=>{
      const sr=b.balls>0?((b.runs/b.balls)*100).toFixed(1):"-";
      const{type}=parseDism(b.dismissalText||"");
      if(editable)return`<tr>
        <td><input value="${esc(b.name)}" onchange="rvBat(${innIdx},${i},'name',this.value)"/></td>
        <td><input style="min-width:155px" value="${esc(b.dismissalText||"")}" onchange="rvBat(${innIdx},${i},'dismissalText',this.value)"/></td>
        <td class="r"><input style="width:52px;text-align:right" type="number" value="${b.runs||0}" onchange="rvBat(${innIdx},${i},'runs',+this.value)"/></td>
        <td class="r"><input style="width:52px;text-align:right" type="number" value="${b.balls||0}" onchange="rvBat(${innIdx},${i},'balls',+this.value)"/></td>
        <td class="r"><input style="width:42px;text-align:right" type="number" value="${b.fours||0}" onchange="rvBat(${innIdx},${i},'fours',+this.value)"/></td>
        <td class="r"><input style="width:42px;text-align:right" type="number" value="${b.sixes||0}" onchange="rvBat(${innIdx},${i},'sixes',+this.value)"/></td>
        <td class="r tm">${sr}</td></tr>`;
      return`<tr>
        <td class="tb">${esc(b.name)}</td>
        <td><span class="dt ${DC[type]||"dt-no"}">${DL[type]||"?"}</span><span class="tm tsm">${esc(b.dismissalText||"")}</span></td>
        <td class="r">${b.runs||0}</td><td class="r">${b.balls||0}</td>
        <td class="r">${b.fours||0}</td><td class="r">${b.sixes||0}</td>
        <td class="r tm">${sr}</td></tr>`;
    }).join("");
    const rr=inn.total&&inn.overs?(inn.total/ovDec(inn.overs)).toFixed(2):"-";
    body=`<div class="tw"><table class="tbl"><thead><tr><th>Batsman</th><th>Dismissal</th><th class="r">R</th><th class="r">B</th><th class="r">4s</th><th class="r">6s</th><th class="r">SR</th></tr></thead>
    <tbody>${rows}<tr><td colspan="2" class="tm">Extras (${inn.extras?.total||0}) — WD:${inn.extras?.wides||0} NB:${inn.extras?.noballs||0} B:${inn.extras?.byes||0} LB:${inn.extras?.legbyes||0}</td>
    <td colspan="5" class="r tb">${inn.total}/${inn.wickets} (${fmtOv(inn.overs)} ov)&nbsp; RR:${rr}</td></tr></tbody></table></div>`;
  }
  if(activeTab==="bowling"){
    const rows=(inn.bowling||[]).map((b,i)=>{
      const er=ovDec(b.overs)>0?(b.runs/ovDec(b.overs)).toFixed(2):"-";
      if(editable)return`<tr>
        <td><input value="${esc(b.name)}" onchange="rvBowl(${innIdx},${i},'name',this.value)"/></td>
        <td class="r"><input style="width:58px;text-align:right" value="${b.overs||""}" onchange="rvBowl(${innIdx},${i},'overs',this.value)"/></td>
        <td class="r"><input style="width:42px;text-align:right" type="number" value="${b.maidens||0}" onchange="rvBowl(${innIdx},${i},'maidens',+this.value)"/></td>
        <td class="r"><input style="width:52px;text-align:right" type="number" value="${b.runs||0}" onchange="rvBowl(${innIdx},${i},'runs',+this.value)"/></td>
        <td class="r"><input style="width:42px;text-align:right" type="number" value="${b.wickets||0}" onchange="rvBowl(${innIdx},${i},'wickets',+this.value)"/></td>
        <td class="r tm">${er}</td></tr>`;
      return`<tr><td class="tb">${esc(b.name)}</td><td class="r">${fmtOv(b.overs)}</td><td class="r">${b.maidens||0}</td><td class="r">${b.runs||0}</td><td class="r to">${b.wickets||0}</td><td class="r tm">${er}</td></tr>`;
    }).join("");
    body=`<div class="tw"><table class="tbl"><thead><tr><th>Bowler</th><th class="r">O</th><th class="r">M</th><th class="r">R</th><th class="r">W</th><th class="r">ER</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  if(activeTab==="fow"){
    const fow=inn.fallOfWickets||[];
    body=`<div class="tw"><table class="tbl"><thead><tr><th>Batsman</th><th>Score</th><th>Over</th></tr></thead>
    <tbody>${!fow.length?`<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--muted)">No data</td></tr>`:fow.map(f=>`<tr><td>${esc(f.batsman)}</td><td>${esc(f.score)}</td><td class="tm">${esc(f.over)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  return `<div class="tabs">${tbH}</div>${body}`;
}

/* ═══════════════════════════════════════════════════════
   MATCH DETAIL
═══════════════════════════════════════════════════════ */
function renderMatchDetail(){
  const m=S.matches.find(x=>x.id===S.matchId);
  if(!m) return `<div class="page"><div class="empty"><div class="ei">❌</div>Match not found.</div></div>`;
  const innsH=(m.innings||[]).map((inn,i)=>{
    const k=`${m.id}-${i}`;if(!S.innTabs[k])S.innTabs[k]="batting";
    return`<div class="card mb4">
      <div class="inn-hd"><div class="inn-team">${esc(inn.team)}</div>
      <div><span class="inn-score">${inn.total}/${inn.wickets}</span><span class="inn-rr">(${fmtOv(inn.overs)} ov) RR:${inn.total&&inn.overs?(inn.total/ovDec(inn.overs)).toFixed(2):"-"}</span></div></div>
      <div class="re" style="padding:16px 4px">${innTableHtml(inn,i,S.innTabs[k],false)}</div>
    </div>`;
  }).join("");
  return `<div class="page">
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:22px">
      <button class="btn btn-outline btn-sm" onclick="nav('matches')">← Back</button>
      ${S.isAdmin?`<button class="btn btn-sky btn-sm" onclick="showEditModal('${m.id}')">✏️ Edit</button>`:""}
    </div>
    <div class="mdh">
      ${m.date?`<div class="tm txs mb2">${fmtDate(m.date)}${m.venue?" · "+esc(m.venue):""}</div>`:""}
      <div class="mdt"><span class="to2">${esc(m.team1)}</span><span class="vs">vs</span><span class="to2">${esc(m.team2)}</span></div>
      <span class="badge bo">${esc(m.result)}</span>
    </div>
    ${innsH}
  </div>`;
}
window.mdTab=(innIdx,tab)=>{const m=S.matches.find(x=>x.id===S.matchId);if(!m)return;S.innTabs[`${m.id}-${innIdx}`]=tab;renderMain();};

/* ═══════════════════════════════════════════════════════
   PLAYERS PAGE
═══════════════════════════════════════════════════════ */
function renderPlayers() {
  const all = computeStats(S.matches);
  const tab = S.playTab, sf = S.sortField, sd = S.sortDir, q = S.search.toLowerCase();

  const filtered = all.filter(p => {
    const hasMatches = p.matches > 0;
    const matchesSearch = p.name.toLowerCase().includes(q);
    const startsWithAlpha = /^[a-zA-Z]/.test(p.name.trim()); 
    return hasMatches && matchesSearch && startsWithAlpha;
  });

  const isInverseField = ["bowl_avg", "bowl_econ", "bowl_sr"].includes(sf);

  const sorted = [...filtered].sort((a, b) => {
    let va = a[sf]; let vb = b[sf];
    if (sf === "name") {
      const nameA = String(va || "").trim(); const nameB = String(vb || "").trim();
      const isAlphaA = /^[a-zA-Z]/.test(nameA); const isAlphaB = /^[a-zA-Z]/.test(nameB);
      if (isAlphaA && !isAlphaB) return -1;
      if (!isAlphaA && isAlphaB) return 1;
      return sd === "asc" ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    }
    const vaNone = va === null || va === undefined;
    const vbNone = vb === null || vb === undefined;
    if (vaNone && vbNone) return 0;
    if (vaNone) return 1; if (vbNone) return -1;
    return isInverseField ? (sd === "asc" ? vb - va : va - vb) : (sd === "asc" ? va - vb : vb - va);
  });

  // Helper to apply the 'to' class if the field is the sorted field
  const SC = (f) => sf === f ? "to" : "";

  const SH = (f, l, r = true, c = false) => `<th class="${r ? "r" : ""} ${c ? "c" : ""} ${sf === f ? "sorted" : ""}" onclick="plSort('${f}')">${l}<span class="sort-icon">${sf === f ? (sd === "asc" ? "▲" : "▼") : "↕"}</span></th>`;
  
  let tbl = "";

  if(tab === "batting"){
    tbl = `<div class="tw"><table class="tbl"><thead><tr>
      <th style="width:40px">Rank</th>
      ${SH("name","Player",false)}${SH("matches","M")}${SH("bat_innings","Inn")}${SH("bat_notout","NO")}${SH("bat_runs","Runs")}${SH("bat_balls","Balls")}${SH("bat_hs","HS")}${SH("bat_avg","Avg")}${SH("bat_sr","SR")}${SH("bat_4s","4s")}${SH("bat_6s","6s")}
    </tr></thead>
    <tbody>${sorted.map((p, i)=>`<tr>
      <td class="r" style="color:var(--muted);font-size:0.85em">${i + 1}</td>
      <td class="tb ${SC("name")}">${esc(p.name)}</td>
      <td class="r ${SC("matches")}">${p.matches}</td>
      <td class="r ${SC("bat_innings")}">${p.bat_innings}</td>
      <td class="r tm ${SC("bat_notout")}">${p.bat_notout}</td>
      <td class="r ${SC("bat_runs")}">${p.bat_runs}</td>
      <td class="r ${SC("bat_balls")}">${p.bat_balls}</td>
      <td class="r ${SC("bat_hs")}">${p.bat_hs}${p.bat_hs_no?"*":""}</td>
      <td class="r ${SC("bat_avg")}">${p.bat_avg!=null?p.bat_avg.toFixed(2):"-"}</td>
      <td class="r ${SC("bat_sr")}">${p.bat_sr!=null?p.bat_sr.toFixed(1):"-"}</td>
      <td class="r ${SC("bat_4s")}">${p.bat_4s}</td>
      <td class="r ${SC("bat_6s")}">${p.bat_6s}</td>
    </tr>`).join("")}</tbody></table></div>`;
  }

 if(tab === "bowling"){
    const bp = sorted.filter(p => p.bowl_balls > 0);
    tbl = `<div class="tw"><table class="tbl"><thead><tr>
      <th style="width:40px">Rank</th>
      ${SH("name","Player",false)}${SH("matches","M")}<th>Ov</th>${SH("bowl_maidens","M")}${SH("bowl_runs","R")}${SH("bowl_wkts","W")}${SH("bowl_avg","Avg")}${SH("bowl_econ","Econ")}${SH("bowl_sr","SR")}
      <th class="c"><span class="dt dt-b">b</span></th>
      <th class="c"><span class="dt dt-c">c</span></th>
      <th class="c"><span class="dt dt-lbw">lbw</span></th>
      <th class="c"><span class="dt dt-st">st</span></th>
      <th class="c"><span class="dt dt-hw">hw</span></th>
    </tr></thead>
    <tbody>${bp.map((p, i)=>`<tr>
      <td class="r" style="color:var(--muted);font-size:0.85em">${i + 1}</td>
      <td class="tb ${SC("name")}">${esc(p.name)}</td>
      <td class="r ${SC("matches")}">${p.matches}</td>
      <td class="r">${p.bowl_overs}</td>
      <td class="r ${SC("bowl_maidens")}">${p.bowl_maidens}</td>
      <td class="r ${SC("bowl_runs")}">${p.bowl_runs}</td>
      <td class="r ${SC("bowl_wkts")}">${p.bowl_wkts}</td>
      <td class="r ${SC("bowl_avg")}">${p.bowl_avg!=null?p.bowl_avg.toFixed(2):"-"}</td>
      <td class="r ${SC("bowl_econ")}">${p.bowl_econ!=null?p.bowl_econ.toFixed(2):"-"}</td>
      <td class="r ${SC("bowl_sr")}">${p.bowl_sr!=null?p.bowl_sr.toFixed(1):"-"}</td>
      <td class="c">${p.wkt_types.bowled||0}</td>
      <td class="c">${p.wkt_types.caught||0}</td>
      <td class="c">${p.wkt_types.lbw||0}</td>
      <td class="c">${p.wkt_types.stumped||0}</td>
      <td class="c">${p.wkt_types.hit_wicket||0}</td>
    </tr>`).join("")||`<tr><td colspan="15" style="text-align:center;padding:24px;color:var(--muted)">No bowling data</td></tr>`}
    </tbody></table></div>`;
  }

  if(tab === "fielding"){
    tbl = `<div class="tw"><table class="tbl"><thead><tr>
      <th style="width:40px">Rank</th>
      ${SH("name","Player",false)}${SH("matches","M")}${SH("field_catches","Catches")}${SH("field_runouts","Run Outs")}${SH("field_stumpings","Stumpings")}
    </tr></thead>
    <tbody>${sorted.map((p, i)=>`<tr>
      <td class="r" style="color:var(--muted);font-size:0.85em">${i + 1}</td>
      <td class="tb ${SC("name")}">${esc(p.name)}</td>
      <td class="r ${SC("matches")}">${p.matches}</td>
      <td class="r ${SC("field_catches")}">${p.field_catches}</td>
      <td class="r ${SC("field_runouts")}">${p.field_runouts}</td>
      <td class="r ${SC("field_stumpings")}">${p.field_stumpings}</td>
    </tr>`).join("")}</tbody></table></div>`;
  }

  return `<div class="page">
    <div class="fb mb4">
      <div><div class="sec-title">👤 Player Statistics</div><p class="sec-sub">${filtered.length} players</p></div>
      <div style="display:flex; gap:8px;">
        <input class="fi" id="psearch" placeholder="Search player…" value="${esc(S.search)}" style="max-width:200px" autocomplete="off" onkeydown="if(event.key==='Enter') plSearchExec()"/>
        <button class="btn btn-p btn-orange" onclick="plSearchExec()" style="padding: 0 16px;">Search</button>
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



window.plSort = (f) => {
  if (S.sortField === f) S.sortDir = S.sortDir === "asc" ? "desc" : "asc";
  else { S.sortField = f; S.sortDir = "desc"; }
  render(); 
};

window.plTab = (t) => {
  S.playTab = t;
  // Set default sort field based on the selected tab
  if (t === "batting") {
    S.sortField = "bat_runs";
  } else if (t === "bowling") {
    S.sortField = "bowl_wkts";
  } else if (t === "fielding") {
    S.sortField = "field_catches";
  }
  S.sortDir = "desc"; // Always sort by highest value first when switching
  render();
};

window.plSearchExec = () => {
  const val = document.getElementById("psearch").value;
  S.search = val;
  render(); // Now we render everything once
};
/* ═══════════════════════════════════════════════════════
   UPLOAD PAGE
═══════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   UPLOAD PAGE (Updated with Local API Settings)
═══════════════════════════════════════════════════════ */
function renderUpload() {
  const existingKey = getGroqKey();
  const statusHtml = existingKey 
    ? `<div id="keyStatus" style="margin-top: 10px; font-size: 0.75rem; color: var(--green);">⭐ Groq API Key is active.</div>`
    : `<div id="keyStatus" style="margin-top: 10px; font-size: 0.75rem; color: var(--muted);">No key found. Please add one to enable AI extraction.</div>`;

  return `
    <div class="page">
      <div class="sec-title">📤 Upload Match Scorecard</div>
      <p class="sec-sub">Upload a PDF scorecard — AI will extract the data using your local API key.</p>

      <div class="settings-box" style="margin-bottom: 24px; padding: 20px; background: var(--bg3); border-radius: 12px; border: 1px solid var(--oBorder);">
        <h3 style="font-family: 'Oswald'; color: var(--orange); margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
          ⚙️ API Configuration
        </h3>
        <p style="font-size: 0.85rem; color: #aaa; margin-bottom: 15px; line-height: 1.4;">
          To extract data, enter your <a href="https://console.groq.com/keys" target="_blank" style="color: var(--orange);">Groq API Key</a>. 
          It is stored <strong>only</strong> in your browser and never reaches GitHub.
        </p>
        <div style="display: flex; gap: 10px;">
          <input type="password" id="groqKeyInput" placeholder="Paste gsk_..." 
                 style="flex: 1; padding: 10px; border-radius: 6px; border: 1px solid var(--bg4); background: var(--bg); color: white; outline: none;">
          <button onclick="saveGroqKey(document.getElementById('groqKeyInput').value)" 
                  class="btn btn-orange" style="white-space: nowrap;">
            Save Key
          </button>
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
   DOCSTRANGE PDF EXTRACTION
═══════════════════════════════════════════════════════ */
async function handlePdf(file){
  if(!file.name.endsWith(".pdf")){toast("❌ Please upload a PDF file.");return;}
  document.getElementById("main").innerHTML=`<div class="page" style="text-align:center;padding:80px 20px">
    <div style="font-size:3rem;margin-bottom:20px">📄</div>
    <div class="si" style="width:40px;height:40px;border-width:3px;margin:0 auto 18px"></div>
    <div class="tm" id="pstatus">Sending to DocStrange AI…</div>
    <div style="max-width:280px;margin:14px auto"><div class="prog"><div class="prog-fill" id="pbar" style="width:10%"></div></div></div>
  </div>`;
  const setP=(v,s)=>{const pb=document.getElementById("pbar"),ps=document.getElementById("pstatus");if(pb)pb.style.width=v+"%";if(ps)ps.textContent=s;};
  try{
    setP(20,"Uploading PDF to DocStrange…");
    await new Promise(r=>setTimeout(r,300));
    setP(50,"DocStrange AI is reading & structuring the scorecard…");
    const data=await extractAndParseWithDocStrange(file);
    setP(100,"Done! Opening review…");
    setTimeout(()=>showReviewModal(data),350);
  }catch(e){
    nav("upload");
    setTimeout(()=>toast("❌ Extraction failed: "+e.message),100);
  }
}
async function extractAndParseWithDocStrange(file) {
  const userApiKey = getGroqKey();

  if (!userApiKey) {
    throw new Error("Please set your Groq API Key in the settings box above first!");
  }

  // --- PART A: Local PDF Text Extraction ---
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

  // --- PART B: Call Groq directly using the User's Key ---
  const groq = new window.Groq({ 
    apiKey: userApiKey,
    dangerouslyAllowBrowser: true 
  });

  const instructions = `
    You are a cricket data specialist. Convert the raw text from a scorecard PDF into a single valid JSON object.
    JSON STRUCTURE: { "team1": "", "team2": "", "result": "", "winner": "", "date": "", "venue": "", "innings": [{ "team": "", "total": 0, "wickets": 0, "overs": "", "extras": {"wides": 0, "noballs": 0, "byes": 0, "legbyes": 0, "total": 0}, "batting": [{"name": "", "runs": 0, "balls": 0, "fours": 0, "sixes": 0, "dismissalText": ""}], "bowling": [{"name": "", "overs": "", "maidens": 0, "runs": 0, "wickets": 0}] }] }
    RULES: Return ONLY the JSON object. No markdown.
  `;

  const completion = await groq.chat.completions.create({
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: "RAW SCORECARD TEXT:\n" + rawText }
    ],
    model: "llama-3.3-70b-versatile",
    temperature: 0.1,
    response_format: { type: "json_object" }
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
  // Override confirm action
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
  const d=REVIEW;
  const innTabs=(d.innings||[]).map((inn,i)=>`
    <button class="tab ${REVIEW_TAB===i?"active":""}" onclick="rvInn(${i})">${esc(inn.team)} — ${inn.total}/${inn.wickets} (${fmtOv(inn.overs)})</button>`).join("");
  const curInn=d.innings?.[REVIEW_TAB];
  const curTab=REVIEW_INN_TABS[REVIEW_TAB]||"batting";
  document.getElementById("modal-root").innerHTML=`
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
          ${curInn?innTableHtml(curInn,REVIEW_TAB,curTab,true):""}
        </div>
      </div>
    </div>`;
}
window.rvField=(k,v)=>{REVIEW[k]=v;};
window.rvInn=i=>{REVIEW_TAB=i;renderReviewModal();};
window.rvTab=(innIdx,tab)=>{REVIEW_INN_TABS[innIdx]=tab;renderReviewModal();};
window.rvBat=(innIdx,ri,field,val)=>{
  REVIEW.innings[innIdx].batting[ri][field]=val;
  if(field==="dismissalText"){const{type,bowler,fielder}=parseDism(val);REVIEW.innings[innIdx].batting[ri].dismissalType=type;REVIEW.innings[innIdx].batting[ri].bowler=bowler;REVIEW.innings[innIdx].batting[ri].fielder=fielder;}
};
window.rvBowl=(innIdx,ri,field,val)=>{REVIEW.innings[innIdx].bowling[ri][field]=val;};
function closeModal(){document.getElementById("modal-root").innerHTML="";}
window.closeModal=closeModal;

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
  try{
    await SB.upsert(match);
    S.matches=[match,...S.matches];
    S.page="match";S.matchId=match.id;
    render();toast("✅ Match saved to Supabase!");
  }catch(e){toast("❌ Save failed: "+e.message);}
}

async function doUpdateMatch(match){
  try{
    await SB.upsert(match);
    S.matches=S.matches.map(m=>m.id===match.id?match:m);
    render();toast("✅ Match updated!");
  }catch(e){toast("❌ Update failed: "+e.message);}
}

window.delMatch=async(event,id)=>{
  event.stopPropagation();
  if(!confirm("Delete this match? This cannot be undone."))return;
  try{
    await SB.remove(id);
    S.matches=S.matches.filter(m=>m.id!==id);
    render();toast("🗑️ Match deleted.");
  }catch(e){toast("❌ Delete failed: "+e.message);}
};

/* ═══════════════════════════════════════════════════════
   RENDER
═══════════════════════════════════════════════════════ */
function renderMain(){
  if(S.loading){document.getElementById("main").innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:60vh"><div style="text-align:center"><div style="font-size:3rem;margin-bottom:16px">🏏</div><div class="si" style="margin:0 auto"></div></div></div>`;return;}
  switch(S.page){
    case "home":    document.getElementById("main").innerHTML=renderHome();break;
    case "matches": document.getElementById("main").innerHTML=renderMatches();break;
    case "match":   document.getElementById("main").innerHTML=renderMatchDetail();break;
    case "players": document.getElementById("main").innerHTML=renderPlayers();break;
    case "upload":  document.getElementById("main").innerHTML=S.isAdmin?renderUpload():`<div class="page"><div class="empty"><div class="ei">🔒</div>Admin access required.</div></div>`;break;
    default:        document.getElementById("main").innerHTML=renderHome();
  }
}

function render(){renderNav();renderMain();}

// Init
render();
loadData();
