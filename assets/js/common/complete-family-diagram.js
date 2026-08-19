(function () {
  'use strict';

  var embedded = document.getElementById('completeFamilyData');
  var parsed = null;
  var raw = [];
  var sourceTree = null;

  if (embedded) {
    try {
      parsed = JSON.parse(embedded.textContent || '[]');
      raw = Array.isArray(parsed) ? parsed : (parsed.persons || []);
      sourceTree = Array.isArray(parsed) ? null : (parsed.tree || null);
    } catch (_error) {
      raw = [];
    }
  }

  if (!sourceTree) {
    try { sourceTree = DATA; } catch (_error) { sourceTree = null; }
  }
  if (!sourceTree) return;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function walkSource(node, callback, parent, depth) {
    if (!node) return;
    callback(node, parent || null, depth || 0);
    (node.children || []).forEach(function (child) {
      walkSource(child, callback, node, (depth || 0) + 1);
    });
  }

  function deriveRecords(node, parentCode, output) {
    if (!node) return output;
    var code = clean(node.code || node.id);
    output.push({
      code: code,
      name: clean(node.name || node.label || code),
      qualifier: clean(node.qualifier),
      father: clean(node.father),
      mother: clean(node.mother),
      relation: clean(node.relation || ''),
      note: clean(node.note || node.detail),
      kind: clean(node.kind || 'node'),
      hostCode: clean(node.hostCode || code),
      parentCodes: parentCode ? [parentCode] : []
    });
    (node.spouses || []).forEach(function (spouse) {
      output.push({
        code: clean(spouse.code || spouse.id),
        name: clean(spouse.name || spouse.label),
        qualifier: clean(spouse.qualifier),
        father: clean(spouse.father),
        mother: clean(spouse.mother),
        relation: clean(spouse.relation || 'spouse'),
        note: clean(spouse.note || spouse.detail),
        kind: 'spouse',
        hostCode: clean(spouse.hostCode || code),
        parentCodes: []
      });
    });
    (node.children || []).forEach(function (child) {
      deriveRecords(child, code, output);
    });
    return output;
  }

  if (!raw.length) raw = deriveRecords(sourceTree, '', []);

  var records = raw.map(function (person) {
    return {
      code: clean(person.code || person.id),
      name: clean(person.name || person.label || person.rawName || 'Nepoznata osoba'),
      qualifier: clean(person.qualifier),
      father: clean(person.father),
      mother: clean(person.mother),
      relation: clean(person.relation || person.gender),
      note: clean(person.note || person.detail),
      kind: clean(person.kind || 'person'),
      hostCode: clean(person.hostCode || person.code || person.id),
      parentCodes: Array.isArray(person.parentCodes) ? person.parentCodes.map(clean) : [],
      spouseCodes: Array.isArray(person.spouseCodes) ? person.spouseCodes.map(clean) : []
    };
  }).filter(function (person) { return person.code; });

  var byCode = new Map();
  records.forEach(function (person) {
    if (!byCode.has(person.code)) byCode.set(person.code, person);
  });

  walkSource(sourceTree, function (node, parent) {
    var code = clean(node.code || node.id);
    if (!code || byCode.has(code)) return;
    var person = {
      code: code,
      name: clean(node.name || node.label || code),
      qualifier: clean(node.qualifier),
      father: clean(node.father),
      mother: clean(node.mother),
      relation: clean(node.relation),
      note: clean(node.note || node.detail),
      kind: 'node',
      hostCode: code,
      parentCodes: parent ? [clean(parent.code || parent.id)] : [],
      spouseCodes: []
    };
    records.push(person);
    byCode.set(code, person);
  });

  function isCollateralCode(code) {
    return /-(?:K|SP|V)\d*(?:-|$)/i.test(code);
  }

  function isTerminalSonCode(code) {
    return /-S\d+$/i.test(code) && !isCollateralCode(code);
  }

  function isStructuralCode(code) {
    return Boolean(code) && !isCollateralCode(code);
  }

  function copyStructuralTree(node) {
    var code = clean(node && (node.code || node.id));
    if (!isStructuralCode(code)) return null;
    var copy = {
      code: code,
      label: clean(node.label || node.name || (byCode.get(code) || {}).name || code),
      detail: clean(node.detail || node.note || (byCode.get(code) || {}).note),
      expanded: Boolean(node.expanded),
      children: []
    };
    (node.children || []).forEach(function (child) {
      var childCopy = copyStructuralTree(child);
      if (childCopy) copy.children.push(childCopy);
    });
    return copy;
  }

  var treeData = copyStructuralTree(sourceTree);
  if (!treeData) return;

  function walk(node, callback, parent, depth) {
    callback(node, parent || null, depth || 0);
    (node.children || []).forEach(function (child) {
      walk(child, callback, node, (depth || 0) + 1);
    });
  }

  var structuralNodes = new Map();
  walk(treeData, function (node) { structuralNodes.set(node.code, node); });

  function nearestStructuralHost(person) {
    var current = clean(person && person.hostCode);
    var seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      if (structuralNodes.has(current)) return current;
      var hostRecord = byCode.get(current);
      if (hostRecord && hostRecord.hostCode && hostRecord.hostCode !== current) {
        current = hostRecord.hostCode;
        continue;
      }
      var parentRecord = hostRecord && hostRecord.parentCodes && hostRecord.parentCodes.length ? byCode.get(hostRecord.parentCodes[0]) : null;
      current = parentRecord ? parentRecord.code : '';
    }
    return '';
  }

  records.forEach(function (person) {
    if (!isTerminalSonCode(person.code) || structuralNodes.has(person.code)) return;
    var hostCode = nearestStructuralHost(person);
    var host = structuralNodes.get(hostCode);
    if (!host) return;
    var leaf = { code: person.code, label: person.name, detail: person.note, expanded: false, children: [] };
    host.children.push(leaf);
    structuralNodes.set(person.code, leaf);
  });

  var extrasByHost = new Map();
  records.forEach(function (person) {
    if (structuralNodes.has(person.code)) return;
    var hostCode = nearestStructuralHost(person);
    if (!hostCode) return;
    if (!extrasByHost.has(hostCode)) extrasByHost.set(hostCode, []);
    extrasByHost.get(hostCode).push(person);
  });

  function relationText(person) {
    return (person.relation + ' ' + person.kind).toLocaleLowerCase('hr');
  }

  function personClass(person) {
    var relation = relationText(person);
    if (person.kind === 'spouse' || /-SP-?\d*$/i.test(person.code)) return 'tcf-spouse';
    if (relation.indexOf('kći') >= 0 || relation.indexOf('daughter') >= 0 || /-K\d+$/i.test(person.code)) return 'tcf-daughter';
    if (relation.indexOf('sin') >= 0 || relation.indexOf('son') >= 0 || /-S\d+$/i.test(person.code)) return 'tcf-son';
    return 'tcf-related';
  }

  function extraOrder(person) {
    var className = personClass(person);
    if (className === 'tcf-spouse') return 0;
    if (className === 'tcf-daughter') return 1;
    if (className === 'tcf-son') return 2;
    return 3;
  }

  extrasByHost.forEach(function (list) {
    list.sort(function (a, b) {
      return extraOrder(a) - extraOrder(b) || a.code.localeCompare(b.code, undefined, { numeric: true });
    });
  });

  var oldSvg = document.querySelector('#treeSvg,.subtree-svg');
  if (!oldSvg) return;
  var svg = oldSvg.cloneNode(false);
  svg.innerHTML = '<g data-tcf-viewport><g data-tcf-links></g><g data-tcf-nodes></g></g>';
  oldSvg.replaceWith(svg);

  var viewport = svg.querySelector('[data-tcf-viewport]');
  var linksLayer = svg.querySelector('[data-tcf-links]');
  var nodesLayer = svg.querySelector('[data-tcf-nodes]');
  var BOX_W = 310;
  var BOX_H = 70;
  var PERSON_H = 58;
  var PERSON_GAP = 7;
  var FAMILY_TOP = 12;
  var X_STEP = 410;
  var ROW_GAP = 34;
  var MARGIN = 56;
  var scale = 1;
  var panX = 20;
  var panY = 20;
  var bounds = { width: 1000, height: 700 };
  var selected = '';
  var searchFocused = '';
  var renderedBounds = new Map();

  function extras(node) {
    return extrasByHost.get(clean(node.code)) || [];
  }

  function itemHeight(node) {
    var list = extras(node);
    return BOX_H + (list.length ? FAMILY_TOP + list.length * (PERSON_H + PERSON_GAP) - PERSON_GAP : 0);
  }

  function visibleTree() {
    var list = [];
    function visit(node, parent, depth) {
      var item = { node: node, parent: parent, depth: depth, x: 0, y: 0, height: itemHeight(node), subtreeHeight: 0, children: [] };
      list.push(item);
      if (node.expanded) item.children = (node.children || []).map(function (child) { return visit(child, node, depth + 1); });
      return item;
    }
    return { list: list, root: visit(treeData, null, 0) };
  }

  function layout() {
    var tree = visibleTree();
    function measure(item) {
      if (!item.children.length) return (item.subtreeHeight = item.height);
      var total = item.children.reduce(function (sum, child) { return sum + measure(child); }, 0) + ROW_GAP * (item.children.length - 1);
      item.subtreeHeight = Math.max(item.height, total);
      return item.subtreeHeight;
    }
    function place(item, top) {
      item.x = MARGIN + item.depth * X_STEP;
      item.y = top + (item.subtreeHeight - item.height) / 2;
      if (!item.children.length) return;
      var total = item.children.reduce(function (sum, child) { return sum + child.subtreeHeight; }, 0) + ROW_GAP * (item.children.length - 1);
      var next = top + (item.subtreeHeight - total) / 2;
      item.children.forEach(function (child) {
        place(child, next);
        next += child.subtreeHeight + ROW_GAP;
      });
    }
    measure(tree.root);
    place(tree.root, MARGIN);
    var maxDepth = Math.max.apply(null, tree.list.map(function (item) { return item.depth; }).concat([0]));
    var maxBottom = Math.max.apply(null, tree.list.map(function (item) { return item.y + item.height; }).concat([MARGIN]));
    bounds = { width: MARGIN * 2 + maxDepth * X_STEP + BOX_W, height: maxBottom + MARGIN };
    return tree.list;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character];
    });
  }

  function wrap(text, max) {
    var words = clean(text).split(/\s+/).filter(Boolean);
    var lines = [];
    var line = '';
    words.forEach(function (word) {
      var next = (line + ' ' + word).trim();
      if (next.length > (max || 36) && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    if (lines.length > 2) lines[1] = lines.slice(1).join(' ').slice(0, (max || 36) - 1) + '…';
    return lines.slice(0, 2);
  }

  function colors(code) {
    if (code === '0.0' || code === '5.0') return { fill: '#174f39', text: '#fff', stroke: '#0d3425' };
    if (code.indexOf('1.') === 0) return { fill: '#e8f2fb', text: '#173a57', stroke: '#4d82aa' };
    if (code.indexOf('2.') === 0) return { fill: '#fff4cf', text: '#4d3b00', stroke: '#9c7712' };
    if (code.indexOf('3.') === 0) return { fill: '#f9e4e4', text: '#572626', stroke: '#a64242' };
    return { fill: '#fff1df', text: '#553719', stroke: '#a86c2f' };
  }

  function labelFor(node) {
    return clean(node.label || (byCode.get(clean(node.code)) || {}).name || node.code);
  }

  function render() {
    var visible = layout();
    var positions = new Map(visible.map(function (item) { return [item.node.code, item]; }));
    renderedBounds = new Map();
    linksLayer.innerHTML = visible.map(function (item) {
      if (!item.parent || !positions.has(item.parent.code)) return '';
      var parent = positions.get(item.parent.code);
      var x1 = parent.x + BOX_W;
      var y1 = parent.y + BOX_H / 2;
      var x2 = item.x;
      var y2 = item.y + BOX_H / 2;
      var elbow = x1 + (x2 - x1) / 2;
      return '<path class="tcf-connector" d="M' + x1 + ',' + y1 + ' H' + elbow + ' V' + y2 + ' H' + x2 + '"/>';
    }).join('');

    nodesLayer.innerHTML = visible.map(function (item) {
      var node = item.node;
      var code = clean(node.code);
      var color = colors(code);
      var lines = wrap(labelFor(node), 36);
      var hasChildren = (node.children || []).length > 0;
      var terminal = isTerminalSonCode(code);
      var carrier = !terminal && item.depth > 0;
      var marker = carrier || hasChildren;
      var symbol = hasChildren && node.expanded ? '−' : '+';
      var classes = ['tcf-node', 'tcf-main-node'];
      if (terminal) classes.push('tcf-terminal-son');
      if (carrier) classes.push('tcf-surname-carrier');
      if (selected === code) classes.push('tcf-focus');
      if (searchFocused === code) classes.push('tcf-search-focus');
      renderedBounds.set(code, { x: item.x, y: item.y, width: BOX_W, height: BOX_H });
      var main = '<g class="' + classes.join(' ') + '" data-tcf-code="' + esc(code) + '" transform="translate(' + item.x + ',' + item.y + ')" role="button" tabindex="0" aria-label="' + esc(code + ' ' + labelFor(node)) + '">' +
        '<rect width="' + BOX_W + '" height="' + BOX_H + '" rx="10" fill="' + color.fill + '" stroke="' + color.stroke + '"></rect>' +
        '<text class="tcf-code" x="14" y="20" fill="' + color.text + '">' + esc(code) + '</text>' +
        lines.map(function (line, index) { return '<text class="tcf-label" x="14" y="' + (44 + index * 16) + '" fill="' + color.text + '">' + esc(line) + '</text>'; }).join('') +
        (marker ? '<g class="tcf-carrier-mark" aria-hidden="true"><circle cx="286" cy="23" r="16"></circle><text x="286" y="30" text-anchor="middle">' + symbol + '</text></g>' : '') +
        '</g>';

      var y = item.y + BOX_H + FAMILY_TOP;
      var family = extras(node).map(function (person, index) {
        var className = personClass(person);
        var personLines = wrap(person.name + (person.qualifier ? ' · ' + person.qualifier : ''), 39);
        var top = y + index * (PERSON_H + PERSON_GAP);
        var line = '<path class="tcf-family-line" d="M' + (item.x + BOX_W / 2) + ',' + (index ? top - PERSON_GAP : item.y + BOX_H) + ' V' + top + '"/>';
        var focusClass = searchFocused === person.code ? ' tcf-search-focus' : '';
        renderedBounds.set(person.code, { x: item.x, y: top, width: BOX_W, height: PERSON_H });
        return line + '<g class="tcf-person ' + className + focusClass + '" data-tcf-person="' + esc(person.code) + '" transform="translate(' + item.x + ',' + top + ')" role="button" tabindex="0" aria-label="' + esc(person.code + ' ' + person.name) + '">' +
          '<rect width="' + BOX_W + '" height="' + PERSON_H + '" rx="8"></rect>' +
          '<text class="tcf-code" x="12" y="17">' + esc(person.code) + '</text>' +
          personLines.map(function (part, lineIndex) { return '<text class="tcf-person-name" x="12" y="' + (37 + lineIndex * 14) + '">' + esc(part) + '</text>'; }).join('') +
          '</g>';
      }).join('');
      return main + family;
    }).join('');

    nodesLayer.querySelectorAll('[data-tcf-code]').forEach(function (group) {
      function activate() {
        var code = group.getAttribute('data-tcf-code');
        var node = structuralNodes.get(code);
        if (!node) return;
        selected = code;
        searchFocused = '';
        showRecord(byCode.get(code) || { code: code, name: labelFor(node), note: node.detail || '' });
        if ((node.children || []).length) node.expanded = !node.expanded;
        render();
      }
      group.addEventListener('click', function (event) { event.stopPropagation(); activate(); });
      group.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
      });
    });

    nodesLayer.querySelectorAll('[data-tcf-person]').forEach(function (group) {
      function activate() {
        var person = byCode.get(group.getAttribute('data-tcf-person'));
        if (!person) return;
        selected = person.code;
        searchFocused = '';
        showRecord(person);
        render();
      }
      group.addEventListener('click', function (event) { event.stopPropagation(); activate(); });
      group.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
      });
    });
    apply();
  }

  function detailElements() {
    return {
      box: document.querySelector('#details,[data-tree-details]'),
      title: document.querySelector('#detailTitle,[data-tree-detail-title]'),
      code: document.querySelector('#detailCode,[data-tree-detail-code]'),
      text: document.querySelector('#detailText,[data-tree-detail-text]'),
      section: document.querySelector('#detailSection')
    };
  }

  var isEnglish = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
  function showRecord(person) {
    var details = detailElements();
    if (!details.box) return;
    if (details.title) details.title.textContent = person.name || (isEnglish ? 'Unknown person' : 'Nepoznata osoba');
    if (details.code) details.code.textContent = (isEnglish ? 'Code: ' : 'Šifra: ') + (person.code || '');
    if (details.section) details.section.textContent = '';
    if (details.text) {
      details.text.textContent = [
        person.qualifier,
        person.relation,
        person.father ? (isEnglish ? 'Father: ' : 'Otac: ') + person.father : '',
        person.mother ? (isEnglish ? 'Mother: ' : 'Majka: ') + person.mother : '',
        person.note
      ].filter(Boolean).join('\n');
    }
    details.box.classList.add('open');
  }

  function apply() {
    viewport.setAttribute('transform', 'translate(' + panX + ',' + panY + ') scale(' + scale + ')');
  }

  function fit() {
    var rectangle = svg.getBoundingClientRect();
    if (!rectangle.width || !rectangle.height) return;
    scale = Math.max(0.07, Math.min((rectangle.width - 42) / bounds.width, (rectangle.height - 42) / bounds.height, 1.12));
    panX = (rectangle.width - bounds.width * scale) / 2;
    panY = (rectangle.height - bounds.height * scale) / 2;
    searchFocused = '';
    apply();
  }

  function zoom(factor, centerX, centerY) {
    var old = scale;
    scale = Math.max(0.07, Math.min(4, scale * factor));
    panX = centerX - (centerX - panX) * (scale / old);
    panY = centerY - (centerY - panY) * (scale / old);
    apply();
  }

  function setDepth(maxDepth) {
    walk(treeData, function (node, _parent, depth) { node.expanded = depth < maxDepth; });
    treeData.expanded = true;
  }

  function replaceControl(selector, handler) {
    var old = document.querySelector(selector);
    if (!old) return null;
    var fresh = old.cloneNode(true);
    old.replaceWith(fresh);
    fresh.addEventListener('click', handler);
    return fresh;
  }

  replaceControl('#expandAll,[data-tree-action="expand"]', function () { walk(treeData, function (node) { node.expanded = true; }); render(); fit(); });
  replaceControl('#collapse,[data-tree-action="collapse"]', function () { walk(treeData, function (node) { node.expanded = false; }); treeData.expanded = true; render(); fit(); });
  replaceControl('#threeLevels,[data-tree-action="three"]', function () { setDepth(3); render(); fit(); });
  replaceControl('#fit,[data-tree-action="fit"]', fit);
  replaceControl('#zoomIn,[data-tree-action="zoom-in"]', function () { zoom(1.22, svg.clientWidth / 2, svg.clientHeight / 2); });
  replaceControl('#zoomOut,[data-tree-action="zoom-out"]', function () { zoom(0.82, svg.clientWidth / 2, svg.clientHeight / 2); });

  document.querySelectorAll('.branch-button').forEach(function (old) {
    var fresh = old.cloneNode(true);
    old.replaceWith(fresh);
    fresh.addEventListener('click', function () {
      var target = clean(fresh.getAttribute('data-code'));
      walk(treeData, function (node) {
        if (target && clean(node.code).indexOf(target) === 0) node.expanded = true;
      });
      render();
      fit();
    });
  });

  function normalize(value) {
    return clean(value).toLocaleLowerCase(isEnglish ? 'en' : 'hr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function searchScore(person, query) {
    var code = normalize(person.code);
    var name = normalize(person.name);
    var haystack = normalize([person.code, person.name, person.qualifier, person.father, person.mother, person.relation, person.note].join(' '));
    if (query === code) return 0;
    if (query === name) return 1;
    if (code.indexOf(query) === 0) return 2;
    if (name.indexOf(query) === 0) return 3;
    if (haystack.indexOf(query) >= 0) return 4;
    return Infinity;
  }

  function expandAncestors(code) {
    function visit(node) {
      if (node.code === code) return true;
      for (var index = 0; index < (node.children || []).length; index += 1) {
        if (visit(node.children[index])) {
          node.expanded = true;
          return true;
        }
      }
      return false;
    }
    visit(treeData);
  }

  function elementForCode(code) {
    var result = null;
    nodesLayer.querySelectorAll('[data-tcf-code],[data-tcf-person]').forEach(function (element) {
      if (element.getAttribute('data-tcf-code') === code || element.getAttribute('data-tcf-person') === code) result = element;
    });
    return result;
  }

  function focusRecord(person) {
    var hostCode = structuralNodes.has(person.code) ? person.code : nearestStructuralHost(person);
    expandAncestors(hostCode);
    selected = person.code;
    searchFocused = person.code;
    render();
    requestAnimationFrame(function () {
      var targetBounds = renderedBounds.get(person.code) || renderedBounds.get(hostCode);
      var target = elementForCode(person.code) || elementForCode(hostCode);
      if (!targetBounds || !target) return;
      var rectangle = svg.getBoundingClientRect();
      var desiredScale = Math.max(1.45, Math.min(2.1, Math.min((rectangle.width * 0.62) / targetBounds.width, (rectangle.height * 0.42) / targetBounds.height)));
      scale = desiredScale;
      panX = rectangle.width / 2 - (targetBounds.x + targetBounds.width / 2) * scale;
      panY = rectangle.height / 2 - (targetBounds.y + targetBounds.height / 2) * scale;
      apply();
      try { target.focus({ preventScroll: true }); } catch (_error) { target.focus(); }
    });
  }

  var searchOld = document.querySelector('#search,#treeSearch,[data-diagram-search-input],[data-tandara-search-input],input[type="search"]');
  var search = null;
  if (searchOld) {
    search = searchOld.cloneNode(true);
    searchOld.replaceWith(search);
  }
  var findOld = document.querySelector('#findBtn,[data-diagram-search-button],[data-tandara-search-button]');
  var findButton = null;
  if (findOld) {
    findButton = findOld.cloneNode(true);
    findOld.replaceWith(findButton);
  }
  document.querySelectorAll('.search-results,.tandara-person-search-results').forEach(function (panel) { panel.hidden = true; });

  function showStatus(message) {
    var status = document.querySelector('#status,[data-tandara-search-status]');
    if (status) {
      status.textContent = message;
      status.classList.add('show');
      window.setTimeout(function () { status.classList.remove('show'); }, 2600);
    }
  }

  function find() {
    if (!search) return;
    var query = normalize(search.value);
    if (!query) return;
    var matches = records.map(function (person, index) {
      return { person: person, index: index, score: searchScore(person, query) };
    }).filter(function (match) { return Number.isFinite(match.score); });
    matches.sort(function (a, b) { return a.score - b.score || a.index - b.index; });
    if (!matches.length) {
      showStatus((isEnglish ? 'No result for: ' : 'Nema rezultata za: ') + search.value.trim());
      return;
    }
    var person = matches[0].person;
    showRecord(person);
    focusRecord(person);
  }

  if (findButton) findButton.addEventListener('click', find);
  if (search) search.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); find(); }
  });

  var close = document.querySelector('#closeDetails,[data-tree-close]');
  if (close) close.addEventListener('click', function () {
    var details = detailElements();
    if (details.box) details.box.classList.remove('open');
  });

  var dragging = false;
  var dragStart = null;
  svg.addEventListener('pointerdown', function (event) {
    if (event.target.closest('[data-tcf-code],[data-tcf-person]')) return;
    dragging = true;
    dragStart = { x: event.clientX, y: event.clientY, panX: panX, panY: panY };
    try { svg.setPointerCapture(event.pointerId); } catch (_error) {}
  });
  svg.addEventListener('pointermove', function (event) {
    if (!dragging) return;
    panX = dragStart.panX + event.clientX - dragStart.x;
    panY = dragStart.panY + event.clientY - dragStart.y;
    apply();
  });
  svg.addEventListener('pointerup', function () { dragging = false; });
  svg.addEventListener('pointercancel', function () { dragging = false; });
  svg.addEventListener('wheel', function (event) {
    event.preventDefault();
    var rectangle = svg.getBoundingClientRect();
    zoom(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - rectangle.left, event.clientY - rectangle.top);
  }, { passive: false });

  function updateSubtitle() {
    var subtitle = document.querySelector('.diagram-subtitle,.subtitle');
    if (!subtitle) return;
    var spouseCount = records.filter(function (person) { return personClass(person) === 'tcf-spouse'; }).length;
    var daughterCount = records.filter(function (person) { return personClass(person) === 'tcf-daughter'; }).length;
    var terminalSonCount = records.filter(function (person) { return isTerminalSonCode(person.code); }).length;
    var carrierCount = records.filter(function (person) { return structuralNodes.has(person.code) && !isTerminalSonCode(person.code); }).length;
    subtitle.innerHTML = isEnglish
      ? '<strong>' + records.length + '</strong> coded people · <strong>' + carrierCount + '</strong> surname carriers · <strong>' + spouseCount + '</strong> spouses · <strong>' + daughterCount + '</strong> daughters · <strong>' + terminalSonCount + '</strong> terminal sons'
      : '<strong>' + records.length + '</strong> osoba sa šifrom · <strong>' + carrierCount + '</strong> nositelja prezimena · <strong>' + spouseCount + '</strong> supruga · <strong>' + daughterCount + '</strong> kćeri · <strong>' + terminalSonCount + '</strong> završnih sinova';
  }

  setDepth(2);
  updateSubtitle();
  render();
  requestAnimationFrame(fit);
  window.addEventListener('resize', fit);
  window.TandaraCompleteFamilyDiagramReady = true;
}());
