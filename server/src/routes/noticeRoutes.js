const router=require('express').Router();
const {auth,requireAbility}=require('../middleware/auth');
const controller=require('../controllers/noticeController');
router.use(auth);router.get('/',controller.list);router.post('/',requireAbility('NOTICES','MANAGE','SUPER_ADMIN','HR_ADMIN'),controller.create);router.delete('/:id',requireAbility('NOTICES','MANAGE','SUPER_ADMIN','HR_ADMIN'),controller.remove);
module.exports=router;
