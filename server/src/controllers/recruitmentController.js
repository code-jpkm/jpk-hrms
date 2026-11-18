const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const Candidate = require('../models/Candidate');
const JobOpening = require('../models/JobOpening');
const RecruitmentDepartment = require('../models/RecruitmentDepartment');
const RecruitmentLocation = require('../models/RecruitmentLocation');
const RecruitmentJobProfile = require('../models/RecruitmentJobProfile');
const DocumentAsset = require('../models/DocumentAsset');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { notify } = require('../services/messaging/dispatcher');
const loginAccess = require('../services/loginAccessService');
const { buildRecruitmentLetterBuffer } = require('../services/recruitmentLetterService');
const { ensureManagerAssignmentIsValid, normalizeObjectId } = require('../utils/hierarchy');
const { hasAbility } = require('../middleware/auth');
const { assertRoleAssignmentAllowed, sanitizeOperationPermissions, resolveLoginForEmployee } = require('../services/accountGuardService');
const { nextCode } = require('../services/codeSequenceService');

const stages = ['NEW_APPLICATION', 'SHORTLISTED', 'L1_DONE', 'L2_DONE', 'DIRECTOR_DONE', 'OFFERED', 'JOINED', 'HOLD', 'REJECTED'];
const candidatePopulate = [
  { path: 'jobOpeningId', select: 'jobId title department location jobProfileId departmentId locationId' },
  { path: 'jobProfileId', select: 'code title designation department location departmentId locationId defaultRole isManagerProfile' },
  { path: 'departmentId', select: 'code name managerId directorId' },
  { path: 'locationId', select: 'code name city state' },
  { path: 'joining.employeeId', select: 'employeeCode firstName lastName status' }
];
const openingPopulate = [
  { path: 'jobProfileId', select: 'code title designation department location' },
  { path: 'departmentId', select: 'code name' },
  { path: 'locationId', select: 'code name city state' }
];
const jobProfilePopulate = [
  { path: 'departmentId', select: 'code name managerId directorId' },
  { path: 'locationId', select: 'code name city state' },
  { path: 'defaultReportingTo', select: 'employeeCode firstName lastName designation' }
];

// v26: request bodies were stored as-is (findOneAndUpdate without validators), so a
// body could move a record to another tenant or set defaultRole: 'SUPER_ADMIN',
// which convert-to-employee then handed out. Every write now goes through a whitelist.
const DEPARTMENT_FIELDS = ['code', 'name', 'managerId', 'directorId', 'description', 'isActive'];
const LOCATION_FIELDS = ['code', 'name', 'address', 'city', 'state', 'isActive'];
const JOB_PROFILE_FIELDS = ['code', 'title', 'departmentId', 'locationId', 'designation', 'department', 'location', 'experience', 'ctc', 'employmentType', 'defaultRole', 'defaultReportingTo', 'isManagerProfile', 'defaultPermissions', 'description', 'isActive'];
const OPENING_FIELDS = ['jobId', 'jobProfileId', 'departmentId', 'locationId', 'title', 'department', 'location', 'openings', 'experience', 'ctc', 'description', 'status', 'postedAt'];
const CANDIDATE_FIELDS = ['candidateCode', 'name', 'email', 'phone', 'jobProfileId', 'departmentId', 'locationId', 'position', 'department', 'location', 'qualification', 'experience', 'currentCompany', 'expectedCtc', 'appliedAt', 'jobOpeningId', 'stage', 'notes', 'offer'];
const OFFER_FIELDS = ['designation', 'department', 'joiningDate', 'ctc'];
const OBJECT_ID_FIELDS = ['managerId', 'directorId', 'departmentId', 'locationId', 'jobProfileId', 'jobOpeningId', 'defaultReportingTo'];
const REF_MODELS = {
  managerId: () => Employee,
  directorId: () => Employee,
  defaultReportingTo: () => Employee,
  departmentId: () => RecruitmentDepartment,
  locationId: () => RecruitmentLocation,
  jobProfileId: () => RecruitmentJobProfile,
  jobOpeningId: () => JobOpening
};

