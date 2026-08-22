/*
  TANDARA DIAGRAM MASTER — FINAL
  Zajednički tehnički motor za JAVNI i PRIVATNI TANDARA web.
  Osnova: Petrov DIJAGRAM-MASTER + usvojene Matina korekcije.
  Funkcije: +/− grane, više brakova i djeca po majci, 4-poljska pretraga,
  zoom/pan, fullscreen, print, detalji osobe, (★ rođenje - ✝ smrt), N.G.
  kvadrat, HR/EN te obavezni jezični flagovi (s automatskim fallbackom).
*/
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
  const rootCode = (DATA.meta && DATA.meta.rootCode) || document.body.dataset.rootCode || Object.keys(primary)[0] || '';

  const LANG = document.body.dataset.lang === 'en' ? 'en' : 'hr';
  const TXT = LANG === 'en' ? {
    missingRoot: 'Missing root person', code: 'Code', father: 'Father', mother: 'Mother', missing: 'not provided',
    opened: 'Opened', closed: 'Closed', branch: 'branch', enterSearch: 'Enter at least one search value.',
    noResults: 'No results for the entered data.', found: 'Found', fullOn: 'Full screen enabled.',
    fullDenied: 'The browser did not allow full screen.', openFamily: 'Open family', closeFamily: 'Close family',
    openSubbranch: 'Open sub-branch', privateDates: 'Dates are available only on the private website.',
    privateParents: 'Family details are available only on the private website.',
    marriageWord: 'marriage'
  } : {
    missingRoot: 'Nedostaje početna osoba', code: 'Šifra', father: 'Otac', mother: 'Majka', missing: 'podatak nije naveden',
    opened: 'Otvorena', closed: 'Zatvorena', branch: 'grana', enterSearch: 'Upišite barem jedan podatak za pretragu.',
    noResults: 'Nema rezultata za zadane podatke.', found: 'Pronađeno', fullOn: 'Cijeli ekran uključen.',
    fullDenied: 'Preglednik nije dopustio cijeli ekran.', openFamily: 'Otvori obitelj', closeFamily: 'Zatvori obitelj',
    openSubbranch: 'Otvori podgranu', privateDates: 'Godine su dostupne samo na privatnoj web-stranici.',
    privateParents: 'Obiteljski podaci dostupni su samo na privatnoj web-stranici.',
    marriageWord: 'brak'
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

  // MASTER rule: every interactive diagram must expose both HR and EN flags.
  // Existing explicit links are preserved. If a converted page accidentally
  // omits them, the master inserts a safe fallback pair automatically.
  function ensureLanguageFlags() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    const existing = topbar.querySelectorAll('.flag-btn');
    if (existing.length >= 2) return;

    const file = (window.location.pathname.split('/').pop() || 'index.html');
    const isEnglishFile = /-en\.html$/i.test(file);
    const hrFallback = isEnglishFile ? file.replace(/-en\.html$/i, '.html') : file;
    const enFallback = isEnglishFile ? file : file.replace(/\.html$/i, '-en.html');
    const hrHref = document.body.dataset.hrHref || hrFallback;
    const enHref = document.body.dataset.enHref || enFallback;
    const flagBase = document.body.dataset.flagBase || '';

    const makeFlag = (lang, href, src, title, active) => {
      const a = document.createElement('a');
      a.className = `icon-btn flag-btn${active ? ' active' : ''}`;
      a.href = href;
      a.target = '_top';
      a.lang = lang;
      a.hreflang = lang;
      a.title = title;
      if (active) a.setAttribute('aria-current', 'page');
      const img = document.createElement('img');
      img.src = `${flagBase}${src}`;
      img.alt = lang === 'hr' ? 'HR' : 'EN';
      a.appendChild(img);
      return a;
    };

    existing.forEach(node => node.remove());
    const home = topbar.querySelector('.home-btn');
    const hr = makeFlag('hr', hrHref, 'flag-hr.png', LANG === 'hr' ? 'Hrvatski' : 'Croatian', LANG === 'hr');
    const en = makeFlag('en', enHref, 'flag-uk.png', 'English', LANG === 'en');
    if (home) {
      home.insertAdjacentElement('afterend', en);
      home.insertAdjacentElement('afterend', hr);
    } else {
      topbar.prepend(en);
      topbar.prepend(hr);
    }
  }
  ensureLanguageFlags();

  const MIN_SCALE = 0.015;

  // Shared TANDARA geometry: parent on the left, next generation on the right.
  const MAIN_W = 284;
  const MAIN_H = 72;
  const SIDE_W = 270;
  const SIDE_H = 51;
  const SIDE_GAP = 7;
  const SIDE_TOP = 12;
  const MARRIAGE_LABEL_GAP = 18;
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

  function yearText(year) {
    if (!year) return 'N.G.';
    const value = String(year).trim();
    return /\.$/.test(value) ? value : `${value}.`;
  }

  function dateText(rec) {
    return `(★ ${yearText(rec && rec.birth)} - ✝ ${yearText(rec && rec.death)})`;
  }

  function dateHtml(rec) {
    const value = year => year
      ? esc(yearText(year))
      : `<span class="date-ng">N.G.</span>`;
    return `<span class="life-date">(★ ${value(rec && rec.birth)} - ✝ ${value(rec && rec.death)})</span>`;
  }

  function formatDetailHtml(text) {
    let out = esc(String(text || ''));
    const value = year => year
      ? esc(yearText(year))
      : `<span class="date-ng">N.G.</span>`;
    const pair = (birth, death) => `<span class="life-date">(★ ${value(birth)} - ✝ ${value(death)})</span>`;
    // Already-symbolized date pairs, if any occur in descriptive text.
    out = out.replace(/\(?\s*★\s*(N\.G\.|oko\s+\d{4}\.?|\d{4}\.?)\s*(?:[–—-]\s*)?✝\s*(N\.G\.|\d{4}\.?)\s*\)?/gi, (_, b, d) => pair(/^N\.G\./i.test(b) ? '' : b, /^N\.G\./i.test(d) ? '' : d));
    // HR legacy: (1953.- ), (1932.-1936.); EN legacy: (1953– ), (1932–1936).
    out = out.replace(/\((\d{4})\.?\s*(?:\.\s*)?(?:-|–|—)\s*(\d{4})?\.?\s*\)/g, (_, b, d) => pair(b, d || ''));
    return out;
  }

  function inlineDateSvg(rec, kind = 'node', opts = {}) {
    const isSide = kind === 'side';
    const cls = isSide ? 'side-dates' : 'node-dates';
    const y = opts.y || (isSide ? 36 : 46);
    const openX = opts.openX ?? (isSide ? 148 : 165);
    const starX = opts.starX ?? (openX + 6);
    const birthX = opts.birthX ?? (openX + 18);
    const dashX = opts.dashX ?? (openX + 50);
    const deathSymbolX = opts.deathSymbolX ?? (openX + 61);
    const deathX = opts.deathX ?? (openX + 74);
    const closeX = opts.closeX ?? (openX + 108);
    const badgeW = 23;
    const badgeH = 12;
    const badgeY = y - 10;
    const fontSize = opts.fontSize ? ` font-size="${opts.fontSize}"` : '';
    const naturalWidth = Boolean(opts.naturalWidth);

    const value = (year, valueX, maxW = 30) => {
      if (year) {
        const txt = yearText(year);
        const fit = !naturalWidth && txt.length > 6 ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';
        return `<text class="${cls}" x="${valueX}" y="${y}"${fontSize}${fit}>${esc(txt)}</text>`;
      }
      return `<g class="date-unknown"><rect class="date-unknown-box" x="${valueX - 1}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="0"></rect><text class="${cls} date-unknown-text" x="${valueX + badgeW / 2 - 1}" y="${y - 1}" text-anchor="middle" font-size="8">N.G.</text></g>`;
    };

    return `<g class="date-inline"><text class="${cls}" x="${openX}" y="${y}"${fontSize}>(</text><text class="${cls}" x="${starX}" y="${y}"${fontSize}>★</text>${value(rec && rec.birth, birthX, opts.birthW || 30)}<text class="${cls}" x="${dashX}" y="${y}"${fontSize}>-</text><text class="${cls}" x="${deathSymbolX}" y="${y}"${fontSize}>✝</text>${value(rec && rec.death, deathX, opts.deathW || 30)}<text class="${cls}" x="${closeX}" y="${y}"${fontSize}>)</text></g>`;
  }

  function rootNameAndDatesSvg(displayName, rec) {
    const parts = String(displayName || '').split(/\s+[–—-]\s+/);
    const main = parts.shift() || displayName;
    const sub = parts.join(' – ');
    const mainFit = main.length > 13 ? ' textLength="78" lengthAdjust="spacingAndGlyphs"' : '';
    let out = `<text class="node-label" x="13" y="43"${mainFit}>${esc(main)}</text>`;
    out += inlineDateSvg(rec, 'node', {
      y: 43, openX: 100, starX: 107, birthX: 120, dashX: 171,
      deathSymbolX: 183, deathX: 197, closeX: 230, fontSize: 11,
      naturalWidth: true
    });
    if (sub) out += `<text class="node-label" x="13" y="62" font-size="11.5">${esc(sub)}</text>`;
    return out;
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
    detailsDates.innerHTML = dateHtml(rec);
    detailsParents.textContent = `${TXT.father}: ${recFather(rec) || TXT.missing} · ${TXT.mother}: ${recMother(rec) || TXT.missing}`;
    const detail = String(recDetail(rec) || '').trim();
    detailsText.innerHTML = formatDetailHtml(detail);
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

  function spouseCodes(code) {
    return familyExtras(code).filter(member => nodes[member]?.type === 'spouse');
  }

  function isMultiMarriage(code) {
    return spouseCodes(code).length > 1;
  }

  function samePersonName(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    return Boolean(na && nb && na === nb);
  }

  function marriageGroups(code) {
    const spouses = spouseCodes(code);
    if (spouses.length < 2) return [];
    const children = [
      ...(primary[code]?.children || []),
      ...terminalSons(code),
      ...familyExtras(code).filter(member => nodes[member]?.type !== 'spouse')
    ];
    return spouses.map((spouseCode, index) => {
      const spouse = nodes[spouseCode] || {};
      const childCodes = children.filter(childCode => {
        const child = nodes[childCode] || primary[childCode] || {};
        return [child.mother, child.motherEn].some(mother =>
          [spouse.label, spouse.labelEn].some(name => samePersonName(mother, name))
        );
      });
      return { index: index + 1, spouseCode, childCodes };
    });
  }

  function marriageIndexForChild(hostCode, childCode) {
    const group = marriageGroups(hostCode).find(item => item.childCodes.includes(childCode));
    return group ? group.index : 0;
  }

  function marriageIndexForMember(hostCode, memberCode) {
    const groups = marriageGroups(hostCode);
    const spouseGroup = groups.find(item => item.spouseCode === memberCode);
    if (spouseGroup) return spouseGroup.index;
    return marriageIndexForChild(hostCode, memberCode);
  }

  function marriageLabel(index) {
    if (!index) return '';
    if (LANG === 'en') {
      if (index === 1) return '1st marriage';
      if (index === 2) return '2nd marriage';
      if (index === 3) return '3rd marriage';
      return `${index}th marriage`;
    }
    return `${index}. brak`;
  }

  function orderedFamilyExtras(code) {
    const extras = familyExtras(code);
    if (!isMultiMarriage(code)) return extras;
    const groups = marriageGroups(code);
    const used = new Set();
    const ordered = [];
    for (const group of groups) {
      if (extras.includes(group.spouseCode)) {
        ordered.push(group.spouseCode);
        used.add(group.spouseCode);
      }
      for (const extraCode of extras) {
        if (used.has(extraCode) || nodes[extraCode]?.type === 'spouse') continue;
        if (group.childCodes.includes(extraCode)) {
          ordered.push(extraCode);
          used.add(extraCode);
        }
      }
    }
    for (const extraCode of extras) {
      if (!used.has(extraCode)) ordered.push(extraCode);
    }
    return ordered;
  }

  function familyExtraLayout(code) {
    const extras = orderedFamilyExtras(code);
    if (!extras.length) return { items: [], totalHeight: 0 };
    const multi = isMultiMarriage(code);
    const items = [];
    let offset = SIDE_TOP;
    for (const extraCode of extras) {
      if (multi && nodes[extraCode]?.type === 'spouse') offset += MARRIAGE_LABEL_GAP;
      items.push({ code: extraCode, offset });
      offset += SIDE_H + SIDE_GAP;
    }
    return { items, totalHeight: offset - SIDE_GAP };
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
      const extraLayout = expanded.has(code) ? familyExtraLayout(code) : { items: [], totalHeight: 0 };
      item.height = MAIN_H + extraLayout.totalHeight;
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

    // Align the parent with the first child for the shared TANDARA layout.
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
        const extras = familyExtraLayout(item.code).items;
        extras.forEach(entry => {
          const code = entry.code;
          const sx = item.x + (MAIN_W - SIDE_W) / 2;
          const sy = item.y + MAIN_H + entry.offset;
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
      const extras = orderedFamilyExtras(item.code);
      if (!host || !extras.length) continue;
      const last = positions.get(extras[extras.length - 1]);
      if (last) links += `<path class="side-link" d="M${host.cx},${host.y + host.h} V${last.y}"/>`;

      for (const group of marriageGroups(item.code)) {
        const spousePos = positions.get(group.spouseCode);
        if (!spousePos) continue;
        for (const childCode of group.childCodes) {
          const childPos = positions.get(childCode);
          if (!childPos) continue;
          let d = '';
          if (childPos.type === 'side') {
            d = `M${spousePos.cx},${spousePos.y + spousePos.h} V${childPos.y}`;
          } else {
            const x1 = spousePos.x + spousePos.w;
            const y1 = spousePos.cy;
            const x2 = childPos.x;
            const y2 = childPos.cy;
            const elbow = x1 + Math.max(24, (x2 - x1) / 2);
            d = `M${x1},${y1} H${elbow} V${y2} H${x2}`;
          }
          links += `<path class="marriage-link" d="${d}"/>`;
        }
      }
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
      const structuralMarriage = item.parent ? marriageIndexForChild(item.parent, item.code) : 0;
      if (structuralMarriage) {
        html += `<text class="marriage-label marriage-child-label" x="${MAIN_W / 2}" y="-8" text-anchor="middle">${esc(marriageLabel(structuralMarriage))}</text>`;
      }
      html += `<rect width="${MAIN_W}" height="${MAIN_H}" rx="10"/>`;
      html += `<text class="node-code" x="13" y="19">${esc(item.code)}</text>`;
      if (isRoot && /\s+[–—-]\s+/.test(displayName)) {
        html += rootNameAndDatesSvg(displayName, rec);
      } else {
        html += inlineNameSvg(displayName, 'node');
        html += inlineDateSvg(rec, 'node');
      }
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
      for (const extraCode of orderedFamilyExtras(item.code)) {
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
        const sideMarriage = marriageIndexForMember(item.code, extraCode);
        if (sideMarriage) {
          html += `<text class="marriage-label" x="${SIDE_W / 2}" y="-7" text-anchor="middle">${esc(marriageLabel(sideMarriage))}</text>`;
        }
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
      `<button class="search-result" type="button" data-result="${esc(rec.code)}"><strong>${esc(rec.code)}</strong>${esc(personName(recLabel(rec)))}<small>${dateHtml(rec)} · ${TXT.father}: ${esc(recFather(rec) || '—')} · ${TXT.mother}: ${esc(recMother(rec) || '—')}</small></button>`
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
