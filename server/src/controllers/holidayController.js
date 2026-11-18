const asyncHandler = require('../utils/asyncHandler');
const Holiday = require('../models/Holiday');
const ApiError = require('../utils/apiError');
const { holidayDateKey } = require('../utils/date');

exports.list = asyncHandler(async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  // Widen by one day so legacy IST-midnight values cannot fall outside the year query.
  const from = new Date(Date.UTC(year - 1, 11, 31));
  const to = new Date(Date.UTC(year + 1, 0, 2));
  const rows = await Holiday.find({ tenantId: req.tenantId, date: { $gte: from, $lte: to } }).sort('date');
  const holidays = rows.filter((h) => holidayDateKey(h).startsWith(`${year}-`)).map((h) => {
    const obj = h.toObject();
    obj.date = new Date(`${holidayDateKey(h)}T00:00:00.000Z`);
    return obj;
  });
  res.json({ holidays });
});

/**
 * A holiday is a whole calendar day, not an instant. Depending on how the value
 * arrives ("2026-08-15" vs a Date built in local time) Mongo could store either
 * 2026-08-15T00:00Z or 2026-08-14T18:30Z. Both mean "15 August" but they land on
 * different sides of midnight, which is how Independence Day showed up on the
 * 14th. Everything is pinned to UTC midnight of the intended day on write.
 */
function normalizeHolidayDate(value) {
  if (!value) return value;
  const raw = String(value);
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

exports.create = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new ApiError(400, 'Holiday name is required');
  const date = normalizeHolidayDate(req.body.date);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new ApiError(400, 'Choose a valid holiday date');
  const location = ['ALL', 'OFFICE', 'FACTORY'].includes(String(req.body.location || 'ALL').toUpperCase()) ? String(req.body.location || 'ALL').toUpperCase() : 'ALL';
  const holiday = await Holiday.create({ name, date, location, optional: Boolean(req.body.optional), tenantId: req.tenantId });
  res.status(201).json({ holiday, message: `${name} added to the holiday calendar` });
});

/** One-off repair for holidays saved before the normalization above. */
exports.repairDates = asyncHandler(async (req, res) => {
  const rows = await Holiday.find({ tenantId: req.tenantId });
  let fixed = 0;
  for (const h of rows) {
    const key = holidayDateKey(h);
    if (!key) continue;
    const pinned = new Date(`${key}T00:00:00.000Z`);
    if (pinned.getTime() !== new Date(h.date).getTime()) { h.date = pinned; await h.save(); fixed += 1; }
  }
  res.json({ checked: rows.length, fixed });
});

exports.remove = asyncHandler(async (req, res) => {
  await Holiday.deleteOne({ _id: req.params.id, tenantId: req.tenantId });
  res.json({ ok: true });
});