/** Whitelisted copy of a body. '' / null on an ObjectId field means "clear it" (collected in `unset`). */
function pickFields(body = {}, fields) {
  const set = {};
  const unset = [];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, field)) continue;
    let value = body[field];
    if (OBJECT_ID_FIELDS.includes(field)) {
      if (value && typeof value === 'object' && value._id) value = value._id;
      if (value === '' || value === null || value === undefined) { unset.push(field); continue; }
      if (!mongoose.isValidObjectId(value)) throw new ApiError(400, `Invalid ${field}`);
      value = String(value);
    }
    set[field] = value;
  }
  return { set, unset };
}

function pickOffer(offer) {
  if (!offer || typeof offer !== 'object') return undefined;
  const out = {};
  for (const field of OFFER_FIELDS) if (Object.prototype.hasOwnProperty.call(offer, field)) out[field] = offer[field] === '' ? undefined : offer[field];
  return out;
}

async function assertTenantRefs(tenantId, values) {
  for (const [field, model] of Object.entries(REF_MODELS)) {
    if (values[field] && !(await model().exists({ _id: values[field], tenantId }))) throw new ApiError(400, `${field} does not belong to this company`);
  }
}

function updateDoc(set, unset, fields) {
  const $set = Object.fromEntries(Object.entries(set).filter(([key]) => fields.includes(key)));
  const update = {};
  if (Object.keys($set).length) update.$set = $set;
  if (unset.length) update.$unset = Object.fromEntries(unset.map((key) => [key, 1]));
  return update;
}

/** Role / permission defaults on a job profile are granted to every hire, so they follow the same rules. */
function sanitizeJobProfileAccess(req, set) {
  if (set.defaultRole !== undefined && set.defaultRole !== '') set.defaultRole = assertRoleAssignmentAllowed(req.user, set.defaultRole);
  if (Array.isArray(set.defaultPermissions)) {
    set.defaultPermissions = set.defaultPermissions.length
      ? sanitizeOperationPermissions(req.user, { allowAll: false, modules: set.defaultPermissions }).modules
      : [];
  }
}

function cleanPhone(phone) {
  if (!phone) return phone;
  return String(phone).replace(/[^0-9]/g, '');
}

async function hydrateJobPayload({ tenantId, payload }) {
  const out = { ...payload };
  let profile = null;
  if (out.jobProfileId) {
    profile = await RecruitmentJobProfile.findOne({ _id: out.jobProfileId, tenantId }).populate(jobProfilePopulate);
    if (!profile) throw new ApiError(404, 'Job profile not found');
    out.title = out.title || profile.title;
    out.position = out.position || profile.title;
    out.designation = out.designation || profile.designation || profile.title;
    out.departmentId = out.departmentId || profile.departmentId?._id || profile.departmentId;
    out.locationId = out.locationId || profile.locationId?._id || profile.locationId;
    out.department = out.department || profile.departmentId?.name || profile.department;
    out.location = out.location || profile.locationId?.name || profile.location;
    out.experience = out.experience || profile.experience;
    out.ctc = out.ctc || profile.ctc;
  }
  if (out.jobOpeningId) {
    const opening = await JobOpening.findOne({ _id: out.jobOpeningId, tenantId }).populate(openingPopulate);
    if (!opening) throw new ApiError(404, 'Job opening not found');
    out.jobProfileId = out.jobProfileId || opening.jobProfileId?._id || opening.jobProfileId;
    out.title = out.title || opening.title;
    out.position = out.position || opening.title;
    out.departmentId = out.departmentId || opening.departmentId?._id || opening.departmentId;
    out.locationId = out.locationId || opening.locationId?._id || opening.locationId;
    out.department = out.department || opening.departmentId?.name || opening.department;
    out.location = out.location || opening.locationId?.name || opening.location;
    out.experience = out.experience || opening.experience;
    out.ctc = out.ctc || opening.ctc;
  }
  if (out.departmentId && !out.department) {
    const dept = await RecruitmentDepartment.findOne({ _id: out.departmentId, tenantId });
    if (dept) out.department = dept.name;
  }
  if (out.locationId && !out.location) {
    const loc = await RecruitmentLocation.findOne({ _id: out.locationId, tenantId });
    if (loc) out.location = loc.name;
  }
  return out;
}

