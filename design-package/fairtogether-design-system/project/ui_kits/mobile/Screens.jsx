// Screens.jsx — FairTogether mobile screens (RTL)
const SkyHeader = ({ children, height=180 }) => (
  <div style={{
    background: 'linear-gradient(180deg, #89B4E8 0%, #A8CBEF 35%, #C8DDF5 65%, #E4EDF9 90%, #F0F4F8 100%)',
    height, paddingTop:16, paddingInline:20,
    position:'relative',
  }}>{children}</div>
);

const ScreenBg = ({ children, sky=false }) => (
  <div style={{
    height:'100%', background: sky ? 'transparent' : '#F0F4F8',
    overflowY:'auto', fontFamily:'Heebo, sans-serif', color:'#0F172A',
  }}>{children}</div>
);

// ── Splash / hero ───────────────────────────────────────────────────────────
const SplashScreen = ({ onStart }) => (
  <div style={{
    height:'100%', background:'linear-gradient(180deg, #89B4E8 0%, #A8CBEF 25%, #C8DDF5 55%, #E4EDF9 85%, #F0F4F8 100%)',
    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'space-between',
    padding:'32px 24px 40px', fontFamily:'Heebo, sans-serif',
  }}>
    <div style={{display:'flex', alignItems:'center', gap:8, marginTop:8}}>
      <img src="../../assets/brand/icon.png" style={{width:36, height:36, borderRadius:9}}/>
      <span style={{color:'#fff', fontWeight:700, fontSize:18, direction:'ltr'}}>Fair Together</span>
    </div>
    <div style={{width:220, height:430, background:'#fff', borderRadius:32, padding:6, boxShadow:'0 20px 50px rgba(15,23,42,0.25)'}}>
      <div style={{height:'100%', background:'#F8FAFC', borderRadius:26, padding:12, display:'flex', flexDirection:'column', gap:8}}>
        <div style={{fontSize:13, fontWeight:700, textAlign:'right'}}>תביעות</div>
        <div style={{display:'flex', gap:6, fontSize:10}}>
          <span style={{padding:'4px 8px', background:'#1A56DB', color:'#fff', borderRadius:8}}>הכל</span>
          <span style={{padding:'4px 8px', background:'#fff', border:'1px solid #E2E8F0', borderRadius:8}}>בבדיקה</span>
          <span style={{padding:'4px 8px', background:'#fff', border:'1px solid #E2E8F0', borderRadius:8}}>אושר</span>
        </div>
        <div style={{background:'#fff', borderRadius:10, padding:8, border:'1px solid #E2E8F0', fontSize:10}}>
          <div style={{display:'flex', justifyContent:'space-between'}}>
            <span style={{color:'#E31019', fontWeight:700}}>■</span>
            <span style={{fontWeight:700}}>שופרסל</span>
          </div>
          <div style={{display:'flex', gap:2, marginTop:6}}>
            <div style={{flex:1, height:3, background:'#059669', borderRadius:2}}/>
            <div style={{flex:1, height:3, background:'#059669', borderRadius:2}}/>
            <div style={{flex:1, height:3, background:'#E2E8F0', borderRadius:2}}/>
          </div>
        </div>
        <div style={{background:'#fff', borderRadius:10, padding:8, border:'1px solid #E2E8F0', fontSize:10}}>
          <div style={{display:'flex', justifyContent:'space-between'}}>
            <span style={{color:'#00A651', fontWeight:700}}>■</span>
            <span style={{fontWeight:700}}>פרטנר</span>
          </div>
          <div style={{display:'flex', gap:2, marginTop:6}}>
            <div style={{flex:1, height:3, background:'#059669', borderRadius:2}}/>
            <div style={{flex:1, height:3, background:'#059669', borderRadius:2}}/>
            <div style={{flex:1, height:3, background:'#059669', borderRadius:2}}/>
          </div>
        </div>
      </div>
    </div>
    <div style={{width:'100%', textAlign:'center'}}>
      <h1 style={{fontSize:22, fontWeight:700, margin:'0 0 10px', color:'#0F172A'}}>הכסף שלך מחכה,<br/>אנחנו נמצא אותו בשבילך</h1>
      <p style={{fontSize:13, color:'#334155', lineHeight:1.6, margin:'0 0 18px'}}>
        האפליקציה עוקבת אחר תביעות ייצוגיות חדשות ומתריעה כשאתה זכאי לפיצוי. פשוט בחר את החברות והשירותים שאתה משתמש בהם, ואנחנו נדאג על כל שקל שמגיע לך.
      </p>
      <div style={{display:'flex', justifyContent:'center', gap:6, marginBottom:18}}>
        <span style={{width:6, height:6, borderRadius:999, background:'#94A3B8'}}/>
        <span style={{width:6, height:6, borderRadius:999, background:'#1A56DB'}}/>
        <span style={{width:6, height:6, borderRadius:999, background:'#94A3B8'}}/>
      </div>
      <Button size="lg" onClick={onStart} style={{width:'100%'}}>כניסה</Button>
    </div>
  </div>
);

