// pro.js — upgrade modal + checkout (delegates to TGUser from nav.js)
// Loaded on every page after nav.js
(function(){
  'use strict';

  window.TGPro = {
    isPro: function(){
      return window.TGUser && TGUser.isPro();
    },

    // ============================================
    // UPGRADE MODAL
    // ============================================
    showUpgradeModal: function(opts){
      if (document.getElementById('tg-upgrade-modal')) return;

      var variant = (opts && opts.variant) || '';
      var overlay = document.createElement('div');
      overlay.id = 'tg-upgrade-modal';

      var isSignedIn = window.TGUser && TGUser.isSignedIn();

      var title = 'Keep shipping content.';
      var subtitle = 'Pro gets you 20 carousels a month, watermark-free. Or grab a one-off credit pack — no subscription.';
      if (variant === 'limit') {
        title = 'You hit this month’s 20.';
        subtitle = 'Your Pro quota resets on your billing date. Need more right now? A credit pack keeps you posting.';
      } else if (!isSignedIn) {
        title = 'Your first carousel is free.';
        subtitle = 'Sign in, paste your app’s link, and post today. No card required.';
      }

      var plansHtml =
        '<div class="tg-modal-plans">' +
          (variant === 'limit' ? '' :
          '<button class="tg-modal-plan-btn tg-plan-pro" id="tg-buy-pro">' +
            '<span class="tg-plan-price">$9<small>/mo</small></span>' +
            '<span class="tg-plan-desc">Pro — 20 carousels a month, no watermark</span>' +
          '</button>') +
          '<button class="tg-modal-plan-btn" id="tg-buy-credits">' +
            '<span class="tg-plan-price">$5</span>' +
            '<span class="tg-plan-desc">8 carousels, no subscription, never expire</span>' +
          '</button>' +
        '</div>';

      var signinHtml = isSignedIn ? '' :
        '<a href="/api/auth/google" class="tg-modal-cta tg-google-btn" id="tg-signin-btn">' +
          '<svg style="width:18px;height:18px;margin-right:8px;" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>' +
          'Continue with Google' +
        '</a>' +
        '<div style="text-align:center;color:#9C9FA6;font-size:12px;margin:16px 0 0;font-weight:500;">or jump straight in</div>';

      overlay.innerHTML =
        '<div class="tg-modal-backdrop"></div>' +
        '<div class="tg-modal-card">' +
          '<h3 class="tg-modal-title">' + title + '</h3>' +
          '<p class="tg-modal-subtitle">' + subtitle + '</p>' +
          signinHtml +
          plansHtml +
          '<button class="tg-modal-dismiss" onclick="TGPro.hideUpgradeModal()">Maybe later</button>' +
        '</div>';

      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      overlay.querySelector('.tg-modal-backdrop').addEventListener('click', function(){ TGPro.hideUpgradeModal(); });

      function bindPlan(id, plan) {
        var btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('click', function() {
          btn.disabled = true;
          btn.querySelector('.tg-plan-desc').textContent = 'Redirecting…';
          if (window.TGUser && TGUser.isSignedIn()) {
            TGPro._checkout(plan);
          } else {
            window.location.href = '/api/auth/google?plan=' + plan;
          }
        });
      }
      bindPlan('tg-buy-pro', 'pro');
      bindPlan('tg-buy-credits', 'credits');
    },

    hideUpgradeModal: function(){
      var el = document.getElementById('tg-upgrade-modal');
      if (el) { el.remove(); document.body.style.overflow = ''; }
    },

    // ============================================
    // CHECKOUT
    // ============================================
    _checkout: async function(plan) {
      try {
        var r = await fetch('/api/checkout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: plan })
        });
        var d = await r.json();
        if (d.url) {
          window.location.href = d.url;
        } else if (d.auth_required) {
          TGPro.hideUpgradeModal();
          window.location.href = '/api/auth/google';
        } else {
          TGPro._showToast(d.error || 'Something went wrong');
          TGPro.hideUpgradeModal();
        }
      } catch(e) {
        TGPro._showToast('Connection error. Please try again.');
        TGPro.hideUpgradeModal();
      }
    },

    // ============================================
    // PAYMENT RETURN HANDLER
    // ============================================
    handlePaymentReturn: function(){
      var params = new URLSearchParams(window.location.search);
      var payment = params.get('payment');

      if (!payment) return;

      var ready = (window.TGUser && TGUser.ready) ? TGUser.ready : Promise.resolve(null);
      ready.then(function() {
        window.history.replaceState({}, '', window.location.pathname);

        if (payment === 'success') {
          TGPro._showToast('Payment successful!');
          if (window.TGUser) TGUser.refresh();
        } else if (payment === 'error') {
          TGPro._showToast('Payment could not be verified');
        } else if (payment === 'incomplete') {
          TGPro._showToast('Payment didn’t complete — you were not charged.');
        }
      });
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
    }
  };

  // ============================================
  // STYLES
  // ============================================
  var style = document.createElement('style');
  style.textContent =
    '.tg-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.75);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);z-index:1100;animation:tgFadeIn 0.2s ease;}' +
    '#tg-upgrade-modal{position:fixed;inset:0;z-index:1101;display:flex;align-items:center;justify-content:center;padding:24px;}' +
    '.tg-modal-card{background:#101114;border:1px solid rgba(255,255,255,0.12);border-radius:24px;padding:40px 36px;max-width:420px;width:100%;position:relative;z-index:1101;animation:tgSlideUp 0.3s cubic-bezier(.22,1,.36,1);box-shadow:0 30px 90px rgba(0,0,0,0.8);}' +
    '.tg-modal-title{font-size:24px;font-weight:700;letter-spacing:-0.02em;color:#F5F5F6;margin-bottom:8px;line-height:1.2;}' +
    '.tg-modal-subtitle{font-size:14px;color:#9C9FA6;line-height:1.55;}' +
    '.tg-modal-cta{display:flex;width:100%;padding:15px;background:#F5F5F6;color:#000;border:none;border-radius:999px;font-family:"Geist",sans-serif;font-size:15px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;margin-top:20px;transition:all 0.2s;align-items:center;justify-content:center;}' +
    '.tg-modal-cta:hover{background:#fff;transform:translateY(-1px);}' +
    '.tg-google-btn{background:#17191D;color:#F5F5F6;border:1px solid rgba(255,255,255,0.15);}' +
    '.tg-google-btn:hover{background:#1D2025;border-color:rgba(255,255,255,0.3);}' +
    '.tg-modal-plans{display:flex;flex-direction:column;gap:10px;margin-top:20px;}' +
    '.tg-modal-plan-btn{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;padding:16px 20px;background:#17191D;border:1px solid rgba(255,255,255,0.1);border-radius:16px;cursor:pointer;transition:all 0.2s;font-family:"Geist",sans-serif;color:#F5F5F6;text-align:left;}' +
    '.tg-modal-plan-btn:hover{border-color:rgba(255,255,255,0.35);background:#1D2025;}' +
    '.tg-modal-plan-btn:disabled{opacity:0.5;cursor:not-allowed;}' +
    '.tg-plan-pro{background:#F5F5F6;border-color:#F5F5F6;color:#000;}' +
    '.tg-plan-pro:hover{background:#fff;border-color:#fff;}' +
    '.tg-plan-price{font-size:20px;font-weight:800;letter-spacing:-0.03em;flex-shrink:0;}' +
    '.tg-plan-price small{font-size:13px;font-weight:500;opacity:0.6;}' +
    '.tg-plan-desc{font-size:13px;font-weight:500;opacity:0.75;}' +
    '.tg-modal-dismiss{display:block;width:100%;background:none;border:none;padding:14px;font-family:"Geist",sans-serif;font-size:13px;font-weight:500;color:#9C9FA6;cursor:pointer;text-align:center;transition:color 0.2s;margin-top:4px;}' +
    '.tg-modal-dismiss:hover{color:#F5F5F6;}' +
    '.tg-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#F5F5F6;color:#000;padding:12px 28px;border-radius:999px;font-family:"Geist",sans-serif;font-size:14px;font-weight:600;z-index:1200;opacity:0;transition:all 0.3s ease;pointer-events:none;box-shadow:0 12px 40px rgba(0,0,0,0.6);}' +
    '.tg-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}' +
    '@keyframes tgFadeIn{from{opacity:0}to{opacity:1}}' +
    '@keyframes tgSlideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}';
  document.head.appendChild(style);

  // ============================================
  // AUTO-INIT
  // ============================================
  TGPro.handlePaymentReturn();

  window.addEventListener('pageshow', function(e) {
    if (e.persisted) TGPro.hideUpgradeModal();
  });
})();