async function resolveReportingManager({ tenantId, candidate, jobProfile, requestedReportsTo }) {
  if (requestedReportsTo) return requestedReportsTo;
  const deptId = candidate.departmentId || jobProfile?.departmentId?._id || jobProfile?.departmentId;
  let dept = null;
  if (deptId) dept = await RecruitmentDepartment.findOne({ _id: deptId, tenantId });
  if (jobProfile?.defaultReportingTo) return jobProfile.defaultReportingTo._id || jobProfile.defaultReportingTo;
  if (jobProfile?.isManagerProfile && dept?.directorId) return dept.directorId;
  if ((jobProfile?.defaultRole || '').toUpperCase() === 'MANAGER' && dept?.directorId) return dept.directorId;
  if (dept?.managerId) return dept.managerId;
  if (dept?.directorId) return dept.directorId;
  const root = await Employee.findOne({ tenantId, reportsTo: { $exists: false }, status: { $ne: 'OFFBOARDED' } }).sort('employeeCode');
  return root?._id;
}

/**
 * Role and permissions of the hire's login. v26: these came straight from the
 * request body (role: 'SUPER_ADMIN', operationPermissions: { allowAll: true })
 * or from an unvalidated job profile, and an existing login with the same
 * email was overwritten. Both now follow the account-guard rules.
 */
function plannedAccess(req, { jobProfile, body }) {
  const warnings = [];
  const roleSource = body.role || jobProfile?.defaultRole || '';
  const role = roleSource ? assertRoleAssignmentAllowed(req.user, roleSource) : undefined;
  let operationPermissions;
  if (body.operationPermissions) operationPermissions = sanitizeOperationPermissions(req.user, body.operationPermissions);
  else if (jobProfile?.defaultPermissions?.length) {
    if (hasAbility(req.user, 'ACCESS', 'MANAGE')) operationPermissions = sanitizeOperationPermissions(req.user, { allowAll: false, modules: jobProfile.defaultPermissions });
    else warnings.push('Job-profile default permissions were not applied: granting permissions needs ACCESS:MANAGE.');
  }
  return { role, operationPermissions, warnings };
}

