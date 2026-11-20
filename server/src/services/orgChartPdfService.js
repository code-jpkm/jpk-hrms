const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const PDFDocument = require('pdfkit');

/**
 * Organisation chart as a PDF, in the view the person is looking at.
 *
 * TREE, laid out by the same code as the screen (ui/utils/orgChartLayout.mjs):
 *  - FULL: one page as big as the chart, to zoom into on screen;
 *  - A4 / A3: ready to print. If the chart fits one sheet readably it is one
 *    page; otherwise it becomes a booklet: each manager with their direct
 *    reports, then each team, packed onto the pages at a readable size.
 * LIST: the indented list on A4 pages, with tree guide lines.
 * Teams closed on screen stay closed (their manager shows "+N").
 */

const LAYOUT_FILE = path.join(__dirname, '../../../ui/utils/orgChartLayout.mjs');
const LOGO_FILE = path.join(__dirname, '../../../public/brand/jpk-logo.png');
const PAPER = { A4: [595.28, 841.89], A3: [841.89, 1190.55] };
const MAX_PAGE = 14400; // PDF readers' largest page side (200 inches)
const MIN_PRINT_SCALE = 0.75; // smallest size that still reads on paper (names about 6.5 pt)
const MARGIN = 28;
const INK = '#142330';
const MUTED = '#6A6A6F';
const LINE = '#8A97A3';
const BORDER = '#D2D1D5';
const NAVY = '#1F3445';

let layoutLib;
async function loadLayout() {
  if (!layoutLib) layoutLib = await import(pathToFileURL(LAYOUT_FILE).href);
  return layoutLib;
}

// The built-in PDF fonts only know Western characters: keep names readable.
function pdfText(value) {
  return String(value ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E -ÿ]/g, '')
    .trim();
}

