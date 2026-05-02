// Primitives.jsx — shared primitives (Button, Chip, Badge, Pill, Card, TabBar)
const Button = ({ children, variant='primary', size='md', onClick, disabled, icon }) => {
  const base = {
    display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8,
    fontFamily:'Heebo, sans-serif', fontWeight:600, letterSpacing:0.1,
    border:0, cursor: disabled ? 'default' : 'pointer', transition:'transform .15s',
    opacity: disabled ? 0.6 : 1,
  };
  const sizes = {
    sm: { height:36, padding:'0 14px', fontSize:13, borderRadius:12 },
    md: { height:48, padding:'0 22px', fontSize:15, borderRadius:16 },
    lg: { height:52, padding:'0 28px', fontSize:17, borderRadius:16 },
  };
  const variants = {
    primary:     { background:'#1A56DB', color:'#fff', boxShadow:'0 4px 12px rgba(26,86,219,0.20)' },
    secondary:   { background:'#fff',    color:'#0F172A', border:'1px solid rgba(148,163,184,0.3)' },
    ghost:       { background:'transparent', color:'#1A56DB' },
    destructive: { background:'#DC2626', color:'#fff', boxShadow:'0 4px 12px rgba(220,38,38,0.20)' },
    success:     { background:'#059669', color:'#fff', boxShadow:'0 4px 12px rgba(5,150,105,0.20)' },
  };
  return (
    <button onClick={!disabled ? onClick : undefined}
      style={{...base, ...sizes[size], ...variants[variant]}}>
      {icon}{children}
    </button>
  );
};

const Chip = ({ children, selected, onClick }) => (
  <button onClick={onClick} style={{
    padding: selected ? '9.5px 17px' : '10px 18px',
    borderRadius:12, fontFamily:'Heebo, sans-serif', fontWeight:500, fontSize:14,
    background: selected ? '#EEF3FD' : '#fff',
    color: selected ? '#1A56DB' : '#0F172A',
    border: selected ? '1.5px solid #1A56DB' : '1px solid rgba(148,163,184,0.3)',
    cursor:'pointer', transition:'all .15s',
  }}>{children}</button>
);

const Pill = ({ children, color='#64748B', bg, active, icon }) => (
  <span style={{
    display:'inline-flex', alignItems:'center', gap:6,
    padding:'6px 12px', borderRadius:999,
    fontFamily:'Heebo, sans-serif', fontWeight:500, fontSize:12,
    background: active ? color : (bg || '#F1F5F9'),
    color: active ? '#fff' : color,
    border: active ? 0 : `1px solid ${color}30`,
  }}>
    {icon && <span style={{fontSize:14}}>{icon}</span>}
    {children}
  </span>
);

const Badge = ({ children, color='#059669' }) => (
  <span style={{
    display:'inline-flex', alignItems:'center', gap:5,
    padding:'3px 9px', borderRadius:999,
    fontFamily:'Heebo', fontWeight:600, fontSize:11,
    background: `${color}1F`, color,
    border: `1px solid ${color}40`,
  }}>
    <span style={{width:5, height:5, borderRadius:999, background:color}}/>
    {children}
  </span>
);

const Card = ({ children, style, onClick, accent }) => (
  <div onClick={onClick} style={{
    background:'#fff', borderRadius:20, padding:16,
    border:'1px solid rgba(148,163,184,0.15)',
    boxShadow:'0 2px 8px rgba(100,116,139,0.06)',
    cursor: onClick ? 'pointer' : 'default',
    position:'relative', overflow:'hidden',
    ...style,
  }}>
    {accent && <div style={{position:'absolute', top:0, right:0, bottom:0, width:3, background:accent}}/>}
    {children}
  </div>
);

const BrandLogo = ({ name, color='#1A56DB' }) => {
  const initial = name ? name.charAt(0) : '?';
  return (
    <div style={{
      width:40, height:40, borderRadius:10, background:color,
      display:'flex', alignItems:'center', justifyContent:'center',
      color:'#fff', fontWeight:700, fontSize:14, flexShrink:0,
      fontFamily:'Heebo, sans-serif',
    }}>{initial}</div>
  );
};

const BRAND_COLORS = {
  'שופרסל':'#E31019', 'פרטנר':'#00A651', 'סלקום':'#FF6600',
  'פלאפון':'#0054A6', 'הוט':'#E4002B', 'בזק':'#003DA5',
  'רמי לוי':'#FFD700', 'בנק הפועלים':'#E30613', 'בנק לאומי':'#003DA5',
  'ביט':'#0066FF', 'אמזון':'#FF9900', 'גוגל פליי':'#4285F4',
  'כלל':'#003366', 'מכבי':'#006E3F', 'אלעל':'#002D82',
  'אפל':'#000', 'פייסבוק':'#1877F2',
};
const brandColor = (n) => BRAND_COLORS[n] || '#1A56DB';

const TabBar = ({ active, onChange }) => {
  const tabs = [
    { key:'profile', icon:'👤', label:'פרופיל' },
    { key:'notifications', icon:'✉️', label:'הודעות', badge:2 },
    { key:'claims', icon:'📄', label:'תביעות' },
    { key:'explore', icon:'🧭', label:'אקספלורר' },
    { key:'home', icon:'🏠', label:'בית' },
  ];
  return (
    <div style={{
      position:'absolute', bottom:0, left:0, right:0,
      height:84, paddingTop:8, paddingBottom:28,
      background:'rgba(255,255,255,0.88)', backdropFilter:'blur(20px)',
      display:'flex', justifyContent:'space-around',
      borderTop:'1px solid rgba(148,163,184,0.15)',
      zIndex:10,
    }}>
      {tabs.map(t => (
        <button key={t.key} onClick={()=>onChange(t.key)}
          style={{background:'transparent', border:0, display:'flex', flexDirection:'column',
                  alignItems:'center', gap:2, cursor:'pointer', position:'relative', padding:'4px 8px'}}>
          <div style={{
            width:36, height:36, borderRadius:11,
            background: active===t.key ? 'rgba(26,86,219,0.15)' : 'transparent',
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:19,
          }}>{t.icon}</div>
          <span style={{
            fontFamily:'Heebo', fontSize:10,
            color: active===t.key ? '#1A56DB' : '#94A3B8',
            fontWeight: active===t.key ? 600 : 500,
          }}>{t.label}</span>
          {t.badge && <span style={{
            position:'absolute', top:0, left:10, minWidth:16, height:16, borderRadius:8,
            background:'#DC2626', color:'#fff', fontSize:9, fontWeight:800,
            display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px',
          }}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
};

Object.assign(window, { Button, Chip, Pill, Badge, Card, BrandLogo, TabBar, brandColor });