// ── Onboarding: Categories ──────────────────────────────────────────────────
const CAT_OPTIONS = ['מכולת','תקשורת','ביטוח','בנקאות','מסחר מקוון','שירותים','תחבורה','פארמה','שירותים דיגיטליים'];

const CategoriesScreen = ({ selected, onToggle, onNext }) => (
  <div style={{height:'100%', background:'#fff', display:'flex', flexDirection:'column', fontFamily:'Heebo, sans-serif'}}>
    <div style={{padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid rgba(148,163,184,0.12)'}}>
      <Pill color="#64748B" bg="#F1F5F9">1/3 שלב</Pill>
      <h2 style={{margin:0, fontSize:17, fontWeight:700}}>היכרות ראשונית</h2>
      <span style={{fontSize:20, color:'#64748B'}}>›</span>
    </div>
    <div style={{height:2, background:'#1A56DB', width:'33%'}}/>
    <div style={{flex:1, padding:'20px', overflowY:'auto'}}>
      <h1 style={{margin:'0 0 6px', fontSize:18, fontWeight:700, textAlign:'right'}}>בחר קטגוריות שמעניינות אותך</h1>
      <p style={{margin:'0 0 20px', fontSize:13, color:'#64748B', textAlign:'right', lineHeight:1.5}}>
        בכדי שנוכל לעקוב אחר תביעות בתחומים שבחרת ולעדכן אותך!
      </p>
      <div style={{display:'flex', flexWrap:'wrap', gap:8, justifyContent:'flex-start'}}>
        {CAT_OPTIONS.map(c => (
          <Chip key={c} selected={selected.has(c)} onClick={()=>onToggle(c)}>{c}</Chip>
        ))}
      </div>
    </div>
    <div style={{padding:'12px 20px 24px', borderTop:'1px solid rgba(148,163,184,0.12)'}}>
      <Button size="lg" onClick={onNext} disabled={selected.size===0} style={{width:'100%'}}>המשך</Button>
    </div>
  </div>
);

// ── Home feed ───────────────────────────────────────────────────────────────
const SETTLEMENTS = [
  { id:1, brand:'שופרסל', title:'שופרסל — עיגול יתר במחירי מבצע',
    desc:'לקוחות שופרסל שחויבו במחירים גבוהים ממחירי המבצע בתקופה 01/2023–09/2024 עשויים להיות זכאים להחזר.',
    min:100, max:300, deadline:'31.12.2025', strong:true, status:'משלם' },
  { id:2, brand:'פרטנר', title:'פרטנר — חיוב עמלת ניתוק',
    desc:'לקוחות פרטנר שחויבו בעמלת ניתוק בתקופה 07/2023–03/2024 עשויים להיות זכאים לזיכוי בחשבון.',
    min:100, max:300, deadline:'15.11.2025', strong:true, status:'משלם' },
  { id:3, brand:'בנק הפועלים', title:'בנק הפועלים — עמלות כפל',
    desc:'לקוחות שחויבו בעמלות כפל בחשבון עו"ש פעיל בין השנים 2022–2024.',
    min:200, max:800, deadline:'05.01.2026', strong:false, status:'פעיל' },
];

const HomeScreen = ({ onOpenSettlement, onOpenConsultation }) => {
  const [filter, setFilter] = React.useState('ALL');
  return (
    <div style={{height:'100%', background:'#F0F4F8', overflowY:'auto', paddingBottom:90}}>
      <div style={{background:'linear-gradient(180deg, #C8DDF5 0%, #E4EDF9 50%, #F0F4F8 100%)', padding:'16px 20px 14px'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14}}>
          <Button size="sm" variant="primary" icon={<span>⚖️</span>} onClick={onOpenConsultation}>ייעוץ משפטי</Button>
          <h1 style={{margin:0, fontSize:22, fontWeight:700}}>היי דניאל!</h1>
        </div>
        <div style={{background:'#fff', borderRadius:14, padding:'12px 14px', display:'flex', alignItems:'center', gap:8, border:'1px solid rgba(148,163,184,0.15)'}}>
          <span style={{color:'#94A3B8', fontSize:16}}>🔍</span>
          <span style={{color:'#94A3B8', fontSize:14}}>חיפוש חופשי...</span>
        </div>
      </div>
      <div style={{display:'flex', gap:6, padding:'12px 20px 4px', overflowX:'auto'}}>
        {[['ALL','הכל','💰'],['telecom','תקשורת','📱'],['banks','בנקים','🏦'],['retail','קמעונאות','🛒']].map(([k,l,i]) => (
          <Pill key={k} active={filter===k} color="#1A56DB" icon={i}>
            <span onClick={()=>setFilter(k)} style={{cursor:'pointer'}}>{l}</span>
          </Pill>
        ))}
      </div>
      <h2 style={{margin:'16px 20px 10px', fontSize:16, fontWeight:700, textAlign:'right'}}>התאמות חדשות בשבילך</h2>
      <div style={{padding:'0 16px', display:'flex', flexDirection:'column', gap:12}}>
        {SETTLEMENTS.map(s => (
          <Card key={s.id} onClick={()=>onOpenSettlement(s)}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8, gap:10}}>
              <BrandLogo name={s.brand} color={brandColor(s.brand)}/>
              <div style={{flex:1}}>
                <h3 style={{margin:0, fontSize:14, fontWeight:700, textAlign:'right', lineHeight:1.4}}>{s.title}</h3>
              </div>
              <span style={{color:'#94A3B8', fontSize:16}}>⋯</span>
            </div>
            <div style={{display:'flex', gap:6, marginBottom:10, flexDirection:'row-reverse', justifyContent:'flex-end'}}>
              {s.strong && <Badge color="#059669">התאמה חזקה</Badge>}
              <Badge color="#64748B">{s.status}</Badge>
            </div>
            <p style={{margin:'0 0 12px', fontSize:13, color:'#334155', textAlign:'right', lineHeight:1.55}}>{s.desc}</p>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
              <span style={{fontFamily:'JetBrains Mono, monospace', fontWeight:700, fontSize:15, color:'#DC2626', direction:'ltr'}}>₪ {s.max} - {s.min}</span>
              <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:12, color:'#1A56DB'}}>{s.deadline}</span>
            </div>
            <Button variant="primary" size="md" style={{width:'100%'}}>בדיקת זכאות</Button>
          </Card>
        ))}
      </div>
    </div>
  );
};