async function convertCandidateToEmployee({ req, candidate, body = {} }) {
  if (candidate.joining?.employeeId) {
    const employee = await Employee.findOne({ _id: candidate.joining.employeeId, tenantId: req.tenantId }).populate('reportsTo', 'employeeCode firstName lastName');
    return { employee, created: false, notificationLogs: [] };
  }
  const tenantId = req.tenantId;
  const jobProfile = candidate.jobProfileId ? await RecruitmentJobProfile.findOne({ _id: candidate.jobProfileId, tenantId }).populate(jobProfilePopulate) : null;
  // Validate everything that can fail before anything is written, so a refused
  // role or a bad manager never leaves a half-created employee behind.
  const access = plannedAccess(req, { jobProfile, body });
  const [firstName, ...rest] = String(body.firstName || candidate.name || '').trim().split(/\s+/);
  const employee = new Employee({
    tenantId,
    employeeCode: body.employeeCode || await nextCode({ Model: Employee, tenantId, field: 'employeeCode', prefix: 'EMP', width: 5 }),
    firstName: firstName || 'New',
    lastName: body.lastName || rest.join(' '),
    email: String(body.email || candidate.email || '').toLowerCase().trim(),
    phone: cleanPhone(body.phone || candidate.phone),
    department: body.department || candidate.department || jobProfile?.departmentId?.name || jobProfile?.department,
    designation: body.designation || candidate.offer?.designation || candidate.position || jobProfile?.designation || jobProfile?.title,
    employmentType: body.employmentType || jobProfile?.employmentType || 'FRESHER',
    dateOfJoining: body.dateOfJoining || candidate.offer?.joiningDate || candidate.joining?.joinedAt || new Date(),
    status: body.status || 'ONBOARDING'
  });
  const reportsTo = normalizeObjectId(await resolveReportingManager({ tenantId, candidate, jobProfile, requestedReportsTo: body.reportsTo }));
  if (reportsTo) employee.reportsTo = await ensureManagerAssignmentIsValid({ tenantId, employeeId: employee._id, reportsTo });
  await employee.validate();
  if (await Employee.exists({ tenantId, employeeCode: employee.employeeCode })) throw new ApiError(409, `Employee code ${employee.employeeCode} already exists`);

  let user = null;
  if (employee.email) {
    user = await resolveLoginForEmployee({
      actor: req.user,
      tenantId,
      employee,
      email: employee.email,
      phone: employee.phone,
      name: `${employee.firstName} ${employee.lastName || ''}`.trim(),
      role: body.role ? access.role : undefined,
      defaultRole: access.role,
      operationPermissions: access.operationPermissions
    });
    employee.userId = user._id;
  }
  await employee.save();
  // v27: the new login gets a one-time password by email / WhatsApp (shown once to HR too).
  const login = user ? await loginAccess.giveLoginDetails({ tenantId, employee, user }) : null;
  const notificationLogs = login?.notificationLogs || [];
  candidate.stage = 'JOINED';
  candidate.joining = { ...(candidate.joining || {}), employeeId: employee._id, joinedAt: employee.dateOfJoining };
  await candidate.save();
  await DocumentAsset.updateMany({ tenantId, ownerType: 'CANDIDATE', ownerId: candidate._id }, { $set: { employeeId: employee._id } });
  return { employee, created: true, notificationLogs, user: user ? user.toJSON() : null, warnings: access.warnings, temporaryPassword: login?.temporaryPassword, loginDelivered: login?.delivered, loginMessage: login?.message };
}

exports.summary = asyncHandler(async (req, res) => {
  const [candidates, openings, departments, locations, jobProfiles] = await Promise.all([
    Candidate.find({ tenantId: req.tenantId }).populate(candidatePopulate).sort('-appliedAt'),
    JobOpening.find({ tenantId: req.tenantId }).populate(openingPopulate).sort('-postedAt'),
    RecruitmentDepartment.find({ tenantId: req.tenantId }).populate('managerId directorId', 'employeeCode firstName lastName designation').sort('name'),
    RecruitmentLocation.find({ tenantId: req.tenantId }).sort('name'),
    RecruitmentJobProfile.find({ tenantId: req.tenantId }).populate(jobProfilePopulate).sort('title')
  ]);
  const counts = Object.fromEntries(stages.map((stage) => [stage, candidates.filter((c) => c.stage === stage).length]));
  const joinedNeedingDetails = candidates.filter((c) => c.stage === 'JOINED' && c.joining?.employeeId);
  res.json({ candidates, openings, departments, locations, jobProfiles, stages, counts, joinedNeedingDetails });
});

exports.listMasters = asyncHandler(async (req, res) => {
  const [departments, locations, jobProfiles] = await Promise.all([
    RecruitmentDepartment.find({ tenantId: req.tenantId }).populate('managerId directorId', 'employeeCode firstName lastName designation').sort('name'),
    RecruitmentLocation.find({ tenantId: req.tenantId }).sort('name'),
    RecruitmentJobProfile.find({ tenantId: req.tenantId }).populate(jobProfilePopulate).sort('title')
  ]);
  res.json({ departments, locations, jobProfiles });
});

