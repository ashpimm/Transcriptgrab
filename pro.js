// pro.js — Pro subscription logic (delegates to TGUser from nav.js)
// Loaded on every page after nav.js
(function(){
  'use strict';

  // ============================================
  // PUBLIC API (backwards-compatible)
  // ============================================
  window.TGPro = {
    isPro: function(){
      return window.TGUser && TGUser.isPro();
    },

    getSubscriptionId: function(){
      // No longer stored client-side
      return null;
    },

    getCustomerEmail: function(){
      var u = window.TGUser && TGUser.get();
      return u ? u.email : null;
    },

    checkGate: function(callback){
      if (window.TGUser && TGUser.isPro()) {
        callback();
      } else {
        window.TGPro.showUpgradeModal();
      }
    },

    authHeaders: function(){
      // No longer needed — cookies handle auth
      return {};
    },

    // ============================================
    // UPGRADE MODAL
    // ============================================
    showUpgradeModal: function(){
      if (document.getElementById('tg-upgrade-modal')) return;

      var isSignedIn = window.TGUser && TGUser.isSignedIn();

      var overlay = document.createElement('div');
      overlay.id = 'tg-upgrade-modal';

      if (!isSignedIn) {
        // Not signed in — show sign-in prompt first
        overlay.innerHTML =
          '<div class="tg-modal-backdrop"></div>' +
          '<div class="tg-modal-card">' +
            '<div class="tg-modal-label">SIGN IN</div>' +
            '<h3 class="tg-modal-title">Sign in to continue</h3>' +
            '<p class="tg-modal-subtitle">Create a free account to unlock more features.</p>' +
            '<a href="/api/auth/google" class="tg-modal-cta tg-google-btn">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle;margin-right:8px;"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>' +
              'Sign in with Google' +
            '</a>' +
            '<button class="tg-modal-dismiss" onclick="TGPro.hideUpgradeModal()">Maybe later</button>' +
          '</div>';
      } else {
        // Signed in — show pricing
        overlay.innerHTML =
          '<div class="tg-modal-backdrop"></div>' +
          '<div class="tg-modal-card">' +
            '<div class="tg-modal-label">UPGRADE</div>' +
            '<h3 class="tg-modal-title">Get more content</h3>' +
            '<p class="tg-modal-subtitle">Choose a plan to keep generating.</p>' +
            '<div class="tg-modal-plans">' +
              '<button class="tg-modal-plan-btn tg-plan-single" id="tg-buy-single">' +
                '<span class="tg-plan-price">$5</span>' +
                '<span class="tg-plan-desc">One video</span>' +
              '</button>' +
              '<button class="tg-modal-plan-btn tg-plan-pro" id="tg-buy-pro">' +
                '<span class="tg-plan-price">$49<small>/mo</small></span>' +
                '<span class="tg-plan-desc">200 videos/month + bulk</span>' +
              '</button>' +
            '</div>' +
            '<button class="tg-modal-dismiss" onclick="TGPro.hideUpgradeModal()">Maybe later</button>' +
          '</div>';
      }

      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      overlay.querySelector('.tg-modal-backdrop').addEventListener('click', function(){ TGPro.hideUpgradeModal(); });

      // Bind checkout buttons
      var singleBtn = document.getElementById('tg-buy-single');
      if (singleBtn) {
        singleBtn.addEventListener('click', function() {
          singleBtn.disabled = true;
          singleBtn.querySelector('.tg-plan-desc').textContent = 'Redirecting...';
          TGPro._checkout('single');
        });
      }
      var proBtn = document.getElementById('tg-buy-pro');
      if (proBtn) {
        proBtn.addEventListener('click', function() {
          proBtn.disabled = true;
          proBtn.querySelector('.tg-plan-desc').textContent = 'Redirecting...';
          TGPro._checkout('pro');
        });
      }
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

      window.history.replaceState({}, '', window.location.pathname);

      if (payment === 'success') {
        TGPro._showToast('Payment successful! Generating...');
        // Refresh user data
        if (window.TGUser) TGUser.refresh();
      } else if (payment === 'auth_required') {
        TGPro._showToast('Please sign in first');
      } else if (payment === 'error') {
        TGPro._showToast('Payment could not be verified');
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
    }
  };

  // ============================================
  // STYLES
  // ============================================
  var style = document.createElement('style');
  style.textContent =
    '.tg-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;animation:tgFadeIn 0.2s ease;}' +
    '#tg-upgrade-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;}' +
    '.tg-modal-card{background:#fff;border-radius:20px;padding:40px 36px;max-width:420px;width:100%;position:relative;z-index:9999;animation:tgSlideUp 0.3s ease;box-shadow:0 24px 80px rgba(0,0,0,0.15);}' +
    '.tg-modal-label{font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#0071e3;margin-bottom:16px;}' +
    '.tg-modal-title{font-size:24px;font-weight:800;letter-spacing:-0.03em;color:#111;margin-bottom:8px;line-height:1.2;}' +
    '.tg-modal-subtitle{font-size:14px;color:#666;margin-bottom:20px;line-height:1.5;}' +
    '.tg-modal-cta{display:block;width:100%;padding:16px;background:#0071e3;color:#fff;border:none;border-radius:100px;font-family:"Outfit",sans-serif;font-size:15px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;margin-top:20px;transition:all 0.2s;}' +
    '.tg-modal-cta:hover{background:#0077ED;transform:translateY(-1px);box-shadow:0 8px 32px rgba(0,113,227,0.2);}' +
    '.tg-modal-cta:disabled{opacity:0.5;cursor:not-allowed;transform:none;box-shadow:none;}' +
    '.tg-google-btn{background:#fff;color:#111;border:1px solid #e8e8e8;display:flex;align-items:center;justify-content:center;}' +
    '.tg-google-btn:hover{background:#f5f5f5;box-shadow:0 4px 16px rgba(0,0,0,0.08);transform:translateY(-1px);}' +
    '.tg-modal-plans{display:flex;flex-direction:column;gap:12px;margin-top:20px;}' +
    '.tg-modal-plan-btn{display:flex;align-items:center;justify-content:space-between;width:100%;padding:18px 20px;background:#fafafa;border:1px solid #e8e8e8;border-radius:14px;cursor:pointer;transition:all 0.2s;font-family:"Outfit",sans-serif;}' +
    '.tg-modal-plan-btn:hover{border-color:#111;background:#fff;}' +
    '.tg-modal-plan-btn:disabled{opacity:0.5;cursor:not-allowed;}' +
    '.tg-plan-pro{background:#111;border-color:#111;color:#fff;}' +
    '.tg-plan-pro:hover{background:#333;border-color:#333;}' +
    '.tg-plan-price{font-size:20px;font-weight:800;letter-spacing:-0.03em;}' +
    '.tg-plan-price small{font-size:13px;font-weight:400;opacity:0.6;}' +
    '.tg-plan-desc{font-size:13px;font-weight:500;opacity:0.7;}' +
    '.tg-modal-dismiss{display:block;width:100%;background:none;border:none;padding:14px;font-family:"Outfit",sans-serif;font-size:13px;font-weight:500;color:#bbb;cursor:pointer;text-align:center;transition:color 0.2s;margin-top:4px;}' +
    '.tg-modal-dismiss:hover{color:#999;}' +
    '.tg-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#111;color:#fff;padding:12px 28px;border-radius:100px;font-family:"Outfit",sans-serif;font-size:14px;font-weight:600;z-index:10000;opacity:0;transition:all 0.3s ease;pointer-events:none;}' +
    '.tg-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}' +
    '@keyframes tgFadeIn{from{opacity:0}to{opacity:1}}' +
    '@keyframes tgSlideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}';
  document.head.appendChild(style);

  // ============================================
  // AUTO-INIT
  // ============================================
  TGPro.handlePaymentReturn();
})();
