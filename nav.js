(function(){
  // ============================================
  // TGUser — global user state from server
  // ============================================
  var _user = null;
  var _ready = false;
  var _readyCallbacks = [];

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

  function fetchUser() {
    return fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        _user = d.user || null;
        if (!_ready) resolveReady();
        renderNav();
        return _user;
      })
      .catch(function() {
        _user = null;
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
    '.suite-nav{background:rgba(255,255,255,0.72);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);border-bottom:1px solid rgba(0,0,0,0.06);position:sticky;top:0;z-index:1000;font-family:"Outfit",-apple-system,sans-serif;}' +
    '.suite-nav-inner{max-width:1200px;margin:0 auto;padding:0 40px;display:flex;align-items:center;justify-content:space-between;height:52px;gap:8px;}' +
    '.suite-nav-brand{font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#999;text-decoration:none;flex-shrink:0;transition:color 0.2s;}' +
    '.suite-nav-brand:hover{color:#111;}' +
    '.suite-nav-links{display:flex;align-items:center;gap:2px;}' +
    '.suite-nav-link{font-size:13px;font-weight:500;color:#999;text-decoration:none;padding:6px 12px;border-radius:100px;transition:all 0.2s;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;}' +
    '.suite-nav-link:hover{color:#111;background:#f5f5f5;}' +
    '.suite-nav-link.active{color:#111;font-weight:600;background:#f5f5f5;}' +
    '.suite-nav-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}' +
    '.suite-nav-signin{font-size:13px;font-weight:600;color:#111;text-decoration:none;padding:6px 16px;border:1px solid #e8e8e8;border-radius:100px;transition:all 0.2s;white-space:nowrap;cursor:pointer;background:none;font-family:"Outfit",sans-serif;}' +
    '.suite-nav-signin:hover{border-color:#999;background:#f5f5f5;}' +
    '.suite-nav-avatar{width:28px;height:28px;border-radius:50%;object-fit:cover;cursor:pointer;}' +
    '.suite-nav-user{display:flex;align-items:center;gap:8px;position:relative;}' +
    '.suite-nav-username{font-size:13px;font-weight:500;color:#666;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.suite-nav-pro-badge{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#0071e3;padding:2px 8px;border:1px solid #0071e320;border-radius:100px;background:#0071e308;}' +
    '.suite-nav-gopro{font-size:12px;font-weight:600;color:#fff;background:#0071e3;text-decoration:none;padding:6px 16px;border-radius:100px;transition:all 0.2s;white-space:nowrap;}' +
    '.suite-nav-gopro:hover{background:#0077ED;transform:translateY(-1px);}' +
    '.suite-nav-dropdown{position:absolute;top:100%;right:0;margin-top:8px;background:rgba(255,255,255,0.85);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);border:1px solid rgba(0,0,0,0.06);border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,0.1),0 0 0 1px rgba(0,0,0,0.02);min-width:180px;padding:8px;z-index:1001;display:none;}' +
    '.suite-nav-dropdown.show{display:block;}' +
    '.suite-nav-drop-item{display:block;width:100%;padding:10px 14px;font-family:"Outfit",sans-serif;font-size:13px;font-weight:500;color:#666;border:none;background:none;cursor:pointer;text-align:left;border-radius:8px;transition:all 0.15s;}' +
    '.suite-nav-drop-item:hover{background:#f5f5f5;color:#111;}' +
    '@media(max-width:700px){.suite-nav-username{display:none !important;}.suite-nav-right .suite-nav-gopro{display:none !important;}}' +
    '@media(max-width:600px){.suite-nav-inner{padding:0 24px;}}';
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
    var brandHref = (_user && _user.tier === 'pro') ? '/app' : '/';
    var appLink = _user ? 'App' : 'Try Free';

    var rightHtml = '';
    if (_user) {
      var avatarHtml = _user.picture
        ? '<img class="suite-nav-avatar" src="' + escapeAttr(_user.picture) + '" alt="" referrerpolicy="no-referrer">'
        : '<div class="suite-nav-avatar" style="background:#e8e8e8;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#999;">' + (_user.name || _user.email || '?').charAt(0).toUpperCase() + '</div>';

      var badgeHtml = _user.tier === 'pro'
        ? '<span class="suite-nav-pro-badge">Pro</span>'
        : '<a href="/#pricing" class="suite-nav-gopro">Go Pro</a>';

      rightHtml =
        '<div class="suite-nav-user" id="nav-user-area">' +
          avatarHtml +
          '<span class="suite-nav-username">' + escapeHtml(_user.name || _user.email || '') + '</span>' +
          badgeHtml +
          '<div class="suite-nav-dropdown" id="nav-dropdown">' +
            '<div class="suite-nav-drop-item" style="color:#999;cursor:default;font-size:12px;">' + escapeHtml(_user.email || '') + '</div>' +
            (_user.tier === 'pro'
              ? '<div class="suite-nav-drop-item" style="color:#999;cursor:default;font-size:12px;">' + _user.monthly_usage + ' / ' + _user.usage_limit + ' videos this month</div>' +
                '<a href="/api/checkout" class="suite-nav-drop-item" style="text-decoration:none;">Manage Subscription</a>'
              : (_user.credits > 0
                ? '<div class="suite-nav-drop-item" style="color:#999;cursor:default;font-size:12px;">' + _user.credits + ' credit' + (_user.credits !== 1 ? 's' : '') + ' remaining</div>'
                : '')) +
            '<button class="suite-nav-drop-item" id="nav-signout-btn">Sign out</button>' +
          '</div>' +
        '</div>';
    } else {
      rightHtml = '<a href="/#pricing" class="suite-nav-gopro">Go Pro</a>';
    }

    var linksHtml =
      '<a href="/app" class="suite-nav-link' + (path === '/app' ? ' active' : '') + '">' + appLink + '</a>';
    if (_user) {
      linksHtml += '<a href="/library" class="suite-nav-link' + (path === '/library' ? ' active' : '') + '">Library</a>';
    }

    nav.innerHTML =
      '<div class="suite-nav-inner">' +
        '<a href="' + brandHref + '" class="suite-nav-brand">TranscriptGrab</a>' +
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
        fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
          .then(function() {
            _user = null;
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