async function upsertMaster(req, { Model, fields, requiredField, label, prepare }) {
  const { set, unset } = pickFields(req.body, fields);
  if (!req.params.id || Object.prototype.hasOwnProperty.call(set, requiredField)) {
    if (!String(set[requiredField] ?? '').trim()) throw new ApiError(400, `${label} is required`);
  }
  if (prepare) await prepare(set);
  await assertTenantRefs(req.tenantId, set);
  if (!req.params.id) return Model.create({ ...set, tenantId: req.tenantId, createdBy: req.user._id });
  const update = updateDoc(set, unset, fields);
  const doc = Object.keys(update).length
    ? await Model.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId }, update, { new: true, runValidators: true })
    : await Model.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!doc) throw new ApiError(404, 'Master record not found');
  return doc;
}

exports.upsertDepartment = asyncHandler(async (req, res) => {
  const doc = await upsertMaster(req, { Model: RecruitmentDepartment, fields: DEPARTMENT_FIELDS, requiredField: 'name', label: 'Department name' });
  res.status(req.params.id ? 200 : 201).json({ department: doc });
});

exports.upsertLocation = asyncHandler(async (req, res) => {
  const doc = await upsertMaster(req, { Model: RecruitmentLocation, fields: LOCATION_FIELDS, requiredField: 'name', label: 'Location name' });
  res.status(req.params.id ? 200 : 201).json({ location: doc });
});

exports.upsertJobProfile = asyncHandler(async (req, res) => {
  const doc = await upsertMaster(req, {
    Model: RecruitmentJobProfile,
    fields: JOB_PROFILE_FIELDS,
    requiredField: 'title',
    label: 'Job title/profile',
    prepare: async (set) => {
      sanitizeJobProfileAccess(req, set);
      Object.assign(set, await hydrateJobPayload({ tenantId: req.tenantId, payload: set }));
      for (const key of Object.keys(set)) if (!JOB_PROFILE_FIELDS.includes(key)) delete set[key];
    }
  });
  res.status(req.params.id ? 200 : 201).json({ jobProfile: await RecruitmentJobProfile.findById(doc._id).populate(jobProfilePopulate) });
});

exports.deleteMaster = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const map = { departments: RecruitmentDepartment, locations: RecruitmentLocation, jobProfiles: RecruitmentJobProfile };
  const Model = map[type];
  if (!Model) throw new ApiError(400, 'Invalid master type');
  const doc = await Model.findOneAndUpdate({ _id: id, tenantId: req.tenantId }, { isActive: false }, { new: true });
  if (!doc) throw new ApiError(404, 'Master record not found');
  res.json({ deleted: true, record: doc });
});

exports.listCandidates = asyncHandler(async (req, res) => {
  const q = { tenantId: req.tenantId };
  if (req.query.stage) q.stage = req.query.stage;
  const candidates = await Candidate.find(q).populate(candidatePopulate).sort('-appliedAt');
  res.json({ candidates });
});

async function candidatePayload(req, { existing } = {}) {
  const { set, unset } = pickFields(req.body, CANDIDATE_FIELDS);
  if (set.email !== undefined) set.email = String(set.email || '').toLowerCase().trim();
  if (set.phone !== undefined) set.phone = cleanPhone(set.phone);
  if (set.offer !== undefined) set.offer = pickOffer(set.offer);
  if (set.stage === 'JOINED' && existing?.stage !== 'JOINED') throw new ApiError(400, 'Use Move to Joined / Convert to employee to mark a candidate as joined');
  const hydrated = await hydrateJobPayload({ tenantId: req.tenantId, payload: set });
  const payload = Object.fromEntries(Object.entries(hydrated).filter(([key]) => CANDIDATE_FIELDS.includes(key)));
  await assertTenantRefs(req.tenantId, payload);
  return { payload, unset };
}

