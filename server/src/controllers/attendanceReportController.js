/**
 * GET /api/attendance/reports/monthly?month=YYYY-MM&location=ALL|OFFICE|FACTORY&format=json|xlsx|pdf
 * GET /api/attendance/reports/early-leave?month=…&location=…&minMinutes=5&minTimes=3&format=json|xlsx|pdf
 *
 * Only the people the signed-in user may see (the same scope as the attendance
 * calendar): HR and admins everyone, a manager their team, an employee themselves.
 */
const asyncHandler = require('../utils/asyncHandler');
const { getScopedEmployeeIds } = require('../services/scopeService');
const reports = require('../services/attendanceReportService');

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function fileName(base, month, place, ext) {
  return `${base}-${month}${place && place !== 'ALL' ? `-${place.toLowerCase()}` : ''}.${ext}`;
}

function formatOf(req) {
  const f = String(req.query.format || 'json').toLowerCase();
  return ['xlsx', 'pdf'].includes(f) ? f : 'json';
}

exports.monthly = asyncHandler(async (req, res) => {
  const employeeIds = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  const report = await reports.monthlyReport({ tenantId: req.tenantId, employeeIds, month: req.query.month, location: req.query.location });
  const format = formatOf(req);
  if (format === 'xlsx') {
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName('attendance-report', report.month, report.place, 'xlsx')}"`);
    return res.send(reports.monthlyReportXlsx(report));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName('attendance-report', report.month, report.place, 'pdf')}"`);
    return reports.writeMonthlyReportPdf(report, res);
  }
  return res.json(reports.monthlyJson(report));
});

exports.earlyLeave = asyncHandler(async (req, res) => {
  const employeeIds = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  const report = await reports.earlyLeaveReport({
    tenantId: req.tenantId,
    employeeIds,
    month: req.query.month,
    location: req.query.location,
    minMinutes: req.query.minMinutes ?? 5,
    minTimes: req.query.minTimes ?? 3
  });
  const format = formatOf(req);
  if (format === 'xlsx') {
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName('left-early', report.month, report.place, 'xlsx')}"`);
    return res.send(reports.earlyLeaveXlsx(report));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName('left-early', report.month, report.place, 'pdf')}"`);
    return reports.writeEarlyLeavePdf(report, res);
  }
  return res.json(reports.earlyLeaveJson(report));
});
