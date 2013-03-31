/*
 * define the routes to the handling controllers
 * index.js created by Henrik Binggl
 */

var baseController = require('../controller/base');
var contactController = require('../controller/contact');

// setup the routes and delegate logic to the controllers 
// --------------------------------------------------------------------------
exports.setup = function(app) {

  app.get('/', baseController.index);
  app.get('/rooms', baseController.rooms);
  app.get('/flat', baseController.flat);
  app.get('/location', baseController.location);

  app.get('/contact', contactController.contactPage);
  app.post('/contact', contactController.contactAction);
};