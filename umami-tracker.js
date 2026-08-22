/*
  Local, pinned Umami-compatible tracker for the Tandara archive.
  Based on the public Umami tracker interface and protocol.
  Umami Software is licensed under the MIT License; see UMAMI-LICENSE.txt.
*/
(function (window) {
  'use strict';

  var document = window.document;
  var script = document.currentScript;
  if (!script || !window.fetch) return;

  function config(name) {
    return script.getAttribute('data-' + name);
  }

  var website = config('website-id');
  var host = config('host-url') || 'https://api-gateway.umami.dev';
  var endpoint = host.replace(/\/$/, '') + '/api/send';
  var autoTrack = config('auto-track') !== 'false';
  var excludeSearch = config('exclude-search') === 'true';
  var excludeHash = config('exclude-hash') === 'true';
  var respectDnt = config('do-not-track') === 'true';
  var allowedDomains = (config('domains') || '').split(',').map(function (value) {
    return value.trim();
  }).filter(Boolean);
  var disabled = false;
  var cache;
  var identity;
  var currentUrl;
  var currentReferrer;
  var initialized = false;

  function normalize(raw) {
    if (!raw) return raw;
    try {
      var url = new URL(raw, window.location.href);
      if (excludeSearch) url.search = '';
      if (excludeHash) url.hash = '';
      return url.toString();
    } catch (_error) {
      return raw;
    }
  }

  function hasDoNotTrack() {
    var value = window.doNotTrack || window.navigator.doNotTrack || window.navigator.msDoNotTrack;
    return value === 1 || value === '1' || value === 'yes';
  }

  function localTrackingDisabled() {
    try {
      return window.localStorage && window.localStorage.getItem('umami.disabled');
    } catch (_error) {
      return false;
    }
  }

  function trackingDisabled() {
    return disabled || !website || localTrackingDisabled() ||
      (allowedDomains.length && allowedDomains.indexOf(window.location.hostname) === -1) ||
      (respectDnt && hasDoNotTrack());
  }

  function payload() {
    return {
      website: website,
      screen: window.screen.width + 'x' + window.screen.height,
      language: window.navigator.language,
      title: document.title,
      hostname: window.location.hostname,
      url: currentUrl,
      referrer: currentReferrer,
      id: identity || undefined
    };
  }

  function send(data, type) {
    if (trackingDisabled()) return Promise.resolve();

    return window.fetch(endpoint, {
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'x-umami-website-id': website,
        'x-umami-hostname': window.location.hostname
      }, typeof cache !== 'undefined' ? { 'x-umami-cache': cache } : {}),
      body: JSON.stringify({ type: type || 'event', payload: data })
    }).then(function (response) {
      if (!response.ok) return null;
      return response.json().catch(function () { return null; });
    }).then(function (responseData) {
      if (responseData) {
        disabled = Boolean(responseData.disabled);
        if (typeof responseData.cache !== 'undefined') cache = responseData.cache;
      }
    }).catch(function () {
      /* Analytics must never interrupt page functionality. */
    });
  }

  function track(name, data) {
    var eventPayload = payload();
    if (typeof name === 'string') {
      eventPayload.name = name;
      eventPayload.data = data;
    } else if (name && typeof name === 'object') {
      eventPayload = Object.assign(eventPayload, name);
    } else if (typeof name === 'function') {
      eventPayload = name(eventPayload);
    }
    if (!eventPayload) return Promise.resolve();
    return send(eventPayload, 'event');
  }

  function identify(id, data) {
    if (typeof id === 'string') identity = id;
    cache = '';
    var identifyPayload = payload();
    identifyPayload.data = typeof id === 'object' ? id : data;
    return send(identifyPayload, 'identify');
  }

  function updateLocation(nextUrl) {
    var next = normalize(nextUrl || window.location.href);
    if (next === currentUrl) return;
    currentReferrer = currentUrl;
    currentUrl = next;
    window.setTimeout(function () { track(); }, 300);
  }

  function hookHistory(method) {
    var original = window.history[method];
    if (typeof original !== 'function') return;
    window.history[method] = function () {
      var result = original.apply(this, arguments);
      updateLocation(arguments[2]);
      return result;
    };
  }

  function handleTrackedClicks() {
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      var element = target.closest('[data-umami-event]');
      if (!element) return;
      var eventName = element.getAttribute('data-umami-event');
      if (!eventName) return;
      var eventData = {};
      Array.prototype.forEach.call(element.attributes, function (attribute) {
        var match = attribute.name.match(/^data-umami-event-(.+)$/);
        if (match) eventData[match[1]] = attribute.value;
      });
      track(eventName, eventData);
    }, true);
  }

  function init() {
    if (initialized || trackingDisabled()) return;
    initialized = true;
    currentUrl = normalize(window.location.href);
    currentReferrer = normalize(document.referrer.indexOf(window.location.origin) === 0 ? '' : document.referrer);
    hookHistory('pushState');
    hookHistory('replaceState');
    window.addEventListener('popstate', function () { updateLocation(window.location.href); });
    handleTrackedClicks();
    track();
  }

  window.umami = window.umami || {
    track: track,
    identify: identify,
    getSession: function () { return { cache: cache, website: website }; }
  };

  if (autoTrack) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }
}(window));
