/**
 * Organisation chart layout for the phone app: the same code as the website's
 * ui/utils/orgChartLayout.mjs (which the server also uses for the PDF), so the
 * app, the website and the PDF draw the same chart. Change both together
 * (testenv/orgchart-layout-test.mjs checks they agree).
 *
 * Top-down tree. A manager whose reports have no reports of their own gets
 * them in two columns either side of one line (much narrower than a row);
 * very large teams are split into several such columns. People with no
 * manager and nobody under them are listed apart, under the chart.
 *
 * Plain JavaScript, no imports: it runs in the browser and in Node.
 */

export const ORG_CHART_SIZES = {
  screen: { boxW: 224, boxH: 84, gapX: 28, gapY: 56, stub: 18, rowGap: 16, maxRows: 6, sectionGap: 84, labelH: 34, treeGap: 64 },
  pdf: { boxW: 168, boxH: 58, gapX: 16, gapY: 36, stub: 12, rowGap: 10, maxRows: 6, sectionGap: 52, labelH: 22, treeGap: 36 }
};

// Muted colours that print well; one per department, the same on screen and in the PDF.
const DEPARTMENT_COLOURS = ['#1F3445', '#F38121', '#2E7D6B', '#7A4FB5', '#C2410C', '#0E7490', '#B45309', '#4D7C0F', '#BE185D', '#475569', '#9F1239', '#1D4ED8'];

export function idOf(node) {
  return String(node?._id ?? node?.id ?? '');
}

export function personName(p) {
  return `${p?.firstName || ''} ${p?.lastName || ''}`.trim() || p?.employeeCode || 'Employee';
}

export function personInitials(p) {
  const parts = personName(p).split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || 'E').slice(0, 2)).toUpperCase();
}

const NO_DEPARTMENT = '#A2A1A6';
const departmentKey = (name) => String(name || '').trim().toLowerCase();

/** A colour for any department name (by its letters), for when the full list is not known. */
export function departmentColour(name) {
  const key = departmentKey(name);
  if (!key) return NO_DEPARTMENT;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return DEPARTMENT_COLOURS[hash % DEPARTMENT_COLOURS.length];
}

/**
 * Colours for the company's departments in alphabetical order, so up to 12
 * departments never share one. Build it from the whole company (not one
 * team) and the screen and the PDF agree.
 */
export function departmentPalette(names = []) {
  const keys = [...new Set(names.map(departmentKey).filter(Boolean))].sort();
  const map = new Map(keys.map((k, i) => [k, DEPARTMENT_COLOURS[i % DEPARTMENT_COLOURS.length]]));
  return (name) => map.get(departmentKey(name)) || departmentColour(name);
}