function fit(doc, text, width) {
  let s = pdfText(text);
  if (doc.widthOfString(s) <= width) return s;
  while (s.length > 1 && doc.widthOfString(`${s}...`) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

function stamp(now = new Date()) {
  return now.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

/** Logo, title, company and counts. Returns the y below it. */
function drawHeader(doc, { x, y, width, title, subtitle, note }) {
  let textX = x;
  if (fs.existsSync(LOGO_FILE)) {
    doc.image(LOGO_FILE, x, y, { height: 34 });
    textX = x + 76;
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(pdfText(title), textX, y + 1, { lineBreak: false });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(pdfText(subtitle), textX, y + 21, { lineBreak: false });
  const when = `Generated ${stamp()}`;
  doc.fontSize(8).text(when, x + width - doc.widthOfString(when), y + 3, { lineBreak: false });
  if (note) {
    doc.font('Helvetica-Bold').fillColor(NAVY);
    const n = pdfText(note);
    doc.text(n, x + width - doc.widthOfString(n), y + 21, { lineBreak: false });
  }
  const bottom = y + 44;
  doc.moveTo(x, bottom).lineTo(x + width, bottom).lineWidth(0.6).strokeColor(BORDER).stroke();
  return bottom + 10;
}

function legendHeight(doc, width, departments) {
  if (!departments.length) return 0;
  doc.font('Helvetica').fontSize(7.5);
  let cx = 0;
  let rows = 1;
  for (const name of departments) {
    const w = 12 + doc.widthOfString(pdfText(name)) + 14;
    if (cx + w > width && cx > 0) { cx = 0; rows += 1; }
    cx += w;
  }
  return rows * 13 + 5;
}

/** Department colour dots, wrapped to the width. Returns the y below it. */
function drawLegend(doc, { x, y, width, departments, colourOf }) {
  if (!departments.length) return y;
  doc.font('Helvetica').fontSize(7.5);
  let cx = x;
  let cy = y;
  for (const name of departments) {
    const label = pdfText(name);
    const w = 12 + doc.widthOfString(label) + 14;
    if (cx + w > x + width && cx > x) { cx = x; cy += 13; }
    doc.circle(cx + 4, cy + 4, 3.2).fill(colourOf(name));
    doc.fillColor(MUTED).text(label, cx + 11, cy, { lineBreak: false });
    cx += w;
  }
  return cy + 18;
}

function drawCard(doc, box, lib, colourOf) {
  const p = box.node;
  const { x, y, w, h } = box;
  doc.lineWidth(0.6).roundedRect(x, y, w, h, 5).fillAndStroke('#FFFFFF', BORDER);
  doc.rect(x + 7, y, w - 14, 2.4).fill(colourOf(p.department));
  const r = 12.5;
  const ax = x + 9 + r;
  const ay = y + h / 2;
  doc.circle(ax, ay, r).fill(NAVY);
  const initials = pdfText(lib.personInitials(p));
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
  doc.text(initials, ax - doc.widthOfString(initials) / 2, ay - 3.2, { lineBreak: false });
  const tx = ax + r + 7;
  const tw = x + w - 7 - tx;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.6).text(fit(doc, lib.personName(p), tw), tx, ay - 15, { lineBreak: false });
  doc.fillColor('#3D3D41').font('Helvetica').fontSize(7.2).text(fit(doc, p.designation || 'Employee', tw), tx, ay - 3.5, { lineBreak: false });
  doc.fillColor(MUTED).fontSize(6.6).text(fit(doc, [p.department, p.employeeCode].filter(Boolean).join(' · '), tw), tx, ay + 7, { lineBreak: false });
  if (box.collapsed) {
    const label = `+${box.reports}`;
    doc.font('Helvetica-Bold').fontSize(6.8);
    const bw = doc.widthOfString(label) + 10;
    const bx = x + w / 2 - bw / 2;
    const by = y + h - 5;
    doc.lineWidth(0.6).roundedRect(bx, by, bw, 10, 5).fillAndStroke('#EFF3F6', '#C3CDD6');
    doc.fillColor(NAVY).text(label, bx + 5, by + 2, { lineBreak: false });
  }
}

/** One laid-out chart at (x, y), drawn at `scale`. */
function drawChart(doc, layout, { x, y, scale, lib, colourOf }) {
  doc.save();
  doc.translate(x, y);
  doc.scale(scale);
  doc.lineWidth(0.8).strokeColor(LINE);
  for (const [x1, y1, x2, y2] of layout.lines) doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
  if (layout.section) {
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text(pdfText(layout.section.label), layout.section.x, layout.section.y + 4, { lineBreak: false });
    doc.moveTo(layout.section.x, layout.section.y + 17).lineTo(layout.section.x + layout.section.w, layout.section.y + 17).lineWidth(0.5).strokeColor(BORDER).stroke();
  }
  for (const box of layout.boxes) drawCard(doc, box, lib, colourOf);
  doc.restore();
}

function collapsedSet(lib, roots) {
  const ids = new Set();
  const walk = (n) => { if (n.collapsed) ids.add(lib.idOf(n)); (n.children || []).forEach(walk); };
  roots.forEach(walk);
  return ids;
}

function teamSize(node) {
  return (node.children || []).reduce((t, c) => t + 1 + teamSize(c), 0);
}

function departmentsIn(layouts) {
  const keys = new Map();
  for (const l of layouts) {
    for (const b of l.boxes) {
      const d = String(b.node.department || '').trim();
      if (d && !keys.has(d.toLowerCase())) keys.set(d.toLowerCase(), d);
    }
  }
  return [...keys.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Charts to print, each readable on its own: the whole thing if it fits;
 * otherwise each manager with their direct reports (teams shown as "+N"),
 * followed by each of those teams, worked out the same way.
 */
function printItems(lib, roots, { layoutWith, fits, separateUnplaced, userCollapsed }) {
  const whole = layoutWith(roots, new Set(), separateUnplaced);
  if (fits(whole)) return [{ layout: whole, label: '' }];
  const trees = separateUnplaced ? roots.filter((r) => r.children?.length) : roots;
  const unplaced = separateUnplaced ? roots.filter((r) => !r.children?.length) : [];
  const items = [];
  const split = (tree) => {
    const name = lib.personName(tree);
    const open = (tree.children || []).length > 0 && !userCollapsed.has(lib.idOf(tree));
    const team = layoutWith([tree], new Set(), false);
    if (!open || fits(team)) {
      items.push({ layout: team, label: `Team of ${name}`, people: teamSize(tree) + 1 });
      return;
    }
    const teams = (tree.children || []).filter((c) => c.children?.length && !userCollapsed.has(lib.idOf(c)));
    items.push({ layout: layoutWith([tree], new Set(teams.map((c) => lib.idOf(c))), false), label: `${name} and direct reports`, people: tree.children.length + 1 });
    teams.forEach(split);
  };
  trees.forEach(split);
  if (unplaced.length) items.push({ layout: layoutWith(unplaced, new Set(), true), label: '' });
  return items;
}

async function writeTreePdf({ stream, roots, title, subtitle, note, paper, separateUnplaced, departments }) {
  const lib = await loadLayout();
  const colourOf = lib.departmentPalette(departments);
  const sizes = lib.ORG_CHART_SIZES.pdf;
  const userCollapsed = collapsedSet(lib, roots);
  const layoutWith = (rs, extraClosed, separate) => lib.layoutOrgChart(rs, { ...sizes, separateUnplaced: separate, isCollapsed: (id) => userCollapsed.has(id) || extraClosed.has(id) });
  const info = { Title: pdfText(title), Author: 'JPK HRMS', Subject: pdfText(subtitle) };
  const probe = new PDFDocument({ autoFirstPage: false });

  if (paper !== 'A4' && paper !== 'A3') {
    // One page the size of the chart.
    const layout = layoutWith(roots, new Set(), separateUnplaced);
    const legendDeps = departmentsIn([layout]);
    const chartW = Math.max(layout.width, 1);
    const chartH = Math.max(layout.height, 1);
    let pageW = Math.max(PAPER.A4[1], chartW + 2 * MARGIN);
    const headerH = 54 + legendHeight(probe, pageW - 2 * MARGIN, legendDeps) + 8;
    let pageH = Math.max(PAPER.A4[0], chartH + 2 * MARGIN + headerH);
    let scale = 1;
    if (pageW > MAX_PAGE || pageH > MAX_PAGE) {
      scale = Math.min((MAX_PAGE - 2 * MARGIN) / chartW, (MAX_PAGE - 2 * MARGIN - headerH) / chartH);
      pageW = Math.max(PAPER.A4[1], chartW * scale + 2 * MARGIN);
      pageH = Math.max(PAPER.A4[0], chartH * scale + 2 * MARGIN + headerH);
    }
    const doc = new PDFDocument({ size: [pageW, pageH], margin: 0, info });
    doc.pipe(stream);
    const contentW = pageW - 2 * MARGIN;
    let y = drawHeader(doc, { x: MARGIN, y: MARGIN, width: contentW, title, subtitle, note });
    y = drawLegend(doc, { x: MARGIN, y, width: contentW, departments: legendDeps, colourOf });
    if (!layout.boxes.length) doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Nobody to show.', MARGIN, y + 10);
    drawChart(doc, layout, { x: MARGIN + Math.max(0, (contentW - chartW * scale) / 2), y: y + 6, scale, lib, colourOf });
    doc.end();
    return;
  }

  // Paper: one sheet if it reads well, otherwise a booklet of teams.
  const [shortSide, longSide] = PAPER[paper];
  const area = (landscape, legendDeps) => {
    const w = (landscape ? longSide : shortSide) - 2 * MARGIN;
    const h = (landscape ? shortSide : longSide) - 2 * MARGIN - 54 - legendHeight(probe, w, legendDeps) - 8 - 14;
    return { w, h };
  };
  const scaleIn = (layout, a) => Math.min(1, a.w / Math.max(layout.width, 1), a.h / Math.max(layout.height, 1));
  const whole = layoutWith(roots, new Set(), separateUnplaced);
  const allDeps = departmentsIn([whole]);
  const fits = (layout) => Math.max(scaleIn(layout, area(true, allDeps)), scaleIn(layout, area(false, allDeps))) >= MIN_PRINT_SCALE;
  const items = printItems(lib, roots, { layoutWith, fits, separateUnplaced, userCollapsed });

  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, bufferPages: true, info });
  doc.pipe(stream);
  if (items.length === 1 && !items[0].label) {
    // The whole chart on one sheet, turned whichever way shows it bigger.
    const { layout } = items[0];
    const land = area(true, allDeps);
    const port = area(false, allDeps);
    const landscape = scaleIn(layout, land) >= scaleIn(layout, port);
    const a = landscape ? land : port;
    const scale = scaleIn(layout, a);
    doc.addPage({ size: landscape ? [longSide, shortSide] : [shortSide, longSide], margin: 0 });
    let y = drawHeader(doc, { x: MARGIN, y: MARGIN, width: a.w, title, subtitle, note });
    y = drawLegend(doc, { x: MARGIN, y, width: a.w, departments: allDeps, colourOf });
    if (!layout.boxes.length) doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Nobody to show.', MARGIN, y + 10);
    const top = y + 6 + Math.max(0, (a.h - layout.height * scale) / 2);
    drawChart(doc, layout, { x: MARGIN + Math.max(0, (a.w - layout.width * scale) / 2), y: top, scale, lib, colourOf });
  } else {
    // Booklet: landscape sheets, charts placed left to right, top to bottom, each with its title.
    const pageSize = [longSide, shortSide];
    const a = area(true, allDeps);
    const captionH = 18;
    const gap = 26;
    let x = 0;
    let y = 0;
    let shelfH = 0;
    let top = 0;
    let bottom = 0;
    const newPage = () => {
      doc.addPage({ size: pageSize, margin: 0 });
      const below = drawHeader(doc, { x: MARGIN, y: MARGIN, width: a.w, title, subtitle, note });
      top = drawLegend(doc, { x: MARGIN, y: below, width: a.w, departments: allDeps, colourOf }) + 4;
      bottom = pageSize[1] - MARGIN - 12;
      x = MARGIN;
      y = top;
      shelfH = 0;
    };
    newPage();
    for (const item of items) {
      const scale = Math.min(1, a.w / Math.max(item.layout.width, 1), (bottom - top - captionH) / Math.max(item.layout.height, 1));
      const w = item.layout.width * scale;
      const h = item.layout.height * scale + (item.label ? captionH : 0);
      if (x > MARGIN && x + w > MARGIN + a.w) { x = MARGIN; y += shelfH + gap; shelfH = 0; }
      if (y > top && y + h > bottom) newPage();
      if (item.label) {
        const label = pdfText(item.label);
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9.5).text(label, x, y, { lineBreak: false });
        if (item.people) {
          const lw = doc.widthOfString(label);
          doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`${item.people} people`, x + lw + 6, y + 1.2, { lineBreak: false });
        }
      }
      drawChart(doc, item.layout, { x, y: y + (item.label ? captionH : 0), scale, lib, colourOf });
      x += w + gap;
      shelfH = Math.max(shelfH, h);
    }
  }
  const range = doc.bufferedPageRange();
  if (range.count > 1) {
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const label = `${pdfText(title)} - page ${i + 1} of ${range.count}`;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(label, MARGIN, doc.page.height - 20, { width: doc.page.width - 2 * MARGIN, align: 'center', lineBreak: false });
    }
  }
  doc.end();
}