// ── Settlement detail ──────────────────────────────────────────────────────
const SettlementDetail = ({ settlement, onBack, onSubmit }) => {
  const s = settlement || SETTLEMENTS[0];
  return (
    <div style={{height:'100%', background:'#F0F4F8', overflowY:'auto', paddingBottom:90}}>
      <div style={{background:'#fff', padding:'16px 20px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid rgba(148,163,184,0.12)'}}>
        <h2 style={{flex:1, margin:0, fontSize:17, fontWeight:700, textAlign:'right'}}>פרטי פשרה</h2>
        <button onClick={onBack} style={{background:'transparent', border:0, fontSize:22, color:'#0F172A', cursor:'pointer'}}>›</button>
      </div>
      <Card style={{margin:16}}>
        <div style={{display:'flex', alignItems:'flex-start', gap:12, marginBottom:12}}>
          <BrandLogo name={s.brand} color={brandColor(s.brand)}/>
          <div style={{flex:1, textAlign:'right'}}>
            <h1 style={{margin:'0 0 4px', fontSize:17, fontWeight:700}}>{s.title}</h1>
            <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:11, color:'#64748B'}}>case 12345-24-7</span>
          </div>
        </div>
        <div style={{display:'flex', justifyContent:'space-between', padding:'12px 0', borderTop:'1px solid rgba(148,163,184,0.12)'}}>
          <div><div style={{fontSize:11, color:'#64748B', marginBottom:2}}>טווח פיצוי</div><div style={{fontFamily:'JetBrains Mono, monospace', fontWeight:700, fontSize:16, color:'#059669', direction:'ltr'}}>₪{s.max}–{s.min}</div></div>
          <div><div style={{fontSize:11, color:'#64748B', marginBottom:2}}>מועד אחרון</div><div style={{fontFamily:'JetBrains Mono, monospace', fontWeight:700, fontSize:15, color:'#DC2626'}}>{s.deadline}</div></div>
        </div>
      </Card>

      <Card style={{margin:'0 16px 12px', borderLeft:'4px solid #059669', background:'rgba(5,150,105,0.06)'}}>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
          <span style={{fontSize:20}}>📋</span>
          <h3 style={{margin:0, fontSize:15, fontWeight:700, color:'#059669'}}>יש למלא טופס תביעה</h3>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8, flexDirection:'row-reverse'}}>
          <span style={{fontSize:11, color:'#64748B', minWidth:60}}>87% ודאות</span>
          <div style={{flex:1, height:4, background:'rgba(0,0,0,0.08)', borderRadius:999, direction:'ltr'}}>
            <div style={{width:'87%', height:'100%', background:'#059669', borderRadius:999, float:'right'}}/>
          </div>
        </div>
        <p style={{margin:'0 0 8px', fontSize:13, color:'#334155', textAlign:'right', lineHeight:1.55}}>
          קנית בשופרסל בתקופה הרלוונטית וחויבת במחיר גבוה ממה שהופיע במבצע. תצטרך למלא טופס קצר ולצרף קבלה.
        </p>
      </Card>

      <div style={{padding:'0 16px 16px', display:'flex', gap:8, flexDirection:'column'}}>
        <Button variant="primary" size="lg" onClick={onSubmit} style={{width:'100%'}}>מלא טופס תביעה</Button>
        <Button variant="secondary" size="md" style={{width:'100%'}}>שמור — הגש לי תזכורת</Button>
      </div>
    </div>
  );
};

