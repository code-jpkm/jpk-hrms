const mongoose = require('mongoose');

/** Monotonic per-tenant sequences (candidate / job / employee codes). _id is the sequence key. */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
}, { versionKey: false });

module.exports = mongoose.model('Counter', counterSchema);
