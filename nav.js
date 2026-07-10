(function(){
  // ============================================
  // TGUser — global user state from server
  // ============================================
  var CACHE_KEY = 'tg_user_cache';
  var CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — short enough to stay fresh-ish, long enough to kill flash

  var _user = null;
  var _ready = false;
  var _readyCallbacks = [];

  // Hydrate from cache synchronously so first paint is correct
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
    '.suite-nav{background:rgba(11,14,17,0.72);-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);border-bottom:1px solid #272E37;position:sticky;top:0;z-index:1000;font-family:"Outfit",-apple-system,sans-serif;}' +
    '.suite-nav-inner{max-width:1200px;margin:0 auto;padding:0 40px;display:flex;align-items:center;justify-content:space-between;height:60px;gap:8px;position:relative;}' +
    '.suite-nav-brand{font-family:"Bricolage Grotesque","Outfit",sans-serif;font-size:19px;font-weight:800;letter-spacing:-0.03em;color:#F2F3EF;text-decoration:none;flex-shrink:0;transition:color 0.2s;}' +
    '.suite-nav-brand::after{content:"_";color:#FF4D00;}' +
    '.suite-nav-brand:hover{color:#FF4D00;}' +
    '.suite-nav-links{display:flex;align-items:center;gap:2px;position:absolute;left:50%;transform:translateX(-50%);}' +
    '.suite-nav-link{font-size:13px;font-weight:500;color:#969DA7;text-decoration:none;padding:6px 12px;border-radius:100px;transition:all 0.2s;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;}' +
    '.suite-nav-link:hover{color:#F2F3EF;background:rgba(255,255,255,0.05);}' +
    '.suite-nav-link.active{color:#F2F3EF;font-weight:600;background:rgba(255,255,255,0.06);}' +
    '.suite-nav-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}' +
    '.suite-nav-signin{font-size:13px;font-weight:600;color:#F2F3EF;text-decoration:none;padding:6px 16px;border:1px solid #333B45;border-radius:100px;transition:all 0.2s;white-space:nowrap;cursor:pointer;background:none;font-family:"Outfit",sans-serif;}' +
    '.suite-nav-signin:hover{border-color:#F2F3EF;background:rgba(255,255,255,0.04);}' +
    '.suite-nav-avatar{width:28px;height:28px;border-radius:50%;object-fit:cover;cursor:pointer;}' +
    '.suite-nav-user{display:flex;align-items:center;gap:8px;position:relative;}' +
    '.suite-nav-username{font-size:13px;font-weight:500;color:#969DA7;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.suite-nav-pro-badge{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#FF4D00;padding:2px 8px;border:1px solid #FF4D0055;border-radius:100px;background:rgba(255,77,0,0.10);}' +
    '.suite-nav-gopro{font-size:12px;font-weight:700;color:#fff;background:#FF4D00;text-decoration:none;padding:7px 16px;border-radius:100px;transition:all 0.2s;white-space:nowrap;box-shadow:0 6px 18px -8px rgba(255,77,0,0.7);}' +
    '.suite-nav-gopro:hover{background:#FF6A2B;transform:translateY(-1px);}' +
    '.suite-nav-dropdown{position:absolute;top:100%;right:0;margin-top:8px;background:rgba(20,25,31,0.92);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);border:1px solid #272E37;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,0.6);min-width:180px;padding:8px;z-index:1001;display:none;}' +
    '.suite-nav-dropdown.show{display:block;}' +
    '.suite-nav-drop-item{display:block;width:100%;padding:10px 14px;font-family:"Outfit",sans-serif;font-size:13px;font-weight:500;color:#C7CDD4;border:none;background:none;cursor:pointer;text-align:left;border-radius:8px;transition:all 0.15s;text-decoration:none;}' +
    '.suite-nav-drop-item:hover{background:rgba(255,255,255,0.05);color:#F2F3EF;}' +
    '@media(max-width:700px){.suite-nav-username{display:none !important;}.suite-nav-right .suite-nav-gopro{display:none !important;}}' +
    '@media(max-width:600px){.suite-nav-inner{padding:0 16px;}.suite-nav-brand{font-size:16px;}.suite-nav-link{padding:6px 8px;font-size:12px;}}';
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

  function renderNav() {
    var brandHref = _user ? '/library' : '/';
    var appLink = _user ? 'App' : 'Try Free';

    var rightHtml = '';
    if (_user) {
      var avatarHtml = _user.picture
        ? '<img class="suite-nav-avatar" src="' + escapeAttr(_user.picture) + '" alt="" referrerpolicy="no-referrer">'
        : '<div class="suite-nav-avatar" style="background:#1C222B;border:1px solid #333B45;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#F2F3EF;">' + (_user.name || _user.email || '?').charAt(0).toUpperCase() + '</div>';

      var badgeHtml = _user.tier === 'pro'
        ? ''
        : '<a href="/#pricing" class="suite-nav-gopro">Go Pro</a>';

      rightHtml =
        '<div class="suite-nav-user" id="nav-user-area">' +
          avatarHtml +
          '<span class="suite-nav-username">' + escapeHtml(_user.name || _user.email || '') + '</span>' +
          badgeHtml +
          '<div class="suite-nav-dropdown" id="nav-dropdown">' +
            '<div class="suite-nav-drop-item" style="color:#999;cursor:default;font-size:12px;">' + escapeHtml(_user.email || '') + '</div>' +
            (_user.tier === 'pro'
              ? '<div class="suite-nav-drop-item" style="color:#999;cursor:default;font-size:12px;">' + (_user.packsUsed || 0) + ' / ' + (_user.packsLimit || 10) + ' script packs this month</div>' +
                '<a href="/api/checkout" class="suite-nav-drop-item" style="text-decoration:none;">Manage Subscription</a>'
              : '') +
            '<a href="/privacy" class="suite-nav-drop-item" style="text-decoration:none;font-size:12px;color:#999;">Privacy</a>' +
            '<a href="/terms" class="suite-nav-drop-item" style="text-decoration:none;font-size:12px;color:#999;">Terms</a>' +
            '<button class="suite-nav-drop-item" id="nav-signout-btn">Sign out</button>' +
          '</div>' +
        '</div>';
    } else {
      rightHtml =
        '<button class="suite-nav-signin" onclick="window.location.href=\'/api/auth/google\'">Sign in</button>' +
        '<a href="/library" class="suite-nav-link' + (path === '/library' ? ' active' : '') + '">Library</a>' +
        '<a href="/#pricing" class="suite-nav-gopro">Go Pro</a>';
    }

    var linksHtml = '';
    if (_user) {
      linksHtml =
        '<a href="/library" class="suite-nav-link' + (path === '/library' ? ' active' : '') + '">Library</a>' +
        '<a href="/studio" class="suite-nav-link' + (path === '/studio' ? ' active' : '') + '">Studio</a>';
    }

    nav.innerHTML =
      '<div class="suite-nav-inner">' +
        '<a href="' + brandHref + '" class="suite-nav-brand">Hooklab</a>' +
        '<div class="suite-nav-links">' + linksHtml + '</div>' +
        '<div class="suite-nav-right">' + rightHtml + '</div>' +
      '</div>';

    // Bind events
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

  // Initial render (empty state) then fetch
  renderNav();
  fetchUser();
})();