// ── Claims list ────────────────────────────────────────────────────────────
const CLAIMS = [
  { brand:'שופרסל', title:'שופרסל — עיגול יתר במחירי מבצע', status:'בבדיקה', progress:[1,1,1,0,0],
    sub:'ממתין לאימות', steps:['הבקשה הוגשה בהצלחה','מסמכים תחת בדיקה','ממתין לאימות'] },
  { brand:'פרטנר', title:'פרטנר — חיוב עמלת ניתוק', status:'אושר', progress:[1,1,1,1,1],
    sub:'התביעה אושרה! — ממתין לתשלום', steps:['הבקשה הוגשה בהצלחה','מסמכים תחת בדיקה','התביעה אושרה לפיצוי 150₪','ממתין לתשלום'] },
];

const ClaimsScreen = () => (
  <div style={{height:'100%', background:'#F0F4F8', overflowY:'auto', paddingBottom:90}}>
    <div style={{padding:'16px 20px 8px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
      <button style={{width:36, height:36, borderRadius:10, background:'#fff', border:'1px solid rgba(148,163,184,0.15)', cursor:'pointer', fontSize:16}}>⤓</button>
      <h1 style={{margin:0, fontSize:22, fontWeight:700}}>תביעות</h1>
    </div>
    <div style={{display:'flex', gap:6, padding:'10px 20px', overflowX:'auto'}}>
      {['הכל','בבדיקה','אושר','שולם'].map((l,i) => (
        <button key={l} style={{padding:'7px 16px', borderRadius:10, background: i===0 ? '#EEF3FD':'#fff', border: i===0?'1.5px solid #1A56DB':'1px solid rgba(148,163,184,0.3)', color: i===0?'#1A56DB':'#0F172A', fontWeight:500, fontSize:13, fontFamily:'Heebo', cursor:'pointer'}}>{l}</button>
      ))}
    </div>
    <div style={{padding:'4px 16px', display:'flex', flexDirection:'column', gap:12}}>
      {CLAIMS.map((c,i) => (
        <Card key={i}>
          <div style={{display:'flex', alignItems:'flex-start', gap:10, marginBottom:8, flexDirection:'row-reverse'}}>
            <BrandLogo name={c.brand} color={brandColor(c.brand)}/>
            <div style={{flex:1, textAlign:'right'}}>
              <h3 style={{margin:'0 0 4px', fontSize:14, fontWeight:700}}>{c.title}</h3>
              <span style={{fontSize:12, color:'#059669', fontWeight:500}}>{c.sub}</span>
            </div>
            <span style={{color:'#94A3B8'}}>⋯</span>
          </div>
          <div style={{display:'flex', gap:3, marginBottom:10}}>
            {c.progress.map((p,j) => (
              <div key={j} style={{flex:1, height:4, borderRadius:999, background: p ? '#059669' : '#E2E8F0'}}/>
            ))}
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:4, marginBottom:10}}>
            {c.steps.map((st,j) => (
              <div key={j} style={{display:'flex', gap:6, alignItems:'center', flexDirection:'row-reverse', fontSize:12, color:'#334155'}}>
                <span style={{color: j<c.progress.filter(Boolean).length-1 ? '#059669':'#94A3B8'}}>
                  {j<c.progress.filter(Boolean).length-1 ? '✓' : '○'}
                </span>
                <span>{st}</span>
              </div>
            ))}
          </div>
          <div style={{display:'flex', gap:8}}>
            <Button variant={c.status==='אושר'?'success':'primary'} size="sm" style={{flex:1}}>{c.status==='אושר'?'קבל':'טפל'}</Button>
            <Button variant="secondary" size="sm" style={{flex:1}}>פרטים</Button>
          </div>
        </Card>
      ))}
    </div>
  </div>
);