/** Every department name in the forest (as written on the first person who has it). */
export function departmentsOf(roots = []) {
  const seen = new Map();
  const walk = (n) => { const k = departmentKey(n.department); if (k && !seen.has(k)) seen.set(k, String(n.department).trim()); (n.children || []).forEach(walk); };
  roots.forEach(walk);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Everyone in the forest, with parent, depth and team size (all levels below). */
export function indexOrgForest(roots = []) {
  const byId = new Map();
  const parentOf = new Map();
  const depthOf = new Map();
  const teamSize = new Map();
  const walk = (node, parent, depth) => {
    const id = idOf(node);
    byId.set(id, node);
    if (parent) parentOf.set(id, idOf(parent));
    depthOf.set(id, depth);
    let size = 0;
    for (const child of node.children || []) size += 1 + walk(child, node, depth + 1);
    teamSize.set(id, size);
    return size;
  };
  roots.forEach((r) => walk(r, null, 0));
  return { byId, parentOf, depthOf, teamSize };
}

/** The rows of the list view, top to bottom, with what is needed to draw tree guides. */
export function flattenOrgForest(roots = [], isCollapsed = () => false) {
  const rows = [];
  const walk = (node, depth, lastFlags) => {
    const id = idOf(node);
    const kids = node.children || [];
    const collapsed = kids.length > 0 && isCollapsed(id);
    rows.push({ id, node, depth, lastFlags, reports: kids.length, collapsed });
    if (collapsed) return;
    kids.forEach((child, i) => walk(child, depth + 1, [...lastFlags, i === kids.length - 1]));
  };
  roots.forEach((r, i) => walk(r, 0, [i === roots.length - 1]));
  return rows;
}

/**
 * Positions for every visible person and the connector lines.
 * Returns { boxes: [{ id, node, x, y, w, h, depth, reports, collapsed }],
 *           lines: [[x1, y1, x2, y2]], width, height,
 *           section: { x, y, w, label, count } | null }   (section = "No reporting manager")
 */
export function layoutOrgChart(roots = [], options = {}) {
  const o = { ...ORG_CHART_SIZES.screen, separateUnplaced: true, ...options };
  const { boxW: W, boxH: H, gapX, gapY, stub, rowGap, maxRows, sectionGap, labelH, treeGap } = o;
  const isCollapsed = o.isCollapsed || (() => false);
  const sizes = new Map();
  const boxes = [];
  const lines = [];
  const line = (x1, y1, x2, y2) => { if (x1 !== x2 || y1 !== y2) lines.push([x1, y1, x2, y2]); };
  const visibleKids = (n) => (n.children?.length && !isCollapsed(idOf(n)) ? n.children : []);
  const put = (n, x, y, depth) => {
    const box = { id: idOf(n), node: n, x, y, w: W, h: H, depth, reports: n.children?.length || 0, collapsed: Boolean(n.children?.length) && isCollapsed(idOf(n)) };
    boxes.push(box);
    return box;
  };

  function measure(n) {
    const kids = visibleKids(n);
    let m;
    if (!kids.length) {
      m = { mode: 'leaf', w: W, h: H };
    } else {
      const ms = kids.map(measure);
      if (kids.length >= 2 && ms.every((k) => k.mode === 'leaf')) {
        // Reports with nobody under them: two columns either side of one line.
        const groups = Math.ceil(kids.length / (2 * maxRows));
        const perGroup = Math.ceil(kids.length / groups);
        const rows = Math.ceil(perGroup / 2);
        const groupW = 2 * W + 2 * stub;
        m = { mode: 'pairs', groups, perGroup, rows, groupW, w: groups * groupW + (groups - 1) * gapX, h: H + gapY + rows * H + (rows - 1) * rowGap };
      } else {
        const childrenW = ms.reduce((t, k) => t + k.w, 0) + gapX * (kids.length - 1);
        m = { mode: 'row', childrenW, w: Math.max(W, childrenW), h: H + gapY + Math.max(...ms.map((k) => k.h)) };
      }
    }
    sizes.set(n, m);
    return m;
  }

  function place(n, left, top, depth) {
    const m = sizes.get(n);
    const kids = visibleKids(n);
    if (m.mode === 'leaf') return put(n, left + (m.w - W) / 2, top, depth);

    if (m.mode === 'pairs') {
      const parent = put(n, left + (m.w - W) / 2, top, depth);
      const pcx = parent.x + W / 2;
      const childTop = top + H + gapY;
      const busY = top + H + gapY / 2;
      const spines = [];
      for (let g = 0; g < m.groups; g += 1) {
        const group = kids.slice(g * m.perGroup, (g + 1) * m.perGroup);
        if (!group.length) continue;
        const gLeft = left + g * (m.groupW + gapX);
        const spineX = gLeft + m.groupW / 2;
        let lastMid = childTop + H / 2;
        group.forEach((child, i) => {
          const row = Math.floor(i / 2);
          const y = childTop + row * (H + rowGap);
          const onLeft = i % 2 === 0;
          put(child, onLeft ? spineX - stub - W : spineX + stub, y, depth + 1);
          line(onLeft ? spineX - stub : spineX + stub, y + H / 2, spineX, y + H / 2);
          lastMid = y + H / 2;
        });
        spines.push({ x: spineX, end: lastMid });
      }
      if (spines.length === 1) {
        line(pcx, top + H, pcx, spines[0].end);
      } else {
        line(pcx, top + H, pcx, busY);
        line(Math.min(spines[0].x, pcx), busY, Math.max(spines[spines.length - 1].x, pcx), busY);
        spines.forEach((s) => line(s.x, busY, s.x, s.end));
      }
      return parent;
    }

    // A row of teams side by side, the manager centred over them.
    let x = left + (m.w - m.childrenW) / 2;
    const childTop = top + H + gapY;
    const centres = kids.map((child) => {
      const box = place(child, x, childTop, depth + 1);
      x += sizes.get(child).w + gapX;
      return box.x + W / 2;
    });
    let px = (centres[0] + centres[centres.length - 1]) / 2 - W / 2;
    px = Math.min(Math.max(px, left), left + m.w - W);
    const parent = put(n, px, top, depth);
    const pcx = px + W / 2;
    const busY = top + H + gapY / 2;
    line(pcx, top + H, pcx, busY);
    line(Math.min(centres[0], pcx), busY, Math.max(centres[centres.length - 1], pcx), busY);
    centres.forEach((c) => line(c, busY, c, childTop));
    return parent;
  }

  const trees = o.separateUnplaced ? roots.filter((r) => r.children?.length) : roots;
  const unplaced = o.separateUnplaced ? roots.filter((r) => !r.children?.length) : [];

  let x = 0;
  let treesH = 0;
  trees.forEach((r) => {
    const m = measure(r);
    place(r, x, 0, 0);
    x += m.w + treeGap;
    treesH = Math.max(treesH, m.h);
  });
  const treesW = trees.length ? x - treeGap : 0;

  let section = null;
  let width = treesW;
  let height = treesH;
  if (unplaced.length) {
    const fit = treesW ? Math.floor((treesW + gapX) / (W + gapX)) : 5;
    const cols = Math.max(1, Math.min(unplaced.length, 8, Math.max(2, fit)));
    const top = (trees.length ? treesH + sectionGap : 0) + labelH;
    unplaced.forEach((r, i) => put(r, (i % cols) * (W + gapX), top + Math.floor(i / cols) * (H + rowGap), 0));
    const rows = Math.ceil(unplaced.length / cols);
    const gridW = cols * (W + gapX) - gapX;
    section = { x: 0, y: top - labelH, w: gridW, label: `No reporting manager (${unplaced.length})`, count: unplaced.length };
    width = Math.max(width, gridW);
    height = top + rows * (H + rowGap) - rowGap;
  }
  return { boxes, lines, width, height, section };
}
