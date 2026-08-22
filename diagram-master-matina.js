(() => {
  'use strict';

  const dataEl = document.getElementById('diagramData');
  if (!dataEl) return;

  let DATA;
  try {
    DATA = JSON.parse(dataEl.textContent);
  } catch (error) {
    console.error('Neispravni podaci dijagrama', error);
    return;
  }

  const nodes = DATA.nodes || {};
  const primary = DATA.primary || {};
  const sideByHost = DATA.sideByHost || {};
  const targets = DATA.targets || {};
  const rootCode = (DATA.meta && DATA.meta.rootCode) || document.body.dataset.rootCode || '2.0';

  const LANG = document.body.dataset.lang === 'en' ? 'en' : 'hr';
  const TXT = LANG === 'en' ? {
    missingRoot: 'Missing root person', code: 'Code', father: 'Father', mother: 'Mother', missing: 'not provided',
    opened: 'Opened', closed: 'Closed', branch: 'branch', enterSearch: 'Enter at least one search value.',
    noResults: 'No results for the entered data.', found: 'Found', fullOn: 'Full screen enabled.',
    fullDenied: 'The browser did not allow full screen.', openFamily: 'Open family', closeFamily: 'Close family',
    openSubbranch: 'Open sub-branch', privateDates: 'Dates are available only on the private website.',
    privateParents: 'Family details are available only on the private website.'
  } : {
    missingRoot: 'Nedostaje početna osoba', code: 'Šifra', father: 'Otac', mother: 'Majka', missing: 'podatak nije naveden',
    opened: 'Otvorena', closed: 'Zatvorena', branch: 'grana', enterSearch: 'Upišite barem jedan podatak za pretragu.',
    noResults: 'Nema rezultata za zadane podatke.', found: 'Pronađeno', fullOn: 'Cijeli ekran uključen.',
    fullDenied: 'Preglednik nije dopustio cijeli ekran.', openFamily: 'Otvori obitelj', closeFamily: 'Zatvori obitelj',
    openSubbranch: 'Otvori podgranu', privateDates: 'Godine su dostupne samo na privatnoj web-stranici.',
    privateParents: 'Obiteljski podaci dostupni su samo na privatnoj web-stranici.'
  };

  function localized(rec, key) {
    if (!rec) return '';
    if (LANG === 'en' && rec[`${key}En`] != null) return rec[`${key}En`];
    return rec[key] == null ? '' : rec[key];
  }
  function recLabel(rec) { return localized(rec, 'label'); }
  function recFather(rec) { return localized(rec, 'father'); }
  function recMother(rec) { return localized(rec, 'mother'); }
  function recDetail(rec) { return localized(rec, 'detail'); }

  const svg = document.getElementById('treeSvg');
  const viewport = document.getElementById('viewport');
  const linksLayer = document.getElementById('links');
  const nodesLayer = document.getElementById('nodesLayer');
  const workspace = document.getElementById('workspace');
  const statusBox = document.getElementById('diagramStatus');
  const resultsBox = document.getElementById('searchResults');
  const resultsTitle = document.getElementById('searchResultsTitle');
  const resultItems = document.getElementById('searchResultItems');
  const searchCode = document.getElementById('searchCode');
  const searchPerson = document.getElementById('searchPerson');
  const searchFather = document.getElementById('searchFather');
  const searchMother = document.getElementById('searchMother');
  const detailsBox = document.getElementById('personDetails');
  const detailsClose = document.getElementById('personDetailsClose');
  const detailsName = document.getElementById('personDetailsName');
  const detailsCode = document.getElementById('personDetailsCode');
  const detailsDates = document.getElementById('personDetailsDates');
  const detailsParents = document.getElementById('personDetailsParents');
  const detailsText = document.getElementById('personDetailsText');

  const MIN_SCALE = 0.015;

  // MASTER-0 geometry: father on the left, next generation on the right.
  const MAIN_W = 284;
  const MAIN_H = 72;
  const SIDE_W = 270;
  const SIDE_H = 51;
  const SIDE_GAP = 7;
  const SIDE_TOP = 12;
  const X_STEP = 390;
  const ROW_GAP = 34;
  const MARGIN_X = 76;
  const MARGIN_Y = 42;

  let expanded = new Set();
  let positions = new Map();
  let bounds = { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 };
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let selectedCode = '';
  let searchFocus = '';
  let dragging = false;
  let dragStart = null;
  let dragMoved = false;
  let statusTimer = 0;

  if (!primary[rootCode]) {
    showStatus(`${TXT.missingRoot} ${rootCode}`);
    return;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  // Case-insensitive and Croatian-diacritic-insensitive search.
  // Đuro / Djuro / Duro are intentionally normalized to the same value.
  function normalize(value) {
    return String(value ?? '')
      .toLocaleLowerCase('hr')
      .replace(/đ/g, 'd')
      .replace(/dj/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/[^a-z0-9.-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function labelLines(label, max = 34) {
    const words = String(label || '').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (let i = 0; i < words.length; i += 1) {
      const next = line ? `${line} ${words[i]}` : words[i];
      if (next.length > max && line) {
        lines.push(line);
        line = words[i];
        if (lines.length === 1 && i < words.length - 1) {
          const rest = [line, ...words.slice(i + 1)].join(' ');
          line = rest.length > max ? `${rest.slice(0, Math.max(1, max - 1)).trimEnd()}…` : rest;
          break;
        }
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines.slice(0, 2);
  }

  function personName(label) {
    return String(label || '')
      .replace(/\s*\((?:\d{4}\.)?–(?:\d{4}\.)?\)\s*/g, ' ')
      .replace(/\s*\((?:nema podataka za godine|dates unknown)\)\s*/ig, ' ')
      .replace(/\s+–\s+nadimak potomaka:\s*/i, ' – ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function dateText(rec) {
    if (rec && rec.protected) return TXT.privateDates;
    const birth = rec && rec.birth ? `${rec.birth}.` : 'N.G.';
    const death = rec && rec.death ? `${rec.death}.` : 'N.G.';
    return `★ ${birth}   ✝ ${death}`;
  }


  function inlineDateSvg(rec, kind = 'node') {
    if (rec && rec.protected) return '';
    const isSide = kind === 'side';
    const cls = isSide ? 'side-dates' : 'node-dates';
    const y = isSide ? 36 : 46;
    const birthSymbolX = isSide ? 160 : 174;
    const birthValueX = isSide ? 173 : 187;
    const deathSymbolX = isSide ? 210 : 224;
    const deathValueX = isSide ? 223 : 237;
    const badgeW = isSide ? 28 : 29;
    const badgeH = isSide ? 14 : 15;
    const badgeY = y - (isSide ? 11 : 12);

    const value = (year, valueX) => {
      if (year) return `<text class="${cls}" x="${valueX}" y="${y}">${esc(`${year}.`)}</text>`;
      return `<g class="date-unknown"><rect class="date-unknown-box" x="${valueX - 2}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="3"></rect><text class="${cls} date-unknown-text" x="${valueX + badgeW / 2 - 2}" y="${y}" text-anchor="middle">N.G.</text></g>`;
    };

    return `<g class="date-inline"><text class="${cls}" x="${birthSymbolX}" y="${y}">★</text>${value(rec && rec.birth, birthValueX)}<text class="${cls}" x="${deathSymbolX}" y="${y}">✝</text>${value(rec && rec.death, deathValueX)}</g>`;
  }

  function inlineNameSvg(name, kind = 'node') {
    const isSide = kind === 'side';
    const x = isSide ? 10 : 13;
    const y = isSide ? 36 : 46;
    const maxWidth = isSide ? 142 : 153;
    const className = isSide ? 'side-label' : 'node-label';
    const approxWidth = String(name || '').length * (isSide ? 6.15 : 6.85);
    const fit = approxWidth > maxWidth ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : '';
    return `<text class="${className}" x="${x}" y="${y}"${fit}>${esc(name)}</text>`;
  }

  function showPersonDetails(code) {
    if (!detailsBox || !nodes[code]) return;
    const rec = nodes[code];
    detailsName.textContent = personName(recLabel(rec));
    detailsCode.textContent = `${TXT.code}: ${code}`;
    detailsDates.textContent = dateText(rec);
    detailsParents.textContent = rec.protected ? TXT.privateParents : `${TXT.father}: ${recFather(rec) || TXT.missing} · ${TXT.mother}: ${recMother(rec) || TXT.missing}`;
    const detail = String(recDetail(rec) || '').trim();
    detailsText.textContent = detail;
    detailsText.hidden = !detail;
    detailsBox.hidden = false;
  }

  function showStatus(message) {
    clearTimeout(statusTimer);
    statusBox.textContent = message;
    statusBox.classList.add('show');
    statusTimer = setTimeout(() => statusBox.classList.remove('show'), 2200);
  }

  function isTerminalSonCode(code) {
    return /-S\d+$/.test(code);
  }

  function isStructural(code) {
    return Boolean(primary[code]) || (nodes[code] && nodes[code].type === 'son');
  }

  function primaryChildren(code) {
    return (primary[code]?.children || []).filter(child => primary[child]);
  }

  function terminalSons(code) {
    return (sideByHost[code] || []).filter(child => nodes[child]?.type === 'son' && !primary[child]);
  }

  function structuralChildren(code) {
    return [...primaryChildren(code), ...terminalSons(code)];
  }

  function familyExtras(code) {
    return (sideByHost[code] || []).filter(member => nodes[member]?.type !== 'son');
  }

  function structuralParent(code) {
    if (primary[code]) return primary[code].parent || '';
    if (nodes[code]?.type === 'son') return nodes[code].host || '';
    return '';
  }

  function hasFamily(code) {
    return structuralChildren(code).length > 0 || familyExtras(code).length > 0;
  }

  function visibleItemTree() {
    const list = [];
    function visit(code, parent = '', depth = 0) {
      const item = {
        code,
        parent,
        depth,
        children: [],
        x: 0,
        y: 0,
        height: MAIN_H,
        subtreeHeight: 0
      };
      list.push(item);
      const extras = expanded.has(code) ? familyExtras(code) : [];
      item.height = MAIN_H + (extras.length ? SIDE_TOP + extras.length * SIDE_H + (extras.length - 1) * SIDE_GAP : 0);
      if (expanded.has(code)) {
        item.children = structuralChildren(code).map(child => visit(child, code, depth + 1));
      }
      return item;
    }
    return { list, root: visit(rootCode) };
  }

  function layout() {
    const tree = visibleItemTree();

    function measure(item) {
      if (!item.children.length) {
        item.subtreeHeight = item.height;
        return item.subtreeHeight;
      }
      const childrenHeight = item.children.reduce((sum, child) => sum + measure(child), 0)
        + ROW_GAP * (item.children.length - 1);
      item.subtreeHeight = Math.max(item.height, childrenHeight);
      return item.subtreeHeight;
    }

    // Align the parent with the first child, as in the established Petar layout.
    // Remaining children continue downward; the virtual canvas takes the growth.
    function place(item, top) {
      item.x = MARGIN_X + item.depth * X_STEP;
      item.y = top;
      if (!item.children.length) return;
      let next = top;
      for (const child of item.children) {
        place(child, next);
        next += child.subtreeHeight + ROW_GAP;
      }
    }

    measure(tree.root);
    place(tree.root, MARGIN_Y);

    positions = new Map();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const item of tree.list) {
      positions.set(item.code, {
        code: item.code,
        type: 'structural',
        x: item.x,
        y: item.y,
        w: MAIN_W,
        h: MAIN_H,
        cx: item.x + MAIN_W / 2,
        cy: item.y + MAIN_H / 2,
        parent: item.parent,
        depth: item.depth
      });
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + MAIN_W);
      maxY = Math.max(maxY, item.y + MAIN_H);

      if (expanded.has(item.code)) {
        const extras = familyExtras(item.code);
        extras.forEach((code, index) => {
          const sx = item.x + (MAIN_W - SIDE_W) / 2;
          const sy = item.y + MAIN_H + SIDE_TOP + index * (SIDE_H + SIDE_GAP);
          positions.set(code, {
            code,
            type: 'side',
            x: sx,
            y: sy,
            w: SIDE_W,
            h: SIDE_H,
            cx: sx + SIDE_W / 2,
            cy: sy + SIDE_H / 2,
            host: item.code
          });
          minX = Math.min(minX, sx);
          maxX = Math.max(maxX, sx + SIDE_W);
          maxY = Math.max(maxY, sy + SIDE_H);
        });
      }
    }

    if (!Number.isFinite(minX)) {
      minX = 0; minY = 0; maxX = 800; maxY = 600;
    }
    bounds = {
      minX: minX - 55,
      minY: minY - 40,
      maxX: maxX + 70,
      maxY: maxY + 65,
      width: maxX - minX + 125,
      height: maxY - minY + 105
    };
    return tree.list;
  }

  function connectorPath(parent, child) {
    const x1 = parent.x + parent.w;
    const y1 = parent.cy;
    const x2 = child.x;
    const y2 = child.cy;
    const elbow = x1 + (x2 - x1) / 2;
    return `M${x1},${y1} H${elbow} V${y2} H${x2}`;
  }

  function render() {
    const visible = layout();
    let links = '';

    for (const item of visible) {
      if (!item.parent) continue;
      const parent = positions.get(item.parent);
      const child = positions.get(item.code);
      if (!parent || !child) continue;
      const cls = searchFocus === item.code ? 'tree-link focused' : 'tree-link';
      links += `<path class="${cls}" d="${connectorPath(parent, child)}"/>`;
    }

    for (const item of visible) {
      if (!expanded.has(item.code)) continue;
      const host = positions.get(item.code);
      const extras = familyExtras(item.code);
      if (!host || !extras.length) continue;
      const last = positions.get(extras[extras.length - 1]);
      links += `<path class="side-link" d="M${host.cx},${host.y + host.h} V${last.y}"/>`;
    }

    linksLayer.innerHTML = links;
    let html = '';

    for (const item of visible) {
      const pos = positions.get(item.code);
      const rec = nodes[item.code];
      if (!pos || !rec) continue;
      const isRoot = item.code === rootCode;
      const terminal = isTerminalSonCode(item.code);
      const family = hasFamily(item.code);
      const classes = ['node', isRoot ? 'root' : terminal ? 'terminal' : 'primary'];
      if (rec.protected) classes.push('protected');
      if (selectedCode === item.code) classes.push('selected');
      if (searchFocus === item.code) classes.push('search-focus');
      const displayName = personName(recLabel(rec));

      html += `<g class="${classes.join(' ')}" data-code="${esc(item.code)}" transform="translate(${pos.x},${pos.y})" role="button" tabindex="0" aria-label="${esc(`${item.code} ${recLabel(rec)}`)}">`;
      html += `<title>${esc(`${personName(recLabel(rec))} · ${dateText(rec)}`)}</title>`;
      html += `<rect width="${MAIN_W}" height="${MAIN_H}" rx="10"/>`;
      html += `<text class="node-code" x="13" y="19">${esc(item.code)}</text>`;
      html += inlineNameSvg(displayName, 'node');
      html += inlineDateSvg(rec, 'node');
      if (family) {
        html += `<g class="toggle-hit" data-toggle="${esc(item.code)}" transform="translate(${MAIN_W - 18},18)" role="button" aria-label="${expanded.has(item.code) ? TXT.closeFamily : TXT.openFamily}">`;
        html += `<circle class="toggle-circle" r="15"></circle>`;
        html += `<text class="toggle-symbol" text-anchor="middle" y="9">${expanded.has(item.code) ? '−' : '+'}</text></g>`;
      }
      if (targets[item.code]) {
        html += `<g class="branch-link-hit" data-target-code="${esc(item.code)}" transform="translate(${MAIN_W - 52},18)" role="link" aria-label="${TXT.openSubbranch}">`;
        html += `<circle class="branch-link-circle" r="11"></circle><text class="branch-link-symbol" text-anchor="middle" y="5">↗</text></g>`;
      }
      html += '</g>';

      if (!expanded.has(item.code)) continue;
      for (const extraCode of familyExtras(item.code)) {
        const side = positions.get(extraCode);
        const sideRec = nodes[extraCode];
        if (!side || !sideRec) continue;
        const type = sideRec.type === 'spouse' ? 'spouse' : 'daughter';
        const sideClasses = ['side-node', type];
        if (sideRec.protected) sideClasses.push('protected');
        if (selectedCode === extraCode) sideClasses.push('selected');
        if (searchFocus === extraCode) sideClasses.push('search-focus');
        const sideName = personName(recLabel(sideRec));
        html += `<g class="${sideClasses.join(' ')}" data-code="${esc(extraCode)}" transform="translate(${side.x},${side.y})" role="button" tabindex="0" aria-label="${esc(`${extraCode} ${recLabel(sideRec)}`)}">`;
        html += `<title>${esc(`${personName(recLabel(sideRec))} · ${dateText(sideRec)}`)}</title>`;
        html += `<rect width="${SIDE_W}" height="${SIDE_H}" rx="8"/>`;
        html += `<text class="side-code" x="10" y="16">${esc(extraCode)}</text>`;
        html += inlineNameSvg(sideName, 'side');
        html += inlineDateSvg(sideRec, 'side');
        html += '</g>';
      }
    }

    nodesLayer.innerHTML = html;
    bindNodeEvents();
    applyTransform();
  }

  function bindNodeEvents() {
    nodesLayer.querySelectorAll('[data-toggle]').forEach(element => {
      element.addEventListener('click', event => {
        event.stopPropagation();
        if (dragMoved) return;
        toggle(element.dataset.toggle);
      });
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          toggle(element.dataset.toggle);
        }
      });
    });

    nodesLayer.querySelectorAll('[data-target-code]').forEach(element => {
      element.addEventListener('click', event => {
        event.stopPropagation();
        if (dragMoved) return;
        const url = targets[element.dataset.targetCode];
        if (url) window.top.location.href = url;
      });
    });

    nodesLayer.querySelectorAll('[data-code]').forEach(element => {
      element.addEventListener('click', event => {
        if (event.target.closest('[data-toggle],[data-target-code]') || dragMoved) return;
        event.stopPropagation();
        focusCode(element.dataset.code, true);
      });
      element.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('[data-toggle],[data-target-code]')) {
          event.preventDefault();
          focusCode(element.dataset.code, true);
        }
      });
    });
  }

  function applyTransform() {
    viewport.setAttribute('transform', `translate(${panX},${panY}) scale(${scale})`);
  }

  function fit() {
    const width = workspace.clientWidth;
    const height = workspace.clientHeight;
    if (!width || !height) return;
    const sx = (width - 40) / bounds.width;
    const sy = (height - 40) / bounds.height;
    scale = Math.max(MIN_SCALE, Math.min(1.18, sx, sy));
    panX = (width - (bounds.minX + bounds.maxX) * scale) / 2;
    panY = (height - (bounds.minY + bounds.maxY) * scale) / 2;
    applyTransform();
    showStatus('Dijagram je uklopljen u prostor.');
  }

  function zoomAt(factor, cx = workspace.clientWidth / 2, cy = workspace.clientHeight / 2) {
    const oldScale = scale;
    scale = Math.max(MIN_SCALE, Math.min(3.5, scale * factor));
    panX = cx - (cx - panX) * (scale / oldScale);
    panY = cy - (cy - panY) * (scale / oldScale);
    applyTransform();
  }

  function center(code, withZoom = true) {
    const pos = positions.get(code);
    if (!pos) return;
    if (withZoom) scale = Math.max(scale, 1.42);
    scale = Math.min(scale, 2.1);
    panX = workspace.clientWidth / 2 - pos.cx * scale;
    panY = workspace.clientHeight / 2 - pos.cy * scale;
    applyTransform();
  }

  function parentOfStructural(code) {
    return structuralParent(code);
  }

  function expandAncestorsFor(code) {
    const rec = nodes[code];
    if (!rec) return;

    let current;
    if (isStructural(code)) {
      current = code;
    } else {
      current = rec.host || '';
      if (current) expanded.add(current); // reveal spouse/daughter
    }

    const seen = new Set();
    while (current && isStructural(current) && !seen.has(current)) {
      seen.add(current);
      const parent = parentOfStructural(current);
      if (!parent) break;
      expanded.add(parent);
      current = parent;
    }
  }

  function focusCode(code, withZoom) {
    if (!nodes[code]) return;
    expandAncestorsFor(code);
    selectedCode = code;
    searchFocus = code;
    render();
    requestAnimationFrame(() => center(code, withZoom));
    showPersonDetails(code);
    showStatus(`${personName(recLabel(nodes[code]))} · ${code}`);
  }

  function clearExpandedBelow(code) {
    const stack = [...structuralChildren(code)];
    while (stack.length) {
      const child = stack.pop();
      expanded.delete(child);
      stack.push(...structuralChildren(child));
    }
  }

  function toggle(code) {
    if (!isStructural(code) || !hasFamily(code)) return;
    const beforePos = positions.get(code);
    const anchor = beforePos ? {
      x: panX + beforePos.cx * scale,
      y: panY + beforePos.cy * scale
    } : null;

    if (expanded.has(code)) {
      expanded.delete(code);
      clearExpandedBelow(code);
    } else {
      expanded.add(code);
    }

    selectedCode = code;
    render();

    const afterPos = positions.get(code);
    if (anchor && afterPos) {
      panX = anchor.x - afterPos.cx * scale;
      panY = anchor.y - afterPos.cy * scale;
      applyTransform();
    }
    showStatus(`${expanded.has(code) ? TXT.opened : TXT.closed} ${TXT.branch}: ${personName(recLabel(nodes[code]))}`);
  }

  function structuralDepthMap() {
    const map = new Map();
    function visit(code, depth) {
      if (map.has(code)) return;
      map.set(code, depth);
      structuralChildren(code).forEach(child => visit(child, depth + 1));
    }
    visit(rootCode, 0);
    return map;
  }

  const depths = structuralDepthMap();

  function setDepth(maxDepth) {
    expanded.clear();
    for (const [code, depth] of depths) {
      if (depth < maxDepth && hasFamily(code)) expanded.add(code);
    }
    render();
    requestAnimationFrame(fit);
  }

  function closeResults() {
    resultsBox.hidden = true;
    resultItems.innerHTML = '';
  }

  function matchField(value, query) {
    if (!query) return true;
    const haystack = normalize(value);
    const tokens = normalize(query).split(' ').filter(Boolean);
    return tokens.every(token => haystack.includes(token));
  }

  function search() {
    const qCode = searchCode.value.trim();
    const qPerson = searchPerson.value.trim();
    const qFather = searchFather.value.trim();
    const qMother = searchMother.value.trim();

    if (!qCode && !qPerson && !qFather && !qMother) {
      showStatus(TXT.enterSearch);
      return;
    }

    const found = Object.values(nodes).filter(rec =>
      matchField(rec.code, qCode)
      && matchField(recLabel(rec), qPerson)
      && matchField(recFather(rec), qFather)
      && matchField(recMother(rec), qMother)
    );

    found.sort((a, b) => {
      const aExact = normalize(a.code) === normalize(qCode) ? -1 : 0;
      const bExact = normalize(b.code) === normalize(qCode) ? -1 : 0;
      if (aExact !== bExact) return aExact - bExact;
      return String(a.code).localeCompare(String(b.code), 'hr', { numeric: true });
    });

    if (!found.length) {
      closeResults();
      showStatus(TXT.noResults);
      return;
    }

    // If the user entered a complete existing code, open that exact person
    // immediately instead of treating descendants with the same prefix as
    // additional matches (e.g. 2.2.1.1 also matches 2.2.1.1.1, ...).
    const exactCodeMatch = qCode
      ? found.find(rec => normalize(rec.code) === normalize(qCode))
      : null;
    if (exactCodeMatch) {
      closeResults();
      focusCode(exactCodeMatch.code, true);
      return;
    }

    if (found.length === 1) {
      closeResults();
      focusCode(found[0].code, true);
      return;
    }

    resultsTitle.textContent = `${TXT.found}: ${found.length}`;
    resultItems.innerHTML = found.slice(0, 80).map(rec =>
      `<button class="search-result" type="button" data-result="${esc(rec.code)}"><strong>${esc(rec.code)}</strong>${esc(personName(recLabel(rec)))}<small>${esc(dateText(rec))}${rec.protected ? '' : ` · ${TXT.father}: ${esc(recFather(rec) || '—')} · ${TXT.mother}: ${esc(recMother(rec) || '—')}`}</small></button>`
    ).join('');
    resultsBox.hidden = false;
    resultItems.querySelectorAll('[data-result]').forEach(button => {
      button.addEventListener('click', () => {
        closeResults();
        focusCode(button.dataset.result, true);
      });
    });
  }

  document.getElementById('findBtn').addEventListener('click', search);
  document.getElementById('searchResultsClose').addEventListener('click', closeResults);
  [searchCode, searchPerson, searchFather, searchMother].forEach(input => {
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        search();
      } else if (event.key === 'Escape') {
        closeResults();
      }
    });
  });

  document.getElementById('expandAll').addEventListener('click', () => {
    expanded.clear();
    for (const code of depths.keys()) {
      if (hasFamily(code)) expanded.add(code);
    }
    render();
    requestAnimationFrame(fit);
  });
  document.getElementById('collapse').addEventListener('click', () => {
    expanded.clear();
    selectedCode = '';
    searchFocus = '';
    render();
    requestAnimationFrame(fit);
  });
  document.getElementById('threeLevels').addEventListener('click', () => setDepth(3));
  document.getElementById('fit').addEventListener('click', fit);
  document.getElementById('zoomIn').addEventListener('click', () => zoomAt(1.22));
  document.getElementById('zoomOut').addEventListener('click', () => zoomAt(0.82));

  document.getElementById('fullscreenDiagram').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        showStatus(TXT.fullOn);
      } else {
        await document.exitFullscreen();
      }
    } catch (_error) {
      showStatus(TXT.fullDenied);
    }
  });
  document.getElementById('printDiagram').addEventListener('click', () => window.print());

  svg.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });

  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('[data-toggle],[data-target-code]')) return;
    dragging = true;
    dragMoved = false;
    dragStart = { x: event.clientX, y: event.clientY, panX, panY };
    workspace.classList.add('dragging');
    try { svg.setPointerCapture(event.pointerId); } catch (_error) { /* no-op */ }
  });

  svg.addEventListener('pointermove', event => {
    if (!dragging) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragMoved = true;
    if (!dragMoved) return;
    panX = dragStart.panX + dx;
    panY = dragStart.panY + dy;
    applyTransform();
  });

  function endDrag() {
    dragging = false;
    workspace.classList.remove('dragging');
    setTimeout(() => { dragMoved = false; }, 0);
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  if (detailsClose) {
    detailsClose.addEventListener('click', event => {
      event.stopPropagation();
      if (detailsBox) detailsBox.hidden = true;
    });
  }

  window.addEventListener('resize', () => {
    render();
    requestAnimationFrame(fit);
  });

  render();
  requestAnimationFrame(fit);
})();
