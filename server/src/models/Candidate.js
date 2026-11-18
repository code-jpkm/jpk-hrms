const mongoose = require('mongoose');

const candidateSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  candidateCode: { type: String, trim: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, lowercase: true, trim: true },
  phone: String,
  jobProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentJobProfile' },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentDepartment' },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentLocation' },
  position: String,
  department: String,
  location: String,
  qualification: String,
  experience: String,
  currentCompany: String,
  expectedCtc: String,
  appliedAt: { type: Date, default: Date.now },
  jobOpeningId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobOpening' },
  stage: {
    type: String,
    enum: ['NEW_APPLICATION', 'SHORTLISTED', 'L1_DONE', 'L2_DONE', 'DIRECTOR_DONE', 'OFFERED', 'JOINED', 'HOLD', 'REJECTED'],
    default: 'NEW_APPLICATION',
    index: true
  },
  notes: String,
  offer: {
    designation: String,
    department: String,
    joiningDate: Date,
    ctc: String,
    letterSentAt: Date,
    letterSentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  joining: {
    joinedAt: Date,
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    letterSentAt: Date,
    letterSentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

candidateSchema.index({ tenantId: 1, candidateCode: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Candidate', candidateSchema);