exports.createCandidate = asyncHandler(async (req, res) => {
  const { payload } = await candidatePayload(req);
  if (!String(payload.name || '').trim()) throw new ApiError(400, 'Candidate name is required');
  const candidateCode = payload.candidateCode || await nextCode({ Model: Candidate, tenantId: req.tenantId, field: 'candidateCode', prefix: 'APP-', width: 5 });
  const candidate = await Candidate.create({ ...payload, tenantId: req.tenantId, candidateCode, createdBy: req.user._id });
  res.status(201).json({ candidate: await Candidate.findById(candidate._id).populate(candidatePopulate) });
});

exports.updateCandidate = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!candidate) throw new ApiError(404, 'Candidate not found');
  const { payload, unset } = await candidatePayload(req, { existing: candidate });
  if (payload.name !== undefined && !String(payload.name).trim()) throw new ApiError(400, 'Candidate name is required');
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'offer') {
      for (const [field, v] of Object.entries(value || {})) candidate.set(`offer.${field}`, v);
    } else candidate.set(key, value);
  }
  for (const key of unset) candidate.set(key, undefined);
  await candidate.save();
  res.json({ candidate: await Candidate.findById(candidate._id).populate(candidatePopulate) });
});

exports.moveCandidate = asyncHandler(async (req, res) => {
  const { stage } = req.body;
  if (!stages.includes(stage)) throw new ApiError(400, 'Invalid recruitment stage');
  const candidate = await Candidate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!candidate) throw new ApiError(404, 'Candidate not found');
  candidate.stage = stage;
  await candidate.save();
  let employeeResult = null;
  if (stage === 'JOINED') employeeResult = await convertCandidateToEmployee({ req, candidate, body: req.body.employee || {} });
  res.json({ candidate: await Candidate.findById(candidate._id).populate(candidatePopulate), employeeResult });
});

exports.deleteCandidate = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
  if (!candidate) throw new ApiError(404, 'Candidate not found');
  await DocumentAsset.deleteMany({ tenantId: req.tenantId, ownerType: 'CANDIDATE', ownerId: candidate._id });
  res.json({ deleted: true });
});

exports.listOpenings = asyncHandler(async (req, res) => {
  const openings = await JobOpening.find({ tenantId: req.tenantId }).populate(openingPopulate).sort('-postedAt');
  res.json({ openings });
});

async function openingPayload(req) {
  const { set, unset } = pickFields(req.body, OPENING_FIELDS);
  const hydrated = await hydrateJobPayload({ tenantId: req.tenantId, payload: set });
  const payload = Object.fromEntries(Object.entries(hydrated).filter(([key]) => OPENING_FIELDS.includes(key)));
  await assertTenantRefs(req.tenantId, payload);
  return { payload, unset };
}

exports.createOpening = asyncHandler(async (req, res) => {
  const { payload } = await openingPayload(req);
  if (!payload.title) throw new ApiError(400, 'Job title is required');
  const jobId = payload.jobId || await nextCode({ Model: JobOpening, tenantId: req.tenantId, field: 'jobId', prefix: 'JOB-', width: 3 });
  const opening = await JobOpening.create({ ...payload, tenantId: req.tenantId, jobId, createdBy: req.user._id });
  res.status(201).json({ opening: await JobOpening.findById(opening._id).populate(openingPopulate) });
});

exports.updateOpening = asyncHandler(async (req, res) => {
  const { payload, unset } = await openingPayload(req);
  if (Object.prototype.hasOwnProperty.call(payload, 'title') && !String(payload.title || '').trim()) throw new ApiError(400, 'Job title is required');
  const update = updateDoc(payload, unset, OPENING_FIELDS);
  const opening = Object.keys(update).length
    ? await JobOpening.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId }, update, { new: true, runValidators: true }).populate(openingPopulate)
    : await JobOpening.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate(openingPopulate);
  if (!opening) throw new ApiError(404, 'Job opening not found');
  res.json({ opening });
});

