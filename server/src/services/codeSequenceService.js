const Counter = require('../models/Counter');
const ApiError = require('../utils/apiError');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Next free code such as APP-00042 / JOB-007 / EMP00012 for one tenant.
 *
 * v26: codes used to be `count + 1`, so deleting any earlier record made the
 * next code collide with an existing one and every later create failed with a
 * duplicate-key error. A per-tenant counter (seeded from the highest existing
 * code) is atomic under concurrency, and each candidate code is checked so a
 * manually entered code can never be reused.
 */
async function nextCode({ Model, tenantId, field, prefix, width }) {
  const key = `${Model.modelName}:${field}:${prefix}:${tenantId}`;
  if (!(await Counter.exists({ _id: key }))) {
    const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
    const rows = await Model.find({ tenantId, [field]: { $regex: pattern } }).select(field).lean();
    const highest = rows.reduce((max, row) => Math.max(max, Number(String(row[field]).match(pattern)?.[1] || 0)), 0);
    await Counter.updateOne({ _id: key }, { $max: { seq: highest } }, { upsert: true });
  }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const { seq } = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true, upsert: true });
    const code = `${prefix}${String(seq).padStart(width, '0')}`;
    if (!(await Model.exists({ tenantId, [field]: code }))) return code;
  }
  throw new ApiError(409, `Could not allocate a free ${field}. Enter one manually.`);
}

module.exports = { nextCode };
