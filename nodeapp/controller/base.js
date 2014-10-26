/*
 * basic controller logic to display the different templates
 * base.js created by Henrik Binggl
 */
'uset strict';

var c = require('./common');

exports.index = function(req, res){
  var result = c.commonVariables(req, res);
  result.title = res.locals.lingua.Title;
  res.render('index', result);
};

exports.rooms = function(req, res){
  var result = c.commonVariables(req, res);
  result.title = res.locals.lingua.Rooms;
  res.render('rooms', result);
};

exports.flat = function(req, res){
  var result = c.commonVariables(req, res);
  result.title = res.locals.lingua.Flat;
  res.render('flat', result);
};

exports.location = function(req, res){
  var result = c.commonVariables(req, res);
  result.title = res.locals.lingua.Location;
  res.render('location', result);
};