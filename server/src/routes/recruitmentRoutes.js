const router = require('express').Router();
const { auth, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/recruitmentController');

router.use(auth);
router.get('/', requireAbility('RECRUITMENT', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.summary);
router.get('/masters', requireAbility('RECRUITMENT', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.listMasters);
router.post('/masters/departments', requireAbility('RECRUITMENT', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.upsertDepartment);
router.patch('/masters/departments/:id', requireAbility('RECRUITMENT', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.upsertDepartment);
router.post('/masters/locations', requireAbility('RECRUITMENT', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.upsertLocation);
router.patch('/masters/locations/:id', requireAbility('RECRUITMENT', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.upsertLocation);
router.post('/masters/job-profiles', requireAbility('RECRUITMENT', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.upsertJobProfile);
router.patch('/masters/job-profiles/:id', requireAbility('RECRUITMENT', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.upsertJobProfile);
router.delete('/masters/:type/:id', requireAbility('RECRUITMENT', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.deleteMaster);
router.get('/candidates', requireAbility('RECRUITMENT', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.listCandidates);
router.post('/candidates', requireAbility('RECRUITMENT', 'CREATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.createCandidate);
router.patch('/candidates/:id', requireAbility('RECRUITMENT', 'UPDATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.updateCandidate);
router.post('/candidates/:id/move', requireAbility('RECRUITMENT', 'UPDATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.moveCandidate);
router.delete('/candidates/:id', requireAbility('RECRUITMENT', 'DELETE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.deleteCandidate);
router.post('/candidates/:id/letters/:kind/send', requireAbility('RECRUITMENT', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.sendLetter);
router.get('/candidates/:id/letters/:kind/download', requireAbility('RECRUITMENT', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.downloadLetter);
router.post('/candidates/:id/convert-to-employee', requireAbility('RECRUITMENT', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.convertToEmployee);
router.get('/openings', requireAbility('RECRUITMENT', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.listOpenings);
router.post('/openings', requireAbility('RECRUITMENT', 'CREATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.createOpening);
router.patch('/openings/:id', requireAbility('RECRUITMENT', 'UPDATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.updateOpening);
router.delete('/openings/:id', requireAbility('RECRUITMENT', 'DELETE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.deleteOpening);

module.exports = router;
