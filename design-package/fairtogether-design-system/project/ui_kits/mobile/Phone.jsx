// Phone.jsx — iPhone-style device frame for RTL mobile previews
const Phone = ({ children, label }) => (
  <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:8}}>
    <div style={{
      width: 390, height: 844, background:'#000',
      borderRadius: 52, padding: 12, boxShadow:'0 20px 40px rgba(15,23,42,0.25), 0 4px 8px rgba(15,23,42,0.15)',
      position:'relative', flexShrink:0,
    }}>
      <div style={{
        width:'100%', height:'100%', borderRadius: 40, overflow:'hidden',
        background:'#F0F4F8', position:'relative', direction:'rtl',
      }}>
        {/* Dynamic Island */}
        <div style={{
          position:'absolute', top:11, left:'50%', transform:'translateX(-50%)',
          width:120, height:34, background:'#000', borderRadius:20, zIndex:100,
        }}/>
        {/* Status bar */}
        <div style={{
          height:54, display:'flex', alignItems:'flex-end', justifyContent:'space-between',
          padding:'0 28px 8px', fontSize:15, fontWeight:600, color:'#0F172A', position:'relative', zIndex:50,
          direction:'ltr',
        }}>
          <span>9:41</span>
          <span style={{fontSize:12}}>● ● ● ●   ▲   ▮</span>
        </div>
        {/* Content */}
        <div style={{height:'calc(100% - 54px)', overflow:'hidden', position:'relative'}}>
          {children}
        </div>
      </div>
    </div>
    {label && <div style={{fontFamily:'JetBrains Mono, monospace', fontSize:11, color:'#64748B'}}>{label}</div>}
  </div>
);
window.Phone = Phone;