async function writeListPdf({ stream, roots, title, subtitle, note, departments }) {
  const lib = await loadLayout();
  const colourOf = lib.departmentPalette(departments);
  // Closed teams are left out, like on screen; their manager shows "+N".
  const collapsedIds = collapsedSet(lib, roots);
  const rows = lib.flattenOrgForest(roots, (id) => collapsedIds.has(id));
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: pdfText(title), Author: 'JPK HRMS', Subject: pdfText(subtitle) } });
  doc.pipe(stream);
  const [pageW, pageH] = PAPER.A4;
  const margin = 36;
  const width = pageW - 2 * margin;
  const cols = [
    { key: 'name', label: 'Person', w: 205 },
    { key: 'code', label: 'Code', w: 60 },
    { key: 'designation', label: 'Designation', w: 132 },
    { key: 'department', label: 'Department', w: 88 },
    { key: 'reports', label: 'Reports', w: width - 205 - 60 - 132 - 88, right: true }
  ];
  const rowH = 17;
  const indent = 11;
  const tableHead = (top) => {
    doc.rect(margin, top, width, rowH).fill('#EFF3F6');
    let cx = margin;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(7.8);
    for (const c of cols) {
      const tx = c.right ? cx + c.w - 6 - doc.widthOfString(c.label) : cx + 6;
      doc.text(c.label, tx, top + 5, { lineBreak: false });
      cx += c.w;
    }
    return top + rowH;
  };
  let y = drawHeader(doc, { x: margin, y: margin, width, title, subtitle, note });
  y = tableHead(y);
  rows.forEach((row, i) => {
    if (y + rowH > pageH - 40) {
      doc.addPage({ size: 'A4', margin: 0 });
      y = tableHead(margin);
    }
    if (i % 2 === 1) doc.rect(margin, y, width, rowH).fill('#FAFAFB');
    // Tree guides: a line down for every open level above, then the elbow to this person.
    doc.lineWidth(0.6).strokeColor('#B8C2CC');
    for (let level = 1; level < row.depth; level += 1) {
      if (!row.lastFlags[level]) {
        const gx = margin + 8 + (level - 1) * indent + 3;
        doc.moveTo(gx, y).lineTo(gx, y + rowH).stroke();
      }
    }
    if (row.depth > 0) {
      const gx = margin + 8 + (row.depth - 1) * indent + 3;
      const last = row.lastFlags[row.depth];
      doc.moveTo(gx, y).lineTo(gx, last ? y + rowH / 2 : y + rowH).stroke();
      doc.moveTo(gx, y + rowH / 2).lineTo(gx + indent - 3, y + rowH / 2).stroke();
    }
    const p = row.node;
    const nameX = margin + 8 + row.depth * indent;
    doc.circle(nameX + 3, y + rowH / 2, 2.6).fill(colourOf(p.department));
    let cx = margin;
    const cells = {
      name: lib.personName(p),
      code: p.employeeCode || '',
      designation: p.designation || '',
      department: p.department || '',
      reports: row.reports ? `${row.collapsed ? '+' : ''}${row.reports}` : ''
    };
    for (const c of cols) {
      const isName = c.key === 'name';
      doc.font(isName && row.reports ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.8).fillColor(isName ? INK : '#3D3D41');
      const startX = isName ? nameX + 9 : cx + 6;
      const avail = isName ? cx + c.w - 6 - startX : c.w - 12;
      const text = fit(doc, cells[c.key], avail);
      const tx = c.right ? cx + c.w - 6 - doc.widthOfString(text) : startX;
      doc.text(text, tx, y + 5, { lineBreak: false });
      cx += c.w;
    }
    y += rowH;
  });
  if (!rows.length) doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Nobody to show.', margin, y + 10);
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const label = `${pdfText(title)} - page ${i + 1} of ${range.count}`;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(label, margin, pageH - 26, { width, align: 'center', lineBreak: false });
  }
  doc.end();
}

/**
 * roots: the forest to print, with `collapsed: true` on people whose team is
 * closed on screen. view: 'TREE' | 'LIST'. paper (TREE): 'FULL' | 'A4' | 'A3'.
 * departments: every department in the company, for the same colours as the screen.
 */
async function writeOrgChartPdf({ stream, roots, view, paper, title, subtitle, note, separateUnplaced = true, departments = [] }) {
  if (view === 'LIST') return writeListPdf({ stream, roots, title, subtitle, note, departments });
  return writeTreePdf({ stream, roots, title, subtitle, note, paper, separateUnplaced, departments });
}

module.exports = { writeOrgChartPdf, pdfText };
