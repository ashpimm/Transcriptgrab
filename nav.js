(function(){
  // ============================================
  // TGUser — global user state from server
  // ============================================
  var CACHE_KEY = 'tg_user_cache';
  var CACHE_TTL_MS = 5 * 60 * 1000;

  var _user = null;
  var _ready = false;
  var _readyCallbacks = [];

  try {
    var raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      var cached = JSON.parse(raw);
      if (cached && cached.t && (Date.now() - cached.t) < CACHE_TTL_MS) {
        _user = cached.u || null;
      }
    }
  } catch (e) { /* ignore */ }

  window.TGUser = {
    ready: new Promise(function(resolve) {
      _readyCallbacks.push(resolve);
    }),
    get: function() { return _user; },
    isPro: function() { return _user && _user.tier === 'pro'; },
    isSignedIn: function() { return !!_user; },
    refresh: function() { return fetchUser(); }
  };

  function resolveReady() {
    _ready = true;
    _readyCallbacks.forEach(function(fn) { fn(_user); });
    _readyCallbacks = [];
  }

  function writeCache(u) {
    try {
      if (u) localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), u: u }));
      else localStorage.removeItem(CACHE_KEY);
    } catch (e) { /* ignore */ }
  }

  function fetchUser() {
    return fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        _user = d.user || null;
        writeCache(_user);
        if (!_ready) resolveReady();
        renderNav();
        return _user;
      })
      .catch(function() {
        _user = null;
        writeCache(null);
        if (!_ready) resolveReady();
        renderNav();
        return null;
      });
  }

  // ============================================
  // STYLES
  // ============================================
  var css = document.createElement('style');
  css.textContent =
    '.suite-nav{background:rgba(0,0,0,0.7);-webkit-backdrop-filter:blur(18px) saturate(160%);backdrop-filter:blur(18px) saturate(160%);border-bottom:1px solid rgba(255,255,255,0.08);position:sticky;top:0;z-index:1000;font-family:"Geist",-apple-system,sans-serif;}' +
    '.suite-nav-inner{max-width:1160px;margin:0 auto;padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:64px;gap:8px;position:relative;}' +
    '.suite-nav-brand{font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#F5F5F6;text-decoration:none;flex-shrink:0;transition:opacity 0.2s;}' +
    '.suite-nav-brand::after{content:"_";color:#FF4D00;}' +
    '.suite-nav-brand:hover{opacity:.8;}' +
    '.suite-nav-links{display:flex;align-items:center;gap:2px;position:absolute;left:50%;transform:translateX(-50%);}' +
    '.suite-nav-link{font-size:13.5px;font-weight:500;color:#9C9FA6;text-decoration:none;padding:7px 14px;border-radius:999px;transition:all 0.2s;white-space:nowrap;}' +
    '.suite-nav-link:hover{color:#F5F5F6;background:rgba(255,255,255,0.05);}' +
    '.suite-nav-link.active{color:#F5F5F6;font-weight:600;background:rgba(255,255,255,0.08);}' +
    '.suite-nav-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}' +
    '.suite-nav-signin{font-size:13.5px;font-weight:600;color:#F5F5F6;text-decoration:none;padding:8px 18px;border:1px solid rgba(255,255,255,0.2);border-radius:999px;transition:all 0.2s;white-space:nowrap;cursor:pointer;background:none;font-family:"Geist",sans-serif;}' +
    '.suite-nav-signin:hover{border-color:#F5F5F6;background:rgba(255,255,255,0.05);}' +
    '.suite-nav-gopro{font-size:13px;font-weight:700;color:#000;background:#F5F5F6;text-decoration:none;padding:8px 18px;border-radius:999px;transition:all 0.2s;white-space:nowrap;}' +
    '.suite-nav-gopro:hover{background:#fff;transform:translateY(-1px);}' +
    '.suite-nav-avatar{width:28px;height:28px;border-radius:50%;object-fit:cover;cursor:pointer;}' +
    '.suite-nav-user{display:flex;align-items:center;gap:8px;position:relative;cursor:pointer;}' +
    '.suite-nav-username{font-size:13px;font-weight:500;color:#9C9FA6;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.suite-nav-dropdown{position:absolute;top:100%;right:0;margin-top:10px;background:rgba(16,17,20,0.95);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);border:1px solid rgba(255,255,255,0.1);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,0.7);min-width:200px;padding:8px;z-index:1001;display:none;}' +
    '.suite-nav-dropdown.show{display:block;}' +
    '.suite-nav-drop-item{display:block;width:100%;padding:10px 14px;font-family:"Geist",sans-serif;font-size:13px;font-weight:500;color:#C9CCD1;border:none;background:none;cursor:pointer;text-align:left;border-radius:10px;transition:all 0.15s;text-decoration:none;}' +
    '.suite-nav-drop-item:hover{background:rgba(255,255,255,0.06);color:#F5F5F6;}' +
    '.suite-nav-drop-muted{color:#9C9FA6;cursor:default;font-size:12px;font-family:"Geist Mono",monospace;}' +
    '.suite-nav-drop-muted:hover{background:none;color:#9C9FA6;}' +
    '@media(max-width:700px){.suite-nav-username{display:none !important;}.suite-nav-right .suite-nav-gopro{display:none !important;}}' +
    '@media(max-width:600px){.suite-nav-inner{padding:0 16px;}.suite-nav-brand{font-size:16px;}.suite-nav-link{padding:7px 10px;font-size:12.5px;}}';
  document.head.appendChild(css);

  // ============================================
  // RENDER NAV
  // ============================================
  var path = window.location.pathname.split('?')[0].split('#')[0].replace(/\.html$/, '');
  if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
  if (!path) path = '/';

  var nav = document.createElement('nav');
  nav.className = 'suite-nav';
  document.body.insertBefore(nav, document.body.firstChild);

  function usageLine(u) {
    if (u.tier === 'pro') {
      var line = (u.carouselsUsed || 0) + ' / ' + (u.carouselsLimit || 20) + ' carousels this month';
      if (u.credits > 0) line += ' · ' + u.credits + ' credits';
      return line;
    }
    if (u.credits > 0) return u.credits + ' credit' + (u.credits === 1 ? '' : 's') + ' left';
    return u.freeCarouselUsed ? 'free carousel used' : '1 free carousel waiting';
  }

  function renderNav() {
    var brandHref = _user ? '/create' : '/';

    var rightHtml = '';
    if (_user) {
      var avatarHtml = _user.picture
        ? '<img class="suite-nav-avatar" src="' + escapeAttr(_user.picture) + '" alt="" referrerpolicy="no-referrer">'
        : '<div class="suite-nav-avatar" style="background:#17191D;border:1px solid rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#F5F5F6;">' + (_user.name || _user.email || '?').charAt(0).toUpperCase() + '</div>';

      var goProHtml = _user.tier === 'pro' ? '' : '<a href="/#pricing" class="suite-nav-gopro">Go Pro</a>';

      rightHtml =
        '<div class="suite-nav-user" id="nav-user-area">' +
          avatarHtml +
          '<span class="suite-nav-username">' + escapeHtml(_user.name || _user.email || '') + '</span>' +
          goProHtml +
          '<div class="suite-nav-dropdown" id="nav-dropdown">' +
            '<div class="suite-nav-drop-item suite-nav-drop-muted">' + escapeHtml(_user.email || '') + '</div>' +
            '<div class="suite-nav-drop-item suite-nav-drop-muted">' + escapeHtml(usageLine(_user)) + '</div>' +
            '<a href="/account" class="suite-nav-drop-item" style="text-decoration:none;">Account</a>' +
            (_user.tier === 'pro'
              ? '<a href="/api/checkout" class="suite-nav-drop-item" style="text-decoration:none;">Manage subscription</a>'
              : '') +
            '<a href="/privacy" class="suite-nav-drop-item" style="text-decoration:none;font-size:12px;color:#9C9FA6;">Privacy</a>' +
            '<a href="/terms" class="suite-nav-drop-item" style="text-decoration:none;font-size:12px;color:#9C9FA6;">Terms</a>' +
            '<button class="suite-nav-drop-item" id="nav-signout-btn">Sign out</button>' +
          '</div>' +
        '</div>';
    } else {
      rightHtml =
        '<button class="suite-nav-signin" onclick="window.location.href=\'/api/auth/google\'">Sign in</button>' +
        '<a href="/#pricing" class="suite-nav-gopro">Go Pro</a>';
    }

    var linksHtml =
      '<a href="/feed" class="suite-nav-link' + (path === '/feed' ? ' active' : '') + '">Feed</a>' +
      '<a href="/create" class="suite-nav-link' + (path === '/create' ? ' active' : '') + '">Create</a>';

    nav.innerHTML =
      '<div class="suite-nav-inner">' +
        '<a href="' + brandHref + '" class="suite-nav-brand">Hooklab</a>' +
        '<div class="suite-nav-links">' + linksHtml + '</div>' +
        '<div class="suite-nav-right">' + rightHtml + '</div>' +
      '</div>';

    var userArea = document.getElementById('nav-user-area');
    var dropdown = document.getElementById('nav-dropdown');
    if (userArea && dropdown) {
      userArea.addEventListener('click', function(e) {
        e.stopPropagation();
        dropdown.classList.toggle('show');
      });
      document.addEventListener('click', function() {
        dropdown.classList.remove('show');
      });
    }

    var signoutBtn = document.getElementById('nav-signout-btn');
    if (signoutBtn) {
      signoutBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        fetch('/api/auth/me', { method: 'POST', credentials: 'same-origin' })
          .then(function() {
            _user = null;
            writeCache(null);
            renderNav();
            window.dispatchEvent(new CustomEvent('tg-signout'));
            if (window.location.pathname !== '/') {
              window.location.href = '/';
            }
          });
      });
    }
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================
  // SCROLL REVEAL — progressive enhancement only.
  // Elements marked [data-reveal] stay fully visible without JS;
  // here we hide-then-reveal them as they enter the viewport.
  // ============================================
  function initReveal() {
    var nodes = document.querySelectorAll('[data-reveal]');
    if (!nodes.length || !('IntersectionObserver' in window)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(en) {
        if (en.isIntersecting) {
          en.target.classList.add('rv-in');
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    nodes.forEach(function(n, i) {
      // already in view at load? leave it alone — no pop-in on first paint
      var r = n.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92) return;
      n.classList.add('rv');
      var d = parseInt(n.getAttribute('data-reveal'), 10);
      if (d) n.style.transitionDelay = (d * 70) + 'ms';
      io.observe(n);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReveal);
  } else {
    initReveal();
  }

  // Initial render (empty state) then fetch
  renderNav();
  fetchUser();
})();
