// pro.js — Shared Pro subscription logic
// Loaded on every page after nav.js
(function(){
  'use strict';

  // ============================================
  // CONFIG
  // ============================================
  var STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/test_4gMeVfbs2d2n6yKbxtcAo04';
  var VERIFY_ENDPOINT = '/api/verify';
  var CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  // ============================================
  // STORAGE HELPERS
  // ============================================
  function getProData(){
    try { return JSON.parse(localStorage.getItem('tg_pro') || 'null'); } catch(e) { return null; }
  }
  function setProData(data){
    try { localStorage.setItem('tg_pro', JSON.stringify(data)); } catch(e) {}
  }
  function clearProData(){
    try { localStorage.removeItem('tg_pro'); } catch(e) {}
  }

  // ============================================
  // PUBLIC API
  // ============================================
  window.TGPro = {
    isPro: function(){
      var d = getProData();
      if(!d || !d.subscriptionId || !d.verifiedAt) return false;
      // Consider valid if verified within cache TTL
      return (Date.now() - d.verifiedAt) < CACHE_TTL;
    },

    getSubscriptionId: function(){
      var d = getProData();
      return d ? d.subscriptionId : null;
    },

    getCustomerEmail: function(){
      var d = getProData();
      return d ? d.customerEmail : null;
    },

    // Gate check — runs callback if Pro, shows upgrade modal if not
    checkGate: function(callback){
      if(window.TGPro.isPro()){
        callback();
      } else {
        window.TGPro.showUpgradeModal();
      }
    },

    // Inject subscription header into fetch options
    authHeaders: function(){
      var subId = window.TGPro.getSubscriptionId();
      return subId ? { 'x-subscription-id': subId } : {};
    },

    // ============================================
    // UPGRADE MODAL
    // ============================================
    showUpgradeModal: function(){
      if(document.getElementById('tg-upgrade-modal')) return;
      var overlay = document.createElement('div');
      overlay.id = 'tg-upgrade-modal';
      overlay.innerHTML =
        '<div class="tg-modal-backdrop"></div>' +
        '<div class="tg-modal-card">' +
          '<div class="tg-modal-label">PRO</div>' +
          '<h3 class="tg-modal-title">Unlock all AI tools</h3>' +
          '<ul class="tg-modal-features">' +
            '<li>Analyze: AI summaries & deep cleaning</li>' +
            '<li>Create: quotes, blogs, tweets & more</li>' +
            '<li>8 content formats</li>' +
            '<li>Bulk transcript downloads (up to 500)</li>' +
          '</ul>' +
          '<div class="tg-modal-price">$9.99<span>/month</span></div>' +
          '<a href="' + STRIPE_PAYMENT_LINK + '" class="tg-modal-cta">Upgrade Now</a>' +
          '<button class="tg-modal-restore" onclick="TGPro.showRestoreModal()">Already subscribed? Restore access</button>' +
          '<button class="tg-modal-dismiss" onclick="TGPro.hideUpgradeModal()">Maybe later</button>' +
        '</div>';
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      overlay.querySelector('.tg-modal-backdrop').addEventListener('click', function(){ TGPro.hideUpgradeModal(); });
    },

    hideUpgradeModal: function(){
      var el = document.getElementById('tg-upgrade-modal');
      if(el){ el.remove(); document.body.style.overflow = ''; }
    },

    // ============================================
    // RESTORE MODAL
    // ============================================
    showRestoreModal: function(){
      TGPro.hideUpgradeModal();
      if(document.getElementById('tg-restore-modal')) return;
      var overlay = document.createElement('div');
      overlay.id = 'tg-restore-modal';
      overlay.innerHTML =
        '<div class="tg-modal-backdrop"></div>' +
        '<div class="tg-modal-card">' +
          '<h3 class="tg-modal-title">Restore your subscription</h3>' +
          '<p class="tg-modal-subtitle">Enter the email you used at checkout.</p>' +
          '<input type="email" class="tg-modal-input" id="tg-restore-email" placeholder="you@example.com">' +
          '<div id="tg-restore-status" class="tg-modal-status"></div>' +
          '<button class="tg-modal-cta" id="tg-restore-btn" onclick="TGPro._doRestore()">Restore Access</button>' +
          '<button class="tg-modal-dismiss" onclick="TGPro.hideRestoreModal()">Cancel</button>' +
        '</div>';
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      overlay.querySelector('.tg-modal-backdrop').addEventListener('click', function(){ TGPro.hideRestoreModal(); });
    },

    hideRestoreModal: function(){
      var el = document.getElementById('tg-restore-modal');
      if(el){ el.remove(); document.body.style.overflow = ''; }
    },

    _doRestore: async function(){
      var email = document.getElementById('tg-restore-email').value.trim();
      var statusEl = document.getElementById('tg-restore-status');
      var btn = document.getElementById('tg-restore-btn');
      if(!email){
        statusEl.textContent = 'Please enter your email.';
        statusEl.className = 'tg-modal-status error';
        return;
      }
      btn.disabled = true; btn.textContent = 'Verifying...';
      statusEl.textContent = ''; statusEl.className = 'tg-modal-status';
      try {
        var r = await fetch(VERIFY_ENDPOINT + '?email=' + encodeURIComponent(email));
        var d = await r.json();
        if(d.verified && d.subscriptionId){
          setProData({ subscriptionId: d.subscriptionId, customerEmail: d.customerEmail || email, verifiedAt: Date.now() });
          TGPro.hideRestoreModal();
          TGPro.renderProStatus();
          TGPro._showToast('Pro access restored!');
        } else {
          statusEl.textContent = d.error || 'No active subscription found for this email.';
          statusEl.className = 'tg-modal-status error';
        }
      } catch(e){
        statusEl.textContent = 'Connection error. Please try again.';
        statusEl.className = 'tg-modal-status error';
      } finally {
        btn.disabled = false; btn.textContent = 'Restore Access';
      }
    },

    // ============================================
    // PAYMENT RETURN HANDLER
    // ============================================
    handlePaymentReturn: async function(){
      var params = new URLSearchParams(window.location.search);
      var sessionId = params.get('session_id');
      if(!sessionId || !sessionId.startsWith('cs_')) return false;

      // Clean URL immediately
      window.history.replaceState({}, '', window.location.pathname);

      try {
        var r = await fetch(VERIFY_ENDPOINT + '?session_id=' + encodeURIComponent(sessionId));
        var d = await r.json();
        if(d.verified && d.subscriptionId){
          setProData({ subscriptionId: d.subscriptionId, customerEmail: d.customerEmail || '', verifiedAt: Date.now() });
          TGPro.renderProStatus();
          TGPro._showToast('Welcome to Pro!');
          return true;
        }
      } catch(e) {
        console.error('Payment verification failed:', e);
      }
      return false;
    },

    // ============================================
    // NAV PRO STATUS
    // ============================================
    renderProStatus: function(){
      var navRight = document.querySelector('.suite-nav-pro-area');
      if(!navRight) return;
      if(TGPro.isPro()){
        navRight.innerHTML = '<span class="suite-nav-pro-badge">Pro</span>';
      } else {
        navRight.innerHTML = '<a href="/#pricing" class="suite-nav-pricing-link">Pricing</a><a href="' + STRIPE_PAYMENT_LINK + '" class="suite-nav-upgrade-btn">Upgrade</a>';
      }
    },

    // ============================================
    // TOAST
    // ============================================
    _showToast: function(msg){
      var toast = document.createElement('div');
      toast.className = 'tg-toast';
      toast.textContent = msg;
      document.body.appendChild(toast);
      requestAnimationFrame(function(){ toast.classList.add('show'); });
      setTimeout(function(){ toast.classList.remove('show'); setTimeout(function(){ toast.remove(); }, 300); }, 3000);
    },

    // ============================================
    // RE-VERIFY (background, called periodically)
    // ============================================
    reVerify: async function(){
      var d = getProData();
      if(!d || !d.subscriptionId) return;
      try {
        var subId = d.subscriptionId;
        var r = await fetch(VERIFY_ENDPOINT + '?subscription_id=' + encodeURIComponent(subId));
        var result = await r.json();
        if(result.verified){
          d.verifiedAt = Date.now();
          setProData(d);
        } else {
          clearProData();
          TGPro.renderProStatus();
        }
      } catch(e) {}
    }
  };

  // ============================================
  // STYLES
  // ============================================
  var style = document.createElement('style');
  style.textContent =
    /* Modal backdrop + card */
    '.tg-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;animation:tgFadeIn 0.2s ease;}' +
    '#tg-upgrade-modal,#tg-restore-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;}' +
    '.tg-modal-card{background:#fff;border-radius:20px;padding:40px 36px;max-width:420px;width:100%;position:relative;z-index:9999;animation:tgSlideUp 0.3s ease;box-shadow:0 24px 80px rgba(0,0,0,0.15);}' +
    '.tg-modal-label{font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#0071e3;margin-bottom:16px;}' +
    '.tg-modal-title{font-size:24px;font-weight:800;letter-spacing:-0.03em;color:#111;margin-bottom:8px;line-height:1.2;}' +
    '.tg-modal-subtitle{font-size:14px;color:#666;margin-bottom:20px;line-height:1.5;}' +
    '.tg-modal-features{list-style:none;margin:16px 0 24px;padding:0;}' +
    '.tg-modal-features li{padding:8px 0;font-size:14px;color:#666;display:flex;align-items:center;gap:10px;border-bottom:1px solid #f0f0f0;}' +
    '.tg-modal-features li:last-child{border-bottom:none;}' +
    '.tg-modal-features li::before{content:"";width:5px;height:5px;background:#0071e3;border-radius:50%;flex-shrink:0;}' +
    '.tg-modal-price{font-size:40px;font-weight:900;letter-spacing:-0.04em;color:#111;margin-bottom:4px;}' +
    '.tg-modal-price span{font-size:16px;font-weight:400;color:#999;}' +
    '.tg-modal-cta{display:block;width:100%;padding:16px;background:#0071e3;color:#fff;border:none;border-radius:100px;font-family:"Outfit",sans-serif;font-size:15px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;margin-top:20px;transition:all 0.2s;}' +
    '.tg-modal-cta:hover{background:#0077ED;transform:translateY(-1px);box-shadow:0 8px 32px rgba(0,113,227,0.2);}' +
    '.tg-modal-cta:disabled{opacity:0.5;cursor:not-allowed;transform:none;box-shadow:none;}' +
    '.tg-modal-restore{display:block;width:100%;background:none;border:none;padding:14px;font-family:"Outfit",sans-serif;font-size:13px;font-weight:500;color:#999;cursor:pointer;text-align:center;transition:color 0.2s;}' +
    '.tg-modal-restore:hover{color:#666;}' +
    '.tg-modal-dismiss{display:block;width:100%;background:none;border:none;padding:8px;font-family:"Outfit",sans-serif;font-size:13px;font-weight:500;color:#bbb;cursor:pointer;text-align:center;transition:color 0.2s;}' +
    '.tg-modal-dismiss:hover{color:#999;}' +
    '.tg-modal-input{width:100%;padding:14px 16px;background:#fafafa;border:1px solid #e8e8e8;border-radius:10px;font-family:"IBM Plex Mono",monospace;font-size:14px;color:#111;outline:none;transition:all 0.2s;}' +
    '.tg-modal-input:focus{border-color:#111;box-shadow:0 0 0 3px rgba(0,0,0,0.05);}' +
    '.tg-modal-status{font-size:13px;margin-top:8px;min-height:20px;}' +
    '.tg-modal-status.error{color:#ff3b30;}' +
    /* Toast */
    '.tg-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#111;color:#fff;padding:12px 28px;border-radius:100px;font-family:"Outfit",sans-serif;font-size:14px;font-weight:600;z-index:10000;opacity:0;transition:all 0.3s ease;pointer-events:none;}' +
    '.tg-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}' +
    /* Pro pill badge for nav */
    '.suite-nav-pro-pill{display:inline-block;font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:2px 6px;border-radius:100px;background:#0071e3;color:#fff;margin-left:4px;vertical-align:middle;position:relative;top:-1px;}' +
    /* Nav right area */
    '.suite-nav-pro-area{display:flex;align-items:center;gap:8px;flex-shrink:0;}' +
    '.suite-nav-pricing-link{font-size:13px;font-weight:500;color:#999;text-decoration:none;transition:color 0.2s;white-space:nowrap;}' +
    '.suite-nav-pricing-link:hover{color:#111;}' +
    '.suite-nav-upgrade-btn{font-size:12px;font-weight:600;color:#fff;background:#0071e3;text-decoration:none;padding:6px 16px;border-radius:100px;transition:all 0.2s;white-space:nowrap;}' +
    '.suite-nav-upgrade-btn:hover{background:#0077ED;transform:translateY(-1px);}' +
    '.suite-nav-pro-badge{font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#0071e3;padding:4px 12px;border:1px solid #0071e320;border-radius:100px;background:#0071e308;}' +
    /* Pro indicator near buttons */
    '.pro-required-tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#0071e3;margin-top:8px;}' +
    '.pro-required-tag::before{content:"";width:5px;height:5px;background:#0071e3;border-radius:50%;}' +
    /* Animations */
    '@keyframes tgFadeIn{from{opacity:0}to{opacity:1}}' +
    '@keyframes tgSlideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}';
  document.head.appendChild(style);

  // ============================================
  // AUTO-INIT
  // ============================================
  // Handle payment return (from Stripe checkout redirect)
  TGPro.handlePaymentReturn();

  // Render Pro status in nav once nav.js has run
  // nav.js runs synchronously before pro.js, so nav should exist
  setTimeout(function(){ TGPro.renderProStatus(); }, 0);

  // Background re-verify every 30 minutes if Pro
  if(TGPro.isPro()){
    TGPro.reVerify();
    setInterval(function(){ TGPro.reVerify(); }, CACHE_TTL);
  }
})();
