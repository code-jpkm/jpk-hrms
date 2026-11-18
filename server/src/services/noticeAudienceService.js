const AccessGrant = require('../models/AccessGrant');
const ApiError = require('../utils/apiError');
const { getScopedEmployeeIds } = require('./scopeService');

function isAdmin(user) {
  return ['SUPER_ADMIN', 'HR_ADMIN'].includes(String(user?.role || '').toUpperCase());
}

async function getNoticePublishingScope(req) {
  if (isAdmin(req.user)) {
    return {
      allowedModes: ['BOTH', 'OFFICE', 'FACTORY', 'SELECTED'],
      broadLocations: ['OFFICE', 'FACTORY'],
      canPublishEveryone: true
    };
  }

  const grant = await AccessGrant.findOne({
    tenantId: req.tenantId,
    viewerUserId: req.user._id,
    resource: 'EMPLOYEE_PROFILE'
  }).lean();

  const broadLocations = grant?.canViewAll
    ? (grant.workLocations?.length ? [...new Set(grant.workLocations)] : ['OFFICE', 'FACTORY'])
    : [];

  const allowedModes = ['SELECTED'];
  if (broadLocations.includes('OFFICE')) allowedModes.unshift('OFFICE');
  if (broadLocations.includes('FACTORY')) allowedModes.unshift('FACTORY');
  if (broadLocations.includes('OFFICE') && broadLocations.includes('FACTORY')) allowedModes.unshift('BOTH');

  return { allowedModes: [...new Set(allowedModes)], broadLocations, canPublishEveryone: false };
}

async function assertNoticeAudience(req, payload = {}) {
  const rawEmployeeIds = Array.isArray(payload.employeeIds) ? payload.employeeIds.filter(Boolean).map(String) : [];
  const rawLocations = Array.isArray(payload.audienceLocations)
    ? [...new Set(payload.audienceLocations.map((x) => String(x).toUpperCase()).filter((x) => ['OFFICE', 'FACTORY'].includes(x)))]
    : [];

  if (isAdmin(req.user)) {
    return { employeeIds: rawEmployeeIds, audienceLocations: rawEmployeeIds.length ? [] : rawLocations };
  }

  const allowedIds = new Set(await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'EMPLOYEE_PROFILE' }));
  if (rawEmployeeIds.length) {
    const outside = rawEmployeeIds.filter((id) => !allowedIds.has(id));
    if (outside.length) throw new ApiError(403, 'One or more selected employees are outside your People access scope');
    return { employeeIds: rawEmployeeIds, audienceLocations: [] };
  }

  if (!rawLocations.length) throw new ApiError(403, 'A non-admin publisher must choose an allowed Office / Factory audience or selected employees');
  const scope = await getNoticePublishingScope(req);
  const outsideLocation = rawLocations.find((location) => !scope.broadLocations.includes(location));
  if (outsideLocation) throw new ApiError(403, `You cannot publish a broad notice to ${outsideLocation}. Use selected employees or ask Super Admin to expand your People scope.`);
  return { employeeIds: [], audienceLocations: rawLocations };
}

module.exports = { getNoticePublishingScope, assertNoticeAudience };
