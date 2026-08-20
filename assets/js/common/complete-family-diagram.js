(function () {
  'use strict';

  var embedded = document.getElementById('completeFamilyData');
  if (!embedded) return;

  var parsed;
  try { parsed = JSON.parse(embedded.textContent || '{}'); } catch (_error) { return; }
  var raw = Array.isArray(parsed) ? parsed : (parsed.persons || []);
  if (!raw.length) return;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function codeArray(value) { return Array.isArray(value) ? value.map(clean).filter(Boolean) : []; }
  function isSpouseCode(code) { return /-SP-?\d+$/i.test(code); }
  function isDaughterCode(code) { return /-K\d+$/i.test(code); }
  function isTerminalSonCode(code) { return /-S\d+$/i.test(code); }
  function isCollateralPath(code) { return /-(?:K\d+|SP-?\d+|V\d+)(?:-|$)/i.test(code); }
  function isVerticalCode(code) { return isSpouseCode(code) || isDaughterCode(code) || /-V\d+$/i.test(code); }
  function isStructuralCode(code) { return Boolean(code) && !isCollateralPath(code); }

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
      parentCodes: codeArray(person.parentCodes),
      spouseCodes: codeArray(person.spouseCodes),
      childCodes: codeArray(person.childCodes)
    };
  }).filter(function (person) { return person.code; });

  var byCode = new Map();
  records.forEach(function (person) { if (!byCode.has(person.code)) byCode.set(person.code, person); });

  var structuralRecords = records.filter(function (person) { return isStructuralCode(person.code); });
  var nodeByCode = new Map();
  structuralRecords.forEach(function (person) {
    nodeByCode.set(person.code, {
      code: person.code,
      label: [person.name, person.qualifier].filter(Boolean).join(' '),
      detail: person.note,
      expanded: false,
      children: [],
      parent: null,
      record: person
    });
  });

  function inferredParentCode(code) {
    if (isTerminalSonCode(code)) return code.replace(/-S\d+$/i, '');
    if (!/^\d+(?:\.\d+)+$/.test(code)) return '';
    var parts = code.split('.');
    if (parts.length <= 2) return '';
    parts.pop();
    return parts.join('.');
  }

  structuralRecords.forEach(function (person) {
    var node = nodeByCode.get(person.code);
    var parentCode = '';
    for (var i = 0; i < person.parentCodes.length; i += 1) {
      if (person.parentCodes[i] !== person.code && nodeByCode.has(person.parentCodes[i])) {
        parentCode = person.parentCodes[i];
        break;
      }
    }
    if (!parentCode) {
      var inferred = inferredParentCode(person.code);
      if (nodeByCode.has(inferred)) parentCode = inferred;
    }
    if (parentCode) {
      var parent = nodeByCode.get(parentCode);
      node.parent = parent;
      parent.children.push(node);
    }
  });

  function codeSort(a, b) {
    return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
  }
  nodeByCode.forEach(function (node) { node.children.sort(codeSort); });

  var requestedRoot = clean(document.body.getAttribute('data-root-code') || parsed.rootCode);
  var roots = Array.from(nodeByCode.values()).filter(function (node) { return !node.parent; }).sort(function (a, b) {
    return a.code.length - b.code.length || codeSort(a, b);
  });
  var treeData = nodeByCode.get(requestedRoot) || roots[0];
  if (!treeData) return;

  var extrasByHost = new Map();
  records.forEach(function (person) {
    if (isStructuralCode(person.code)) return;
    var host = person.hostCode;
    if (!nodeByCode.has(host)) {
      for (var i = 0; i < person.parentCodes.length; i += 1) {
        if (nodeByCode.has(person.parentCodes[i])) { host = person.parentCodes[i]; break; }
      }
    }
    if (!nodeByCode.has(host)) return;
    if (!extrasByHost.has(host)) extrasByHost.set(host, []);
    extrasByHost.get(host).push(person);
  });

  function relationText(person) { return (person.relation + ' ' + person.kind).toLocaleLowerCase('hr'); }
  function personClass(person) {
    var relation = relationText(person);
    if (isSpouseCode(person.code) || person.kind === 'spouse') return 'tcf-spouse';
    if (isDaughterCode(person.code) || relation.indexOf('kći') >= 0 || relation.indexOf('daughter') >= 0) return 'tcf-daughter';
    return 'tcf-related';
  }
  function extraOrder(person) {
    var cls = personClass(person);
    if (cls === 'tcf-spouse') return 0;
    if (cls === 'tcf-daughter') return 1;
    return 2;
  }
  extrasByHost.forEach(function (list) {
    list.sort(function (a, b) { return extraOrder(a) - extraOrder(b) || a.code.localeCompare(b.code, undefined, { numeric: true }); });
  });

  var oldSvg = document.querySelector('#treeSvg,.subtree-svg');
  if (!oldSvg) return;
  var svg = oldSvg.cloneNode(false);
  svg.innerHTML = '<g data-tcf-viewport><g data-tcf-links></g><g data-tcf-nodes></g></g>';
  oldSvg.replaceWith(svg);
  var viewport = svg.querySelector('[data-tcf-viewport]');
  var linksLayer = svg.querySelector('[data-tcf-links]');
  var nodesLayer = svg.querySelector('[data-tcf-nodes]');

  var BOX_W = 310, BOX_H = 72, PERSON_H = 58, PERSON_GAP = 7, FAMILY_TOP = 12;
  var X_STEP = 420, ROW_GAP = 34, MARGIN = 58;
  var scale = 1, panX = 20, panY = 20;
  var bounds = { width: 1000, height: 700 };
  var selected = '', searchFocused = '';
  var renderedBounds = new Map();

  function extras(node) { return extrasByHost.get(node.code) || []; }
  function itemHeight(node) {
    var list = extras(node);
    return BOX_H + (list.length ? FAMILY_TOP + list.length * (PERSON_H + PERSON_GAP) - PERSON_GAP : 0);
  }
  function walk(node, callback, depth) {
    callback(node, depth || 0);
    node.children.forEach(function (child) { walk(child, callback, (depth || 0) + 1); });
  }
  function visibleTree() {
    var list = [];
    function visit(node, depth) {
      var item = { node: node, depth: depth, x: 0, y: 0, height: itemHeight(node), subtreeHeight: 0, children: [] };
      list.push(item);
      if (node.expanded) item.children = node.children.map(function (child) { return visit(child, depth + 1); });
      return item;
    }
    return { list: list, root: visit(treeData, 0) };
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
      item.children.forEach(function (child) { place(child, next); next += child.subtreeHeight + ROW_GAP; });
    }
    measure(tree.root); place(tree.root, MARGIN);
    var maxDepth = Math.max.apply(null, tree.list.map(function (item) { return item.depth; }).concat([0]));
    var maxBottom = Math.max.apply(null, tree.list.map(function (item) { return item.y + item.height; }).concat([MARGIN]));
    bounds = { width: MARGIN * 2 + maxDepth * X_STEP + BOX_W, height: maxBottom + MARGIN };
    return tree.list;
  }

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]; }); }
  function wrap(text, max) {
    var words = clean(text).split(/\s+/).filter(Boolean), lines = [], line = '';
    words.forEach(function (word) {
      var next = (line + ' ' + word).trim();
      if (next.length > (max || 36) && line) { lines.push(line); line = word; } else line = next;
    });
    if (line) lines.push(line);
    if (lines.length > 2) lines[1] = lines.slice(1).join(' ').slice(0, (max || 36) - 1) + '…';
    return lines.slice(0, 2);
  }
  function colors(code) {
    if (/^1\./.test(code)) return { fill:'#e8f2fb', text:'#173a57', stroke:'#4d82aa' };
    if (/^2\./.test(code)) return { fill:'#fff4cf', text:'#4d3b00', stroke:'#9c7712' };
    if (/^3\./.test(code)) return { fill:'#f9e4e4', text:'#572626', stroke:'#a64242' };
    if (/^4\./.test(code)) return { fill:'#fff1df', text:'#553719', stroke:'#a86c2f' };
    return { fill:'#174f39', text:'#fff', stroke:'#0d3425' };
  }

  function render() {
    var visible = layout();
    var positions = new Map(visible.map(function (item) { return [item.node.code, item]; }));
    renderedBounds = new Map();
    linksLayer.innerHTML = visible.map(function (item) {
      var parentNode = item.node.parent;
      if (!parentNode || !positions.has(parentNode.code)) return '';
      var parent = positions.get(parentNode.code);
      var x1 = parent.x + BOX_W, y1 = parent.y + BOX_H / 2, x2 = item.x, y2 = item.y + BOX_H / 2;
      var elbow = x1 + (x2 - x1) / 2;
      var cls = searchFocused === item.node.code ? 'tcf-connector tcf-focused-connector' : 'tcf-connector';
      return '<path class="' + cls + '" data-tcf-link-to="' + esc(item.node.code) + '" d="M' + x1 + ',' + y1 + ' H' + elbow + ' V' + y2 + ' H' + x2 + '"/>';
    }).join('');

    nodesLayer.innerHTML = visible.map(function (item) {
      var node = item.node, code = node.code, color = colors(code), lines = wrap(node.label, 36);
      var hasChildren = node.children.length > 0;
      var terminal = isTerminalSonCode(code);
      var classes = ['tcf-node','tcf-main-node'];
      if (terminal) classes.push('tcf-terminal-son');
      if (selected === code) classes.push('tcf-focus');
      if (searchFocused === code) classes.push('tcf-search-focus');
      renderedBounds.set(code, { x:item.x, y:item.y, width:BOX_W, height:BOX_H });
      var symbol = node.expanded ? '−' : '+';
      var main = '<g class="' + classes.join(' ') + '" data-tcf-code="' + esc(code) + '" transform="translate(' + item.x + ',' + item.y + ')" role="button" tabindex="0" aria-label="' + esc(code + ' ' + node.label) + '">' +
        '<rect width="' + BOX_W + '" height="' + BOX_H + '" rx="10" fill="' + color.fill + '" stroke="' + color.stroke + '"></rect>' +
        '<text class="tcf-code" x="14" y="20" fill="' + color.text + '">' + esc(code) + '</text>' +
        lines.map(function (line,index) { return '<text class="tcf-label" x="14" y="' + (45 + index * 16) + '" fill="' + color.text + '">' + esc(line) + '</text>'; }).join('') +
        (hasChildren ? '<g class="tcf-carrier-mark" aria-hidden="true"><circle cx="284" cy="25" r="19"></circle><text x="284" y="34" text-anchor="middle">' + symbol + '</text></g>' : '') +
        '</g>';

      var baseY = item.y + BOX_H + FAMILY_TOP;
      var family = extras(node).map(function (person,index) {
        var cls = personClass(person), top = baseY + index * (PERSON_H + PERSON_GAP);
        var personLines = wrap(person.name + (person.qualifier ? ' · ' + person.qualifier : ''), 39);
        var lineStart = index ? top - PERSON_GAP : item.y + BOX_H;
        var focusClass = searchFocused === person.code ? ' tcf-search-focus' : '';
        renderedBounds.set(person.code, { x:item.x, y:top, width:BOX_W, height:PERSON_H });
        return '<path class="tcf-family-line' + (searchFocused === person.code ? ' tcf-focused-connector' : '') + '" d="M' + (item.x + BOX_W / 2) + ',' + lineStart + ' V' + top + '"/>' +
          '<g class="tcf-person ' + cls + focusClass + '" data-tcf-person="' + esc(person.code) + '" transform="translate(' + item.x + ',' + top + ')" role="button" tabindex="0" aria-label="' + esc(person.code + ' ' + person.name) + '">' +
          '<rect width="' + BOX_W + '" height="' + PERSON_H + '" rx="8"></rect><text class="tcf-code" x="12" y="17">' + esc(person.code) + '</text>' +
          personLines.map(function (part,lineIndex) { return '<text class="tcf-person-name" x="12" y="' + (37 + lineIndex * 14) + '">' + esc(part) + '</text>'; }).join('') + '</g>';
      }).join('');
      return main + family;
    }).join('');

    nodesLayer.querySelectorAll('[data-tcf-code]').forEach(function (group) {
      function activate() {
        var code = group.getAttribute('data-tcf-code'), node = nodeByCode.get(code); if (!node) return;
        selected = code; searchFocused = ''; showRecord(node.record);
        if (node.children.length) node.expanded = !node.expanded;
        render();
      }
      group.addEventListener('click', function (event) { event.stopPropagation(); activate(); });
      group.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
    });
    nodesLayer.querySelectorAll('[data-tcf-person]').forEach(function (group) {
      function activate() { var person = byCode.get(group.getAttribute('data-tcf-person')); if (!person) return; selected = person.code; searchFocused = ''; showRecord(person); render(); }
      group.addEventListener('click', function (event) { event.stopPropagation(); activate(); });
      group.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
    });
    apply();
  }

  var isEnglish = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
  function detailElements() { return { box:document.querySelector('#details,[data-tree-details]'), title:document.querySelector('#detailTitle,[data-tree-detail-title]'), code:document.querySelector('#detailCode,[data-tree-detail-code]'), text:document.querySelector('#detailText,[data-tree-detail-text]') }; }
  function showRecord(person) {
    var details = detailElements(); if (!details.box) return;
    if (details.title) details.title.textContent = person.name || (isEnglish ? 'Unknown person' : 'Nepoznata osoba');
    if (details.code) details.code.textContent = (isEnglish ? 'Code: ' : 'Šifra: ') + (person.code || '');
    if (details.text) details.text.textContent = [person.qualifier, person.relation, person.father ? (isEnglish ? 'Father: ' : 'Otac: ') + person.father : '', person.mother ? (isEnglish ? 'Mother: ' : 'Majka: ') + person.mother : '', person.note].filter(Boolean).join('\n');
    details.box.classList.add('open');
  }

  function apply() { viewport.setAttribute('transform', 'translate(' + panX + ',' + panY + ') scale(' + scale + ')'); }
  function fit() {
    var rect = svg.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    scale = Math.max(0.06, Math.min((rect.width - 42) / bounds.width, (rect.height - 42) / bounds.height, 1.1));
    panX = (rect.width - bounds.width * scale) / 2; panY = (rect.height - bounds.height * scale) / 2; searchFocused = ''; apply();
  }
  function zoom(factor,cx,cy) {
    var old = scale; scale = Math.max(0.06, Math.min(4, scale * factor));
    panX = cx - (cx - panX) * (scale / old); panY = cy - (cy - panY) * (scale / old); apply();
  }
  function setDepth(maxDepth) { walk(treeData, function (node,depth) { node.expanded = depth < maxDepth; }); treeData.expanded = true; }
  function bindButton(selector,handler) { var el=document.querySelector(selector); if(el) el.addEventListener('click',handler); }
  bindButton('#expandAll,[data-tree-action="expand"]', function(){ walk(treeData,function(node){node.expanded=true;}); render(); fit(); });
  bindButton('#collapse,[data-tree-action="collapse"]', function(){ walk(treeData,function(node){node.expanded=false;}); treeData.expanded=true; render(); fit(); });
  bindButton('#threeLevels,[data-tree-action="three"]', function(){ setDepth(3); render(); fit(); });
  bindButton('#fit,[data-tree-action="fit"]', fit);
  bindButton('#zoomIn,[data-tree-action="zoom-in"]', function(){ zoom(1.22,svg.clientWidth/2,svg.clientHeight/2); });
  bindButton('#zoomOut,[data-tree-action="zoom-out"]', function(){ zoom(0.82,svg.clientWidth/2,svg.clientHeight/2); });

  function normalize(value) { return clean(value).toLocaleLowerCase(isEnglish?'en':'hr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,' ').trim(); }
  function searchScore(person,query) {
    var code=normalize(person.code), name=normalize(person.name), hay=normalize([person.code,person.name,person.qualifier,person.father,person.mother,person.relation,person.note].join(' '));
    if(query===code) return 0; if(query===name) return 1; if(code.indexOf(query)===0) return 2; if(name.indexOf(query)===0) return 3; if(hay.indexOf(query)>=0) return 4; return Infinity;
  }
  function expandAncestors(node) { var current=node; while(current){ if(current.parent) current.parent.expanded=true; current=current.parent; } }
  function elementForCode(code) { return nodesLayer.querySelector('[data-tcf-code="' + CSS.escape(code) + '"],[data-tcf-person="' + CSS.escape(code) + '"]'); }
  function focusRecord(person) {
    var node = nodeByCode.get(person.code) || nodeByCode.get(person.hostCode);
    if (node) expandAncestors(node);
    selected = person.code; searchFocused = person.code; render();
    requestAnimationFrame(function(){
      var targetBounds = renderedBounds.get(person.code) || (node && renderedBounds.get(node.code));
      var target = elementForCode(person.code) || (node && elementForCode(node.code));
      if(!targetBounds || !target) return;
      var rect=svg.getBoundingClientRect();
      var desired=Math.min(2.5,Math.max(1.65,Math.min((rect.width*0.68)/targetBounds.width,(rect.height*0.48)/targetBounds.height)));
      scale=desired;
      panX=rect.width/2-(targetBounds.x+targetBounds.width/2)*scale;
      panY=rect.height/2-(targetBounds.y+targetBounds.height/2)*scale;
      apply();
      try{target.focus({preventScroll:true});}catch(_error){target.focus();}
    });
  }

  var search=document.querySelector('#search,#treeSearch,[data-diagram-search-input],input[type="search"]');
  var findButton=document.querySelector('#findBtn,[data-diagram-search-button]');
  function status(message){ var el=document.querySelector('#status,[data-diagram-status]'); if(el){el.textContent=message;el.classList.add('show');window.setTimeout(function(){el.classList.remove('show');},2600);} }
  function find(){
    if(!search) return; var query=normalize(search.value); if(!query) return;
    var matches=records.map(function(person,index){return{person:person,index:index,score:searchScore(person,query)};}).filter(function(m){return Number.isFinite(m.score);});
    matches.sort(function(a,b){return a.score-b.score||a.index-b.index;});
    if(!matches.length){status((isEnglish?'No result for: ':'Nema rezultata za: ')+search.value.trim());return;}
    showRecord(matches[0].person); focusRecord(matches[0].person);
  }
  if(findButton) findButton.addEventListener('click',find);
  if(search) search.addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();find();}});
  var close=document.querySelector('#closeDetails,[data-tree-close]'); if(close) close.addEventListener('click',function(){var d=detailElements();if(d.box)d.box.classList.remove('open');});

  var dragging=false,dragStart=null;
  svg.addEventListener('pointerdown',function(event){if(event.target.closest('[data-tcf-code],[data-tcf-person]'))return;dragging=true;dragStart={x:event.clientX,y:event.clientY,panX:panX,panY:panY};try{svg.setPointerCapture(event.pointerId);}catch(_error){}});
  svg.addEventListener('pointermove',function(event){if(!dragging)return;panX=dragStart.panX+event.clientX-dragStart.x;panY=dragStart.panY+event.clientY-dragStart.y;apply();});
  svg.addEventListener('pointerup',function(){dragging=false;}); svg.addEventListener('pointercancel',function(){dragging=false;});
  svg.addEventListener('wheel',function(event){event.preventDefault();var rect=svg.getBoundingClientRect();zoom(event.deltaY<0?1.12:0.89,event.clientX-rect.left,event.clientY-rect.top);},{passive:false});

  function updateSubtitle(){
    var subtitle=document.querySelector('.subtitle,.diagram-subtitle');if(!subtitle)return;
    var spouses=records.filter(function(p){return personClass(p)==='tcf-spouse';}).length;
    var daughters=records.filter(function(p){return personClass(p)==='tcf-daughter';}).length;
    var terminal=records.filter(function(p){return isTerminalSonCode(p.code);}).length;
    var carriers=structuralRecords.length-terminal;
    subtitle.innerHTML=isEnglish
      ? '<strong>'+records.length+'</strong> coded people · <strong>'+carriers+'</strong> numbered carriers · <strong>'+spouses+'</strong> spouses · <strong>'+daughters+'</strong> daughters · <strong>'+terminal+'</strong> S sons'
      : '<strong>'+records.length+'</strong> osoba sa šifrom · <strong>'+carriers+'</strong> brojčanih nositelja · <strong>'+spouses+'</strong> supruga · <strong>'+daughters+'</strong> kćeri · <strong>'+terminal+'</strong> S sinova';
  }

  setDepth(2); updateSubtitle(); render(); requestAnimationFrame(fit); window.addEventListener('resize',fit);
  window.TandaraCompleteFamilyDiagramReady=true;
}());