exports.deleteOpening = asyncHandler(async (req, res) => {
  const opening = await JobOpening.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
  if (!opening) throw new ApiError(404, 'Job opening not found');
  res.json({ deleted: true });
});

exports.sendLetter = asyncHandler(async (req, res) => {
  const { kind } = req.params;
  if (!['offer', 'joining'].includes(kind)) throw new ApiError(400, 'Letter kind must be offer or joining');
  const candidate = await Candidate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!candidate) throw new ApiError(404, 'Candidate not found');
  if (req.body.offer) candidate.offer = { ...(candidate.offer || {}), ...req.body.offer };
  if (req.body.joining) candidate.joining = { ...(candidate.joining || {}), ...req.body.joining };
  const buffer = await buildRecruitmentLetterBuffer({ tenantId: req.tenantId, candidate, kind });
  const fileName = `${kind}-letter-${candidate.candidateCode || candidate._id}.pdf`;
  const dataUrl = `data:application/pdf;base64,${buffer.toString('base64')}`;
  await DocumentAsset.create({ tenantId: req.tenantId, ownerType: 'CANDIDATE', ownerId: candidate._id, candidateId: candidate._id, type: kind === 'offer' ? 'OFFER_LETTER' : 'JOINING_LETTER', label: kind === 'offer' ? 'Offer Letter' : 'Joining Letter', fileName, mimeType: 'application/pdf', sizeBytes: buffer.length, dataUrl, uploadedBy: req.user._id, status: 'VERIFIED' });
  const subject = kind === 'offer' ? 'Offer Letter' : 'Joining Letter';
  const logs = await notify({
    tenantId: req.tenantId,
    event: 'CANDIDATE_UPDATE',
    recipients: [{ name: candidate.name, email: candidate.email, phone: candidate.phone }],
    data: {
      subject,
      heading: `Your ${subject.toLowerCase()}`,
      message: `your ${subject.toLowerCase()} has been released by HR and is attached to this email.`,
      position: candidate.position || candidate.offer?.designation,
      extraRows: kind === 'offer' && candidate.offer?.joiningDate ? [['Proposed joining date', new Date(candidate.offer.joiningDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })]] : []
    },
    attachments: [{ filename: fileName, contentType: 'application/pdf', contentBase64: buffer.toString('base64') }],
    actorUserId: req.user._id,
    wait: true
  });
  let employeeResult = null;
  if (kind === 'offer') { candidate.stage = 'OFFERED'; candidate.offer.letterSentAt = new Date(); candidate.offer.letterSentBy = req.user._id; }
  if (kind === 'joining') { candidate.stage = 'JOINED'; candidate.joining.letterSentAt = new Date(); candidate.joining.letterSentBy = req.user._id; employeeResult = await convertCandidateToEmployee({ req, candidate, body: req.body.employee || {} }); }
  await candidate.save();
  res.json({ candidate: await Candidate.findById(candidate._id).populate(candidatePopulate), employeeResult, notificationLogs: logs.concat(employeeResult?.notificationLogs || []) });
});

exports.downloadLetter = asyncHandler(async (req, res) => {
  const { kind } = req.params;
  const candidate = await Candidate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!candidate) throw new ApiError(404, 'Candidate not found');
  const buffer = await buildRecruitmentLetterBuffer({ tenantId: req.tenantId, candidate, kind });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}-letter-${candidate.candidateCode || candidate._id}.pdf"`);
  res.end(buffer);
});

exports.convertToEmployee = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!candidate) throw new ApiError(404, 'Candidate not found');
  const result = await convertCandidateToEmployee({ req, candidate, body: req.body || {} });
  res.status(result.created ? 201 : 200).json({ ...result, candidate: await Candidate.findById(candidate._id).populate(candidatePopulate), temporaryPassword: result.temporaryPassword });
});
