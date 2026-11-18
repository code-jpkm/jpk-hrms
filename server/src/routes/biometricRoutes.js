const router = require('express').Router();
const { auth, requireRoles, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/biometricController');

// Public endpoint for the local LAN biometric bridge / vendor push. Protected by per-device API token.
router.post('/public-push/:deviceId', controller.publicPush);

router.use(auth);
router.get('/devices', requireAbility('BIOMETRIC', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.listDevices);
router.post('/devices', requireAbility('BIOMETRIC', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.createDevice);
router.patch('/devices/:id', requireAbility('BIOMETRIC', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.updateDevice);
router.post('/devices/:id/sync', requireAbility('BIOMETRIC', 'SYNC', 'SUPER_ADMIN', 'HR_ADMIN'), controller.syncOne);
router.post('/devices/:id/test', requireAbility('BIOMETRIC', 'SYNC', 'SUPER_ADMIN', 'HR_ADMIN'), controller.testDevice);
router.post('/sync', requireAbility('BIOMETRIC', 'SYNC', 'SUPER_ADMIN', 'HR_ADMIN'), controller.syncAll);
router.post('/manual-import', requireAbility('BIOMETRIC', 'SYNC', 'SUPER_ADMIN', 'HR_ADMIN'), controller.importManualLogs);
router.get('/raw-punches', requireAbility('BIOMETRIC', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.rawPunches);

// Machines that send punches by themselves (ADMS / Cloud Server mode).
router.get('/machines', requireAbility('BIOMETRIC', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.machines);
router.post('/machines', requireAbility('BIOMETRIC', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.addMachine);
router.post('/machines/link', requireAbility('BIOMETRIC', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.linkMachineId);
router.post('/machines/relay', requireAbility('BIOMETRIC', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.saveRelay);
router.post('/machines/process', requireAbility('BIOMETRIC', 'SYNC', 'SUPER_ADMIN', 'HR_ADMIN'), controller.processMachinePunches);
router.post('/machines/:id/approve', requireAbility('BIOMETRIC', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.approveMachine);
router.patch('/machines/:id', requireAbility('BIOMETRIC', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.updateMachine);
router.post('/machines/:id/stop', requireAbility('BIOMETRIC', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.stopMachine);
router.delete('/machines/:id', requireAbility('BIOMETRIC', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.removeMachine);

module.exports = router;
