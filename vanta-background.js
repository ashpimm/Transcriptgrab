(function () {
  'use strict';

  var hero = document.getElementById('hero-vanta');
  if (!hero || !window.matchMedia) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var compactViewport = window.matchMedia('(max-width: 760px)').matches;
  var coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  // Keep the static CSS glow for visitors who prefer less motion or less data.
  if (reducedMotion || compactViewport || coarsePointer || (connection && connection.saveData)) return;

  function supportsWebGL() {
    try {
      var canvas = document.createElement('canvas');
      return Boolean(
        window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      );
    } catch (err) {
      return false;
    }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function startVanta() {
    if (!supportsWebGL() || !hero.isConnected) return;

    loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js')
      .then(function () {
        return loadScript('https://cdn.jsdelivr.net/npm/vanta@0.5.24/dist/vanta.halo.min.js');
      })
      .then(function () {
        if (!window.VANTA || !window.VANTA.HALO || !hero.isConnected) return;

        var effect = window.VANTA.HALO({
          el: hero,
          mouseControls: true,
          touchControls: false,
          gyroControls: false,
          minHeight: 420,
          minWidth: 760,
          scale: 1,
          scaleMobile: 1,
          baseColor: 0xffdd00,
          backgroundColor: 0x070708,
          amplitudeFactor: 1.15,
          size: 1.05,
          xOffset: 0.16,
          yOffset: -0.08
        });

        var canvas = hero.querySelector('.vanta-canvas');
        if (canvas) canvas.setAttribute('aria-hidden', 'true');
        hero.classList.add('vanta-ready');

        window.addEventListener('pagehide', function cleanup() {
          if (effect) {
            effect.destroy();
            effect = null;
          }
        }, { once: true });
      })
      .catch(function () {
        // The CSS glow remains as a complete fallback if either CDN is unavailable.
      });
  }

  function scheduleVanta() {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(startVanta, { timeout: 1200 });
    } else {
      window.setTimeout(startVanta, 250);
    }
  }

  if (document.readyState === 'complete') {
    scheduleVanta();
  } else {
    window.addEventListener('load', scheduleVanta, { once: true });
  }
})();