// ── Notifications ──────────────────────────────────────────────────────────
const NOTIFS = [
  { tag:'יייתכנות', time:'לפני שעתיים', title:'נמצאה התאמה חדשה', body:'ייתכן שמגיע לך פיצוי מ-שופרסל. בדקו זכאות.', icon:'☀️', color:'#D97706', unread:true, group:'היום' },
  { tag:'תזכורת', time:'לפני שעתיים', title:'מועד אחרון מתקרב', body:'נותרו 3 ימים להגיש בקשה בתיק פרטנר...', icon:'📅', color:'#1A56DB', unread:true, group:'היום' },
  { tag:'עדכון סטטוס', time:'15:40', title:'שופרסל', body:'התביעה שלך בעניין שופרסל עברה לשלב...', icon:'🔎', color:'#64748B', unread:false, group:'אתמול' },
];

const NotificationsScreen = () => (
  <div style={{height:'100%', background:'#F0F4F8', overflowY:'auto', paddingBottom:90}}>
    <div style={{padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', background:'#fff', borderBottom:'1px solid rgba(148,163,184,0.12)'}}>
      <button style={{width:36, height:36, borderRadius:10, background:'#F1F5F9', border:0, cursor:'pointer', fontSize:14}}>⚙</button>
      <h1 style={{margin:0, fontSize:22, fontWeight:700}}>הודעות</h1>
    </div>
    {['היום','אתמול'].map(group => (
      <div key={group}>
        <h3 style={{margin:'16px 20px 8px', fontSize:11, color:'#64748B', fontWeight:500, textAlign:'right'}}>{group}</h3>
        {NOTIFS.filter(n=>n.group===group).map((n,i) => (
          <div key={i} style={{background:'#fff', margin:'0 16px 8px', padding:14, borderRadius:14, display:'flex', gap:10, alignItems:'flex-start', flexDirection:'row-reverse', border:'1px solid rgba(148,163,184,0.1)'}}>
            {n.unread && <span style={{width:7, height:7, borderRadius:999, background:'#1A56DB', marginTop:6, flexShrink:0}}/>}
            <div style={{flex:1, textAlign:'right'}}>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4, flexDirection:'row-reverse', justifyContent:'flex-end'}}>
                <span style={{fontSize:11, color:n.color, fontWeight:600}}>{n.tag}</span>
                <span style={{fontSize:11, color:'#64748B'}}>· {n.time}</span>
              </div>
              <h4 style={{margin:'0 0 3px', fontSize:14, fontWeight:700}}>{n.title}</h4>
              <p style={{margin:0, fontSize:12, color:'#64748B', lineHeight:1.5}}>{n.body}</p>
            </div>
            <div style={{width:36, height:36, borderRadius:10, background:'#fff', border:'1px solid rgba(148,163,184,0.2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0}}>{n.icon}</div>
          </div>
        ))}
      </div>
    ))}
    <div style={{textAlign:'center', padding:16}}>
      <span style={{fontSize:13, color:'#1A56DB', fontWeight:500}}>סמן הכל כנקרא</span>
    </div>
  </div>
);

// ── Profile ────────────────────────────────────────────────────────────────
const ProfileScreen = () => (
  <div style={{height:'100%', overflowY:'auto', paddingBottom:90}}>
    <div style={{background:'linear-gradient(180deg, #89B4E8 0%, #C8DDF5 70%, #F0F4F8 100%)', padding:'20px 20px 24px', textAlign:'center'}}>
      <div style={{width:84, height:84, borderRadius:999, background:'#fff', margin:'0 auto 10px', border:'3px solid #fff', boxShadow:'0 4px 12px rgba(0,0,0,0.1)', backgroundImage:'linear-gradient(135deg,#F59E0B,#EF4444)', position:'relative'}}>
        <div style={{position:'absolute', bottom:-2, left:-2, width:26, height:26, borderRadius:999, background:'#1A56DB', border:'2px solid #fff', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:11}}>✎</div>
      </div>
      <h1 style={{margin:'0 0 2px', fontSize:20, fontWeight:700}}>דניאל מישצ'נקו</h1>
      <div style={{fontFamily:'JetBrains Mono, monospace', fontSize:12, color:'#334155'}}>054-1234567</div>
    </div>
    <div style={{background:'#fff', margin:'0 16px 12px', borderRadius:16, padding:14, display:'flex', alignItems:'center', gap:12, flexDirection:'row-reverse', border:'1px solid rgba(148,163,184,0.1)'}}>
      <div style={{width:44, height:44, borderRadius:12, background:'linear-gradient(135deg,#1A56DB,#3B82F6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20}}>👑</div>
      <div style={{flex:1, textAlign:'right'}}>
        <h3 style={{margin:'0 0 2px', fontSize:14, fontWeight:700}}>שדרג למנוי פרימיום</h3>
        <div style={{display:'flex', alignItems:'center', gap:6, justifyContent:'flex-end'}}>
          <Badge color="#059669">שדרג</Badge>
          <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:12, color:'#334155'}}>12.90₪/חודש</span>
        </div>
      </div>
    </div>
    {[
      { title:'תשלומים וארנק', items:['אפשרויות תשלום','היסטוריית תשלומים'] },
      { title:'הגדרות חשבון', items:['פרטי חשבון','התחברות ואבטחה'] },
      { title:'העדפות והתראות', items:['העדפות מערכת'] },
    ].map(g => (
      <div key={g.title} style={{background:'#fff', margin:'0 16px 12px', borderRadius:16, overflow:'hidden', border:'1px solid rgba(148,163,184,0.1)'}}>
        <h3 style={{margin:0, padding:'12px 16px 8px', fontSize:12, color:'#64748B', fontWeight:500, textAlign:'right'}}>{g.title}</h3>
        {g.items.map((it,i) => (
          <div key={it} style={{padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', borderTop: i>0?'1px solid rgba(148,163,184,0.08)':'none'}}>
            <span style={{color:'#94A3B8', fontSize:16}}>‹</span>
            <span style={{fontSize:14, color:'#0F172A'}}>{it}</span>
          </div>
        ))}
      </div>
    ))}
  </div>
);

// ── Legal consultation (chat) ──────────────────────────────────────────────
const LegalChat = ({ onBack }) => (
  <div style={{height:'100%', background:'#F0F4F8', display:'flex', flexDirection:'column'}}>
    <div style={{background:'#fff', padding:'16px 20px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid rgba(148,163,184,0.12)', justifyContent:'space-between'}}>
      <div>
        <h2 style={{margin:0, fontSize:17, fontWeight:700}}>ייעוץ משפטי</h2>
        <div style={{fontSize:11, color:'#D97706', fontWeight:600}}>מצב: חיזוק תיק · STRENGTHEN</div>
      </div>
      <button onClick={onBack} style={{background:'transparent', border:0, fontSize:22, cursor:'pointer'}}>›</button>
    </div>
    <div style={{flex:1, padding:16, overflowY:'auto', display:'flex', flexDirection:'column', gap:10}}>
      <div style={{alignSelf:'center', padding:'6px 12px', background:'#FEF3C7', color:'#D97706', borderRadius:999, fontSize:11, fontWeight:500}}>
        תיק שופרסל · powerScore 52%
      </div>
      <div style={{alignSelf:'flex-end', maxWidth:'75%', padding:'10px 14px', background:'#fff', color:'#0F172A', border:'1px solid rgba(148,163,184,0.15)', borderRadius:'18px 18px 18px 4px', fontSize:14, lineHeight:1.5}}>
        שלום דניאל 👋 אני כאן כדי לעזור לך לחזק את התיק מול שופרסל. מהם הראיות שיש בידיך?
      </div>
      <div style={{alignSelf:'flex-start', maxWidth:'75%', padding:'10px 14px', background:'#1A56DB', color:'#fff', borderRadius:'18px 18px 4px 18px', fontSize:14, lineHeight:1.5}}>
        שילמתי על מבצע של 10 ש"ח וגבו ממני 14. יש לי צילום קבלה.
      </div>
      <div style={{alignSelf:'flex-end', maxWidth:'75%', padding:'10px 14px', background:'#fff', color:'#0F172A', border:'1px solid rgba(148,163,184,0.15)', borderRadius:'18px 18px 18px 4px', fontSize:14, lineHeight:1.5}}>
        מעולה — הצילום הוא ראיה חזקה. באיזו חנות ומתי בדיוק היה הקניה?
      </div>
      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        <Chip>לא זוכר בדיוק</Chip>
        <Chip>שבוע שעבר</Chip>
        <Chip>יש לי הקבלה</Chip>
      </div>
    </div>
    <div style={{padding:'10px 14px 20px', background:'#fff', borderTop:'1px solid rgba(148,163,184,0.12)', display:'flex', gap:8, alignItems:'center', flexDirection:'row-reverse'}}>
      <input placeholder="הקלד הודעה..." style={{flex:1, height:44, border:'1px solid rgba(148,163,184,0.25)', borderRadius:12, padding:'0 14px', fontFamily:'Heebo', fontSize:14, direction:'rtl', textAlign:'right', outline:'none'}}/>
      <button style={{width:44, height:44, borderRadius:12, background:'#1A56DB', border:0, color:'#fff', fontSize:18, cursor:'pointer'}}>↩</button>
    </div>
  </div>
);

Object.assign(window, { SplashScreen, CategoriesScreen, HomeScreen, SettlementDetail, ClaimsScreen, NotificationsScreen, ProfileScreen, LegalChat, SETTLEMENTS });
