// content-cards.js — Shared card rendering for app + library pages.
// Exposes window.TGCards

(function() {
  'use strict';

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return s.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  function renderMarkdown(md) {
    return md
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  }

  function makeCard(name, icon, copyContent) {
    var card = document.createElement('div');
    card.className = 'platform-card';
    card.innerHTML =
      '<div class="card-header">' +
        '<div class="card-platform"><span class="card-icon">' + icon + '</span><span class="card-name">' + name + '</span></div>' +
        '<button class="card-copy-btn" onclick="TGCards.copyText(this, null, this.closest(\'.platform-card\'))">Copy</button>' +
      '</div>' +
      '<div class="card-body"></div>';
    card._copyContent = copyContent;
    return card;
  }

  function buildTwitterCard(tweets) {
    var card = makeCard('Twitter / X', '\u{1D54F}', tweets.join('\n\n'));
    var body = card.querySelector('.card-body');
    var list = document.createElement('ol');
    list.className = 'tweet-list';
    tweets.forEach(function(t, i) {
      var li = document.createElement('li');
      li.className = 'tweet-item';
      li.innerHTML = '<span class="tweet-num">' + (i+1) + '/' + tweets.length + '</span>' + escapeHtml(t);
      list.appendChild(li);
    });
    body.innerHTML = '';
    body.appendChild(list);
    return card;
  }

  function buildTranscriptCard(text) {
    var card = makeCard('Transcript', '\u{1F4C4}', text);
    card.classList.add('full-width');
    var body = card.querySelector('.card-body');
    body.classList.add('tall');
    var pre = document.createElement('div');
    pre.className = 'content-text';
    pre.style.fontFamily = '"IBM Plex Mono", monospace';
    pre.style.fontSize = '12px';
    pre.textContent = text;
    body.innerHTML = '';
    body.appendChild(pre);
    return card;
  }

  function buildTextCard(name, icon, content) {
    var card = makeCard(name, icon, content);
    var body = card.querySelector('.card-body');
    var pre = document.createElement('div');
    pre.className = 'content-text';
    pre.textContent = content;
    body.innerHTML = '';
    body.appendChild(pre);
    return card;
  }

  function buildTikTokCard(tiktok) {
    var copyText = (tiktok.caption || '') + '\n\n---\n\n' + (tiktok.script || '');
    var card = makeCard('TikTok', '\u{266B}', copyText);
    var body = card.querySelector('.card-body');
    body.innerHTML =
      '<div class="tiktok-section-label">Caption</div>' +
      '<div class="content-text">' + escapeHtml(tiktok.caption || '') + '</div>' +
      '<div class="tiktok-section-label" style="margin-top:20px">Voiceover Script</div>' +
      '<div class="content-text">' + escapeHtml(tiktok.script || '') + '</div>';
    return card;
  }

  function buildBlogCard(blog) {
    var fullText = '# ' + (blog.title || '') + '\n\n' + (blog.content || '');
    var card = makeCard('Blog Post', '\u{270D}\u{FE0F}', fullText);
    card.classList.add('full-width');
    var body = card.querySelector('.card-body');
    body.classList.add('tall');
    body.innerHTML = '<div class="blog-title">' + escapeHtml(blog.title || '') + '</div><div class="blog-body">' + renderMarkdown(blog.content || '') + '</div>';
    return card;
  }

  function buildQuotesCard(quotes) {
    var allText = quotes.map(function(q) { return '"' + q.text + '"'; }).join('\n\n');
    var card = makeCard('Key Quotes', '\u{1F4AC}', allText);
    card.classList.add('full-width');
    var body = card.querySelector('.card-body');
    body.innerHTML = '';
    var list = document.createElement('div');
    list.className = 'quote-list';
    quotes.forEach(function(q) {
      var qc = document.createElement('div');
      qc.className = 'quote-card';
      qc.innerHTML =
        '<div class="quote-text">\u201C' + escapeHtml(q.text) + '\u201D</div>' +
        '<div class="quote-meta">' +
          '<span class="quote-ts">' + escapeHtml(q.timestamp || '') + '</span>' +
          '<button class="quote-copy" onclick="TGCards.copyText(this, ' + escapeAttr(JSON.stringify(q.tweet || q.text)) + ')">Copy</button>' +
        '</div>';
      list.appendChild(qc);
    });
    body.appendChild(list);
    return card;
  }

  function buildVariationTextCard(name, icon, variations) {
    var card = makeCard(name, icon, variations[0].content);
    var header = card.querySelector('.card-header');
    var copyBtn = header.querySelector('.card-copy-btn');

    var tabs = document.createElement('div');
    tabs.className = 'variation-tabs';
    var labelEl = document.createElement('div');
    labelEl.className = 'variation-label';
    labelEl.textContent = variations[0].label || 'Variation 1';

    var bodyContent = document.createElement('div');
    bodyContent.className = 'content-text';
    bodyContent.textContent = variations[0].content;

    variations.forEach(function(v, i) {
      var tab = document.createElement('button');
      tab.className = 'variation-tab' + (i === 0 ? ' active' : '');
      tab.textContent = i + 1;
      tab.setAttribute('data-idx', i);
      tab.onclick = function() {
        tabs.querySelectorAll('.variation-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        labelEl.textContent = variations[i].label || ('Variation ' + (i + 1));
        bodyContent.textContent = variations[i].content;
        card._copyContent = variations[i].content;
      };
      tabs.appendChild(tab);
    });
    header.insertBefore(tabs, copyBtn);
    header.parentNode.insertBefore(labelEl, header.nextSibling);

    var body = card.querySelector('.card-body');
    body.innerHTML = '';
    body.appendChild(bodyContent);

    return card;
  }

  function buildVariationTikTokCard(variations) {
    var first = variations[0];
    var copyText = (first.caption || '') + '\n\n---\n\n' + (first.script || '');
    var card = makeCard('TikTok', '\u{266B}', copyText);
    var header = card.querySelector('.card-header');
    var copyBtn = header.querySelector('.card-copy-btn');

    var tabs = document.createElement('div');
    tabs.className = 'variation-tabs';
    var labelEl = document.createElement('div');
    labelEl.className = 'variation-label';
    labelEl.textContent = first.label || 'Variation 1';

    var body = card.querySelector('.card-body');
    body.innerHTML =
      '<div class="tiktok-section-label">Caption</div>' +
      '<div class="content-text"></div>' +
      '<div class="tiktok-section-label" style="margin-top:20px">Voiceover Script</div>' +
      '<div class="content-text"></div>';
    var textEls = body.querySelectorAll('.content-text');
    var captionEl = textEls[0];
    var scriptEl = textEls[1];
    captionEl.textContent = first.caption || '';
    scriptEl.textContent = first.script || '';

    variations.forEach(function(v, i) {
      var tab = document.createElement('button');
      tab.className = 'variation-tab' + (i === 0 ? ' active' : '');
      tab.textContent = i + 1;
      tab.setAttribute('data-idx', i);
      tab.onclick = function() {
        tabs.querySelectorAll('.variation-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        labelEl.textContent = variations[i].label || ('Variation ' + (i + 1));
        captionEl.textContent = variations[i].caption || '';
        scriptEl.textContent = variations[i].script || '';
        card._copyContent = (variations[i].caption || '') + '\n\n---\n\n' + (variations[i].script || '');
      };
      tabs.appendChild(tab);
    });
    header.insertBefore(tabs, copyBtn);
    header.parentNode.insertBefore(labelEl, header.nextSibling);

    return card;
  }

  function buildVariationBlogCard(variations) {
    var first = variations[0];
    var fullText = '# ' + (first.title || '') + '\n\n' + (first.content || '');
    var card = makeCard('Blog Post', '\u{270D}\u{FE0F}', fullText);
    card.classList.add('full-width');
    var header = card.querySelector('.card-header');
    var copyBtn = header.querySelector('.card-copy-btn');

    var tabs = document.createElement('div');
    tabs.className = 'variation-tabs';
    var labelEl = document.createElement('div');
    labelEl.className = 'variation-label';
    labelEl.textContent = first.label || 'Variation 1';

    var body = card.querySelector('.card-body');
    body.classList.add('tall');
    var titleEl = document.createElement('div');
    titleEl.className = 'blog-title';
    titleEl.textContent = first.title || '';
    var blogBody = document.createElement('div');
    blogBody.className = 'blog-body';
    blogBody.innerHTML = renderMarkdown(first.content || '');
    body.innerHTML = '';
    body.appendChild(titleEl);
    body.appendChild(blogBody);

    variations.forEach(function(v, i) {
      var tab = document.createElement('button');
      tab.className = 'variation-tab' + (i === 0 ? ' active' : '');
      tab.textContent = i + 1;
      tab.setAttribute('data-idx', i);
      tab.onclick = function() {
        tabs.querySelectorAll('.variation-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        labelEl.textContent = variations[i].label || ('Variation ' + (i + 1));
        titleEl.textContent = variations[i].title || '';
        blogBody.innerHTML = renderMarkdown(variations[i].content || '');
        card._copyContent = '# ' + (variations[i].title || '') + '\n\n' + (variations[i].content || '');
      };
      tabs.appendChild(tab);
    });
    header.insertBefore(tabs, copyBtn);
    header.parentNode.insertBefore(labelEl, header.nextSibling);

    return card;
  }

  /**
   * Render all content cards from a generation data object into a container.
   * @param {Object} data - The generation content JSON
   * @param {HTMLElement} container - The DOM element to render into (will be cleared)
   */
  function renderCards(data, container) {
    container.innerHTML = '';

    if (data._transcript) {
      container.appendChild(buildTranscriptCard(data._transcript));
    }
    if (data.twitter && data.twitter.tweets) {
      container.appendChild(buildTwitterCard(data.twitter.tweets));
    }
    if (data.linkedin) {
      if (Array.isArray(data.linkedin)) container.appendChild(buildVariationTextCard('LinkedIn', 'in', data.linkedin));
      else if (data.linkedin.content) container.appendChild(buildTextCard('LinkedIn', 'in', data.linkedin.content));
    }
    if (data.facebook) {
      if (Array.isArray(data.facebook)) container.appendChild(buildVariationTextCard('Facebook', 'f', data.facebook));
      else if (data.facebook.content) container.appendChild(buildTextCard('Facebook', 'f', data.facebook.content));
    }
    if (data.instagram) {
      if (Array.isArray(data.instagram)) container.appendChild(buildVariationTextCard('Instagram', '\u{1F4F7}', data.instagram));
      else if (data.instagram.content) container.appendChild(buildTextCard('Instagram', '\u{1F4F7}', data.instagram.content));
    }
    if (data.tiktok) {
      if (Array.isArray(data.tiktok)) container.appendChild(buildVariationTikTokCard(data.tiktok));
      else container.appendChild(buildTikTokCard(data.tiktok));
    }
    if (data.blog) {
      if (Array.isArray(data.blog)) container.appendChild(buildVariationBlogCard(data.blog));
      else container.appendChild(buildBlogCard(data.blog));
    }
    if (data.quotes && data.quotes.length) {
      container.appendChild(buildQuotesCard(data.quotes));
    }
  }

  function copyText(btn, text, cardEl) {
    if (!text && cardEl) text = cardEl._copyContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(function() {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    });
  }

  window.TGCards = {
    renderCards: renderCards,
    makeCard: makeCard,
    buildTwitterCard: buildTwitterCard,
    buildTranscriptCard: buildTranscriptCard,
    buildTextCard: buildTextCard,
    buildTikTokCard: buildTikTokCard,
    buildBlogCard: buildBlogCard,
    buildQuotesCard: buildQuotesCard,
    buildVariationTextCard: buildVariationTextCard,
    buildVariationTikTokCard: buildVariationTikTokCard,
    buildVariationBlogCard: buildVariationBlogCard,
    renderMarkdown: renderMarkdown,
    escapeHtml: escapeHtml,
    copyText: copyText
  };
})();
