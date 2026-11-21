const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const Employee = require('../models/Employee');
const Tenant = require('../models/Tenant');
const { normalizeObjectId, ensureManagerAssignmentIsValid } = require('../utils/hierarchy');
const { writeOrgChartPdf } = require('../services/orgChartPdfService');

// What the chart shows of each person (not the whole employee record: no pay, bank or ID details).
const CHART_FIELDS = 'employeeCode firstName lastName designation department reportsTo status workLocation profilePhotoUrl';

function buildTree(employees) {
  const byId = new Map();
  const roots = [];
  employees.forEach((e) => byId.set(String(e._id), { ...(e.toObject ? e.toObject() : e), children: [] }));
  byId.forEach((node) => {
    const parentId = node.reportsTo ? String(node.reportsTo._id || node.reportsTo) : null;
    if (parentId && byId.has(parentId) && parentId !== String(node._id)) byId.get(parentId).children.push(node);
    else roots.push(node);
  });
  // A loop in old data (A reports to B, B to A) would hide both: show them at the top instead.
  const seen = new Set();
  const visit = (node) => { seen.add(String(node._id)); node.children.forEach(visit); };
  roots.forEach(visit);
  byId.forEach((node) => {
    if (seen.has(String(node._id))) return;
    const parentId = String(node.reportsTo?._id || node.reportsTo);
    const parent = byId.get(parentId);
    if (parent) parent.children = parent.children.filter((c) => c !== node);
    roots.push(node);
    visit(node);
  });
  return roots;
}

async function chartEmployees(tenantId) {
  return Employee.find({ tenantId, status: { $ne: 'OFFBOARDED' } })
    .select(CHART_FIELDS)
    .populate('reportsTo', 'employeeCode firstName lastName designation')
    .sort('employeeCode')
    .lean();
}

exports.tree = asyncHandler(async (req, res) => {
  const employees = await chartEmployees(req.tenantId);
  res.json({ employees, tree: buildTree(employees) });
});

/**
 * The chart as on screen: { view: 'TREE'|'LIST', rootId (one person's team),
 * collapsed: [ids of closed teams], paper: 'FULL'|'A4'|'A3' }.
 * POST /hierarchy/chart.pdf with a JSON body (website), or
 * GET /hierarchy/chart.pdf?view=&paper=&rootId=&collapsed=id,id (phone app downloads).
 */
exports.chartPdf = asyncHandler(async (req, res) => {
  const input = req.method === 'GET'
    ? { ...req.query, collapsed: String(req.query.collapsed || '').split(',').map((id) => id.trim()).filter(Boolean) }
    : (req.body || {});
  const view = String(input.view || 'TREE').toUpperCase() === 'LIST' ? 'LIST' : 'TREE';
  const paper = ['A4', 'A3'].includes(String(input.paper || '').toUpperCase()) ? String(input.paper).toUpperCase() : 'FULL';
  const collapsed = new Set((Array.isArray(input.collapsed) ? input.collapsed : []).slice(0, 20000).map(String));
  const rootId = input.rootId ? String(input.rootId) : '';
  if (rootId && !mongoose.isValidObjectId(rootId)) throw new ApiError(400, 'Choose a person from the list');

  const [employees, tenant] = await Promise.all([chartEmployees(req.tenantId), Tenant.findById(req.tenantId).select('name').lean()]);
  let roots = buildTree(employees);
  let focus = null;
  if (rootId) {
    const find = (nodes) => { for (const n of nodes) { if (String(n._id) === rootId) return n; const hit = find(n.children); if (hit) return hit; } return null; };
    focus = find(roots);
    if (!focus) throw new ApiError(404, 'That person is not on the organisation chart');
    roots = [focus];
  }
  const mark = (n) => { n.collapsed = n.children.length > 0 && collapsed.has(String(n._id)); n.children.forEach(mark); };
  roots.forEach(mark);

  let people = 0;
  const count = (n) => { people += 1; n.children.forEach(count); };
  roots.forEach(count);
  const company = tenant?.name || 'Company';
  const focusName = focus ? `${focus.firstName || ''} ${focus.lastName || ''}`.trim() || focus.employeeCode : '';
  const title = 'Organisation chart';
  const subtitle = `${company} \u00B7 ${people} ${people === 1 ? 'person' : 'people'}`;
  // Colours come from the whole company's departments, so they match the screen even for one team.
  const departments = [...new Map(employees.filter((e) => String(e.department || '').trim()).map((e) => [String(e.department).trim().toLowerCase(), String(e.department).trim()])).values()];
  const note = focus ? `Team of ${focusName}` : '';
  const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const slug = focus ? `-team-${focusName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="organisation-chart${slug}-${day}.pdf"`);
  await writeOrgChartPdf({ stream: res, roots, view, paper, title, subtitle, note, separateUnplaced: !focus, departments });
});

exports.updateManager = asyncHandler(async (req, res) => {
  const { employeeId } = req.body;
  const reportsTo = normalizeObjectId(req.body.reportsTo);
  const employee = await Employee.findOne({ _id: employeeId, tenantId: req.tenantId });
  if (!employee) throw new ApiError(404, 'Employee not found');
  employee.reportsTo = reportsTo ? await ensureManagerAssignmentIsValid({ tenantId: req.tenantId, employeeId: employee._id, reportsTo }) : undefined;
  await employee.save();
  res.json({ employee });
});
