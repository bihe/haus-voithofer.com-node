/*
 * define the routes to the handling controllers
 * index.js created by Henrik Binggl
 */
'use strict';

var express = require('express');
var router = express.Router();

var baseController = require('../controller/base');
var contactController = require('../controller/contact');

// setup the routes and delegate logic to the controllers 
// --------------------------------------------------------------------------
router.get('/', baseController.index);
router.get('/rooms', baseController.rooms);
router.get('/flat', baseController.flat);
router.get('/location', baseController.location);

router.get('/contact', contactController.contactPage);
router.post('/contact', contactController.contactAction);

module.exports = router;