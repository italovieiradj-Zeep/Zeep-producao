const express = require('express');
const router = express.Router();
const { login, criarAcesso } = require('../controllers/authController');

router.post('/login', login);
router.post('/criar-acesso', criarAcesso);

module.exports = router;