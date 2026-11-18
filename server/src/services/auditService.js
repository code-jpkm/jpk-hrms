const RuleAudit = require('../models/RuleAudit');

/**
 * Writes an audit row without letting an audit problem fail a change that has
 * already been saved (v26: a bad module enum turned successful saves into 500s).
 */
async function recordAudit(entry) {
  try {
    return await RuleAudit.create(entry);
  } catch (error) {
    console.error(`[audit] could not record ${entry?.module}/${entry?.action}: ${error.message}`);
    return null;
  }
}

module.exports = { recordAudit };
