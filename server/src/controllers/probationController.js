const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const ProbationReview = require('../models/ProbationReview');
const { canApproveEmployee } = require('../services/approvalService');
const { runProbationReminders, confirmProbation, extendProbation } = require('../services/probationService');
const { notifyLater } = require('../services/messaging/dispatcher');

exports.list = asyncHandler(async (req, res) => {
  const q = { tenantId: req.tenantId };
  if (req.query.status) q.status = req.query.status;
  const reviews = await ProbationReview.find(q)
    .populate('employeeId', 'employeeCode firstName lastName department designation reportsTo probation status')
    .populate('managerEmployeeId', 'employeeCode firstName lastName')
    .sort('dueDate');
  const filtered = [];
  for (const review of reviews) {
    if (await canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee: review.employeeId })) filtered.push(review);
  }
  res.json({ reviews: filtered });
});

exports.runReminderNow = asyncHandler(async (req, res) => {
  const result = await runProbationReminders(new Date(), { tenantId: req.tenantId });
  res.json(result);
});

exports.decide = asyncHandler(async (req, res) => {
  const { action, extensionMonths, remarks } = req.body;
  const review = await ProbationReview.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate('employeeId');
  if (!review) throw new ApiError(404, 'Probation review not found');
  const allowed = await canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee: review.employeeId });
  if (!allowed) throw new ApiError(403, 'Only reporting manager, HR or admin can decide probation');
  if (req.user.role !== 'SUPER_ADMIN' && req.employee?._id && String(req.employee._id) === String(review.employeeId?._id)) {
    throw new ApiError(403, 'You cannot decide your own probation');
  }
  if (review.status !== 'PENDING_MANAGER') throw new ApiError(409, `This review is already ${review.status.toLowerCase()}`);
  if (!['CONFIRM', 'EXTEND'].includes(action)) throw new ApiError(400, 'action must be CONFIRM or EXTEND');
  const months = extensionMonths === undefined || extensionMonths === null || extensionMonths === '' ? 1 : Number(extensionMonths);
  if (action === 'EXTEND' && (!Number.isInteger(months) || months < 1 || months > 12)) {
    throw new ApiError(400, 'Extension must be a whole number of months between 1 and 12');
  }
  let employee;
  if (action === 'CONFIRM') employee = await confirmProbation({ review, user: req.user, remarks });
  else employee = await extendProbation({ review, user: req.user, extensionMonths: months, remarks });
  notifyLater({
    tenantId: req.tenantId,
    event: 'PROBATION_DECIDED',
    recipients: [{ employeeId: employee._id }],
    actorUserId: req.user._id,
    entityId: `${review._id}:${review.status}`,
    data: { outcome: review.status, extendedUntil: review.extendedUntil, remarks },
    inApp: {
      type: 'PROBATION_DECIDED',
      title: review.status === 'CONFIRMED' ? 'Your employment is confirmed' : 'Your probation was extended',
      body: review.status === 'CONFIRMED' ? 'Congratulations! Your probation is complete.' : 'Your manager extended your probation. Check your profile for the new date.',
      priority: 'HIGH'
    }
  });
  res.json({ review, employee });
});
