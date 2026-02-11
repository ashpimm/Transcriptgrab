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

      var overlay = document.createElement('div');
      overlay.id = 'tg-upgrade-modal';

      // Always show pricing (no sign-in-first modal)
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

      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      overlay.querySelector('.tg-modal-backdrop').addEventListener('click', function(){ TGPro.hideUpgradeModal(); });

      // $5 click — always anonymous checkout, no sign-in needed
      var singleBtn = document.getElementById('tg-buy-single');
      if (singleBtn) {
        singleBtn.addEventListener('click', function() {
          singleBtn.disabled = true;
          singleBtn.querySelector('.tg-plan-desc').textContent = 'Redirecting...';
          window.location.href = '/api/checkout-single';
        });
      }
      // $49 click — if signed in, checkout; if not, OAuth with plan=pro
      var proBtn = document.getElementById('tg-buy-pro');
      if (proBtn) {
        proBtn.addEventListener('click', function() {
          proBtn.disabled = true;
          proBtn.querySelector('.tg-plan-desc').textContent = 'Redirecting...';
          if (window.TGUser && TGUser.isSignedIn()) {
            TGPro._checkout('pro');
          } else {
            window.location.href = '/api/auth/google?plan=pro';
          }
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
      var checkout = params.get('checkout');

      if (!payment && !checkout) return;

      // Wait for TGUser to be ready before processing
      var ready = (window.TGUser && TGUser.ready) ? TGUser.ready : Promise.resolve(null);
      ready.then(function() {
        window.history.replaceState({}, '', window.location.pathname);

        if (checkout === 'pro') {
          // Returned from OAuth with plan=pro — auto-trigger Pro checkout
          TGPro._showToast('Signed in! Redirecting to checkout...');
          setTimeout(function() {
            TGPro._checkout('pro');
          }, 500);
          return;
        }

        if (payment === 'single_success') {
          TGPro._showToast('Payment successful! You can generate one video.');
        } else if (payment === 'success') {
          TGPro._showToast('Payment successful!');
          if (window.TGUser) TGUser.refresh();
        } else if (payment === 'error') {
          TGPro._showToast('Payment could not be verified');
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
