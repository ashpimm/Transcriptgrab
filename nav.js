(function(){
  var items=[
    {label:'Transcripts',href:'/transcripts'},
    {label:'Clean',href:'/clean',pro:true},
    {label:'Summary',href:'/summary',pro:true},
    {label:'Quotes',href:'/quotes',pro:true},
    {label:'Repurpose',href:'/repurpose',pro:true},
    {label:'Search',href:'/search'}
  ];

  var path=window.location.pathname.split('?')[0].split('#')[0].replace(/\.html$/,'');
  if(path.endsWith('/')&&path.length>1)path=path.slice(0,-1);
  if(!path)path='/';

  var css=document.createElement('style');
  css.textContent=
    '.suite-nav{background:#fff;border-bottom:1px solid #e8e8e8;padding:0 24px;position:relative;z-index:1000;font-family:"Outfit",-apple-system,sans-serif;}'+
    '.suite-nav-inner{max-width:800px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:52px;gap:8px;}'+
    '.suite-nav-brand{font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#999;text-decoration:none;flex-shrink:0;transition:color 0.2s;}'+
    '.suite-nav-brand:hover{color:#111;}'+
    '.suite-nav-links{display:flex;align-items:center;gap:2px;}'+
    '.suite-nav-link{font-size:13px;font-weight:500;color:#999;text-decoration:none;padding:6px 12px;border-radius:100px;transition:all 0.2s;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;}'+
    '.suite-nav-link:hover{color:#111;background:#f5f5f5;}'+
    '.suite-nav-link.active{color:#111;font-weight:600;background:#f5f5f5;}'+
    '.suite-nav-hamburger{display:none;background:none;border:none;cursor:pointer;padding:8px;color:#666;line-height:0;}'+
    '.suite-nav-mobile{display:none;position:absolute;top:52px;left:0;right:0;background:#fff;border-bottom:1px solid #e8e8e8;padding:8px 24px 16px;box-shadow:0 4px 16px rgba(0,0,0,0.06);z-index:999;}'+
    '.suite-nav-mobile.open{display:block;animation:navReveal 0.2s ease;}'+
    '.suite-nav-mobile a{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:500;color:#666;text-decoration:none;padding:12px 0;border-bottom:1px solid #f0f0f0;}'+
    '.suite-nav-mobile a:last-child{border-bottom:none;}'+
    '.suite-nav-mobile a:hover,.suite-nav-mobile a.active{color:#111;font-weight:600;}'+
    '@keyframes navReveal{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}'+
    '@media(max-width:700px){.suite-nav-links{display:none;}.suite-nav-hamburger{display:block;}.suite-nav-pro-area{display:none !important;}}';
  document.head.appendChild(css);

  var proPill='<span class="suite-nav-pro-pill" style="font-size:8px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:1px 5px;border-radius:100px;background:#0071e3;color:#fff;">PRO</span>';

  var linksHTML='';
  var mobileHTML='';
  for(var i=0;i<items.length;i++){
    var it=items[i];
    var isActive=(it.href==='/'&&path==='/')||(it.href!=='/'&&path===it.href);
    var pill=it.pro?proPill:'';
    linksHTML+='<a href="'+it.href+'" class="suite-nav-link'+(isActive?' active':'')+'">'+it.label+pill+'</a>';
    mobileHTML+='<a href="'+it.href+'"'+(isActive?' class="active"':'')+'>'+it.label+(it.pro?' '+proPill:'')+'</a>';
  }

  var nav=document.createElement('nav');
  nav.className='suite-nav';
  nav.innerHTML=
    '<div class="suite-nav-inner">'+
      '<a href="/" class="suite-nav-brand">TranscriptGrab</a>'+
      '<div class="suite-nav-links">'+linksHTML+'</div>'+
      '<div class="suite-nav-pro-area"></div>'+
      '<button class="suite-nav-hamburger" aria-label="Menu">'+
        '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/></svg>'+
      '</button>'+
    '</div>'+
    '<div class="suite-nav-mobile">'+mobileHTML+'</div>';

  document.body.insertBefore(nav,document.body.firstChild);

  var hamburger=nav.querySelector('.suite-nav-hamburger');
  var mobile=nav.querySelector('.suite-nav-mobile');
  hamburger.addEventListener('click',function(){
    mobile.classList.toggle('open');
  });
  document.addEventListener('click',function(e){
    if(!nav.contains(e.target)){mobile.classList.remove('open');}
  });
})();
