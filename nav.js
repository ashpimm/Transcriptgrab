(function(){
  var _isPro=false;
  try{var pd=JSON.parse(localStorage.getItem('tg_pro')||'null');if(pd&&pd.subscriptionId&&pd.verifiedAt&&(Date.now()-pd.verifiedAt)<1800000)_isPro=true;}catch(e){}

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
    '.suite-nav-pro-area{display:flex;align-items:center;gap:8px;flex-shrink:0;}'+
    '@media(max-width:700px){.suite-nav-pro-area{display:none !important;}}';
  document.head.appendChild(css);

  var tryLink = _isPro
    ? '<a href="/app" class="suite-nav-link' + (path==='/app'?' active':'') + '">App</a>'
    : '<a href="/app" class="suite-nav-link' + (path==='/app'?' active':'') + '">Try Free</a>';

  var nav=document.createElement('nav');
  nav.className='suite-nav';
  nav.innerHTML=
    '<div class="suite-nav-inner">'+
      '<a href="/" class="suite-nav-brand">TranscriptGrab</a>'+
      '<div class="suite-nav-links">' + tryLink + '</div>'+
      '<div class="suite-nav-pro-area"></div>'+
    '</div>';

  document.body.insertBefore(nav,document.body.firstChild);
})();
