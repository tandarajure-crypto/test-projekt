(function(){
  'use strict';

  var COMMON_SURNAME = 'Tandara';
  var registries = new Map();

  function normalize(value){
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en')
      .replace(/[^a-z0-9čćđšž\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function queryTokens(rawQuery, surname){
    var surnameToken = normalize(surname || COMMON_SURNAME);
    return normalize(rawQuery)
      .split(' ')
      .filter(Boolean)
      .filter(function(token){ return token !== surnameToken; });
  }

  function uniqueEntries(entries){
    var seen = new Set();
    return entries.filter(function(entry){
      var key = [entry.id || '', normalize(entry.name), normalize(entry.qualifier || '')].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function domEntries(setup){
    return Array.prototype.slice.call(setup.querySelectorAll('[data-person-name]')).map(function(element, index){
      return {
        id: element.getAttribute('data-person-id') || element.id || 'dom-person-' + index,
        name: element.getAttribute('data-person-name') || element.textContent.trim(),
        aliases: element.getAttribute('data-person-aliases') || '',
        qualifier: element.getAttribute('data-person-qualifier') || '',
        dialogId: element.getAttribute('data-person-dialog') || '',
        element: element
      };
    });
  }

  function entrySearchText(entry, surname){
    return normalize([
      entry.name,
      entry.aliases,
      entry.qualifier,
      entry.father,
      entry.mother,
      entry.code,
      surname || COMMON_SURNAME
    ].filter(Boolean).join(' '));
  }

  function collectResults(setup, rawQuery){
    var surname = setup.getAttribute('data-common-surname') || COMMON_SURNAME;
    var tokens = queryTokens(rawQuery, surname);
    if (!tokens.length) return [];

    var registered = registries.get(setup) || [];
    var entries = uniqueEntries(registered.concat(domEntries(setup)));

    return entries.filter(function(entry){
      var haystack = entrySearchText(entry, surname);
      return tokens.every(function(token){ return haystack.indexOf(token) !== -1; });
    }).sort(function(a, b){
      return String(a.name || '').localeCompare(String(b.name || ''), 'en');
    });
  }

  function openEntry(setup, entry){
    if (typeof entry.open === 'function') {
      entry.open(entry);
      return;
    }

    var dialog = entry.dialogId ? document.getElementById(entry.dialogId) : null;
    if (dialog) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else {
        dialog.hidden = false;
        dialog.setAttribute('open', '');
        dialog.classList.add('is-open');
      }
      return;
    }

    if (entry.element && typeof entry.element.click === 'function') {
      entry.element.click();
      return;
    }

    setup.dispatchEvent(new CustomEvent('tandara:open-person', {
      bubbles: true,
      detail: { person: entry }
    }));
  }

  function renderResults(setup, rawQuery){
    var search = setup.querySelector('[data-tandara-person-search]');
    if (!search) return;

    var input = search.querySelector('[data-tandara-search-input]');
    var panel = search.querySelector('[data-tandara-search-results]');
    var title = search.querySelector('[data-tandara-search-title]');
    var items = search.querySelector('[data-tandara-search-items]');
    var status = search.querySelector('[data-tandara-search-status]');
    var results = collectResults(setup, rawQuery);
    var surname = setup.getAttribute('data-common-surname') || COMMON_SURNAME;
    var tokens = queryTokens(rawQuery, surname);

    items.innerHTML = '';
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');

    if (!tokens.length) {
      title.textContent = 'Enter a first name with the surname ' + surname;
      items.innerHTML = '<p class="tandara-person-search-empty">The shared surname alone is not enough. Enter the person’s first name as well.</p>';
      status.textContent = 'Enter the person’s first name.';
      return;
    }

    title.textContent = results.length
      ? 'Possible people · found ' + results.length
      : 'No people found';

    if (!results.length) {
      items.innerHTML = '<p class="tandara-person-search-empty">Not found: ' + escapeHtml(rawQuery) + '.</p>';
      status.textContent = 'No results for ' + rawQuery + '.';
      return;
    }

    results.forEach(function(entry){
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'tandara-person-result';
      var parentText = entry.father || entry.mother
        ? 'Father: ' + (entry.father || 'unknown') + ' · Mother: ' + (entry.mother || 'unknown')
        : '';
      button.innerHTML = '<span>' + escapeHtml(entry.name || 'Unknown person') + '</span>' +
        (entry.qualifier ? '<small>' + escapeHtml(entry.qualifier) + '</small>' : '') +
        (parentText ? '<small>' + escapeHtml(parentText) + '</small>' : '');
      button.addEventListener('click', function(){
        openEntry(setup, entry);
      });
      items.appendChild(button);
    });

    status.textContent = 'People found: ' + results.length + '.';
  }

  function escapeHtml(value){
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function closeResults(search){
    var panel = search.querySelector('[data-tandara-search-results]');
    var input = search.querySelector('[data-tandara-search-input]');
    if (panel) panel.hidden = true;
    if (input) input.setAttribute('aria-expanded', 'false');
  }

  function setupSearch(setup){
    if (!registries.has(setup)) registries.set(setup, []);
    var search = setup.querySelector('[data-tandara-person-search]');
    if (!search) return;

    var input = search.querySelector('[data-tandara-search-input]');
    var button = search.querySelector('[data-tandara-search-button]');

    function runSearch(){
      var query = input.value.trim();
      if (!query) {
        closeResults(search);
        return;
      }
      renderResults(setup, query);
    }

    button.addEventListener('click', runSearch);
    input.addEventListener('keydown', function(event){
      if (event.key === 'Enter') runSearch();
      if (event.key === 'Escape') closeResults(search);
    });
  }

  document.querySelectorAll('[data-diagram-setup]').forEach(setupSearch);

  window.TandaraDiagramSearch = Object.freeze({
    commonSurname: COMMON_SURNAME,
    register: function(setupReference, people){
      var setup = typeof setupReference === 'string'
        ? document.querySelector(setupReference)
        : setupReference;
      if (!setup || !setup.matches('[data-diagram-setup]')) return false;
      var current = registries.get(setup) || [];
      var additions = Array.isArray(people) ? people : [people];
      registries.set(setup, current.concat(additions.filter(Boolean)));
      return true;
    },
    collectResults: function(setupReference, query){
      var setup = typeof setupReference === 'string'
        ? document.querySelector(setupReference)
        : setupReference;
      return setup ? collectResults(setup, query) : [];
    }
  });
})();
