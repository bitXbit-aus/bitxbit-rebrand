/**
 * Privacy-friendly analytics consent for bitXbit marketing site.
 * Uses Plausible (cookie-less) only after explicit consent.
 */
(function () {
  'use strict';

  const CONSENT_KEY = 'bxb_analytics_consent';
  const PLAUSIBLE_DOMAIN = 'bitxbit.com.au';
  const PLAUSIBLE_SCRIPT = 'https://plausible.io/js/pa-4iO18xbWIudVPceEE0zrV.js';

  function getConsent() {
    try {
      const value = localStorage.getItem(CONSENT_KEY);
      return value === null ? null : value === 'granted';
    } catch (e) {
      return null;
    }
  }

  function setConsent(granted) {
    try {
      localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied');
    } catch (e) {
      // Ignore storage errors.
    }
  }

  function loadPlausible() {
    if (document.querySelector('script[src*="pa-4iO18xbWIudVPceEE0zrV"]')) return;

    // Inject the exact Plausible snippet (two script tags).
    const loader = document.createElement('script');
    loader.async = true;
    loader.src = 'https://plausible.io/js/pa-4iO18xbWIudVPceEE0zrV.js';
    document.head.appendChild(loader);

    const inline = document.createElement('script');
    inline.textContent = 'window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()';
    document.head.appendChild(inline);
  }

  function hideBanner() {
    const banner = document.getElementById('cookie-consent-banner');
    if (banner) {
      banner.classList.remove('cookie-consent-visible');
      banner.setAttribute('aria-hidden', 'true');
      setTimeout(() => banner.remove(), 300);
    }
  }

  function createBanner() {
    if (document.getElementById('cookie-consent-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.className = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML = `
      <div class="cookie-consent-inner">
        <p class="cookie-consent-text">
          We use privacy-friendly analytics to understand how the site is used. No personal data is collected and no cookies are stored by our analytics provider.
          <a href="legal-disclaimer.html#privacy" class="cookie-consent-link">Privacy Policy</a>
        </p>
        <div class="cookie-consent-actions">
          <button type="button" class="cookie-consent-btn cookie-consent-btn-secondary" data-action="decline">Decline</button>
          <button type="button" class="cookie-consent-btn cookie-consent-btn-primary" data-action="accept">Accept</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    // Trigger reflow so the transition plays.
    requestAnimationFrame(() => {
      banner.classList.add('cookie-consent-visible');
    });

    banner.querySelector('[data-action="accept"]').addEventListener('click', () => {
      setConsent(true);
      loadPlausible();
      hideBanner();
    });

    banner.querySelector('[data-action="decline"]').addEventListener('click', () => {
      setConsent(false);
      hideBanner();
    });
  }

  function init() {
    const consent = getConsent();

    if (consent === true) {
      loadPlausible();
    } else if (consent === null) {
      // Wait for DOM to be ready before showing banner.
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createBanner);
      } else {
        createBanner();
      }
    }
  }

  init();
})();
