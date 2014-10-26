/*
 * common logic used by controllers
 * common.js created by Henrik Binggl
 */
'use strict';

var localUtils = require('../utils/locales');
var sites = require('../utils/sites');
var config = require('../config/application');

// common variables passed by a controller to the view
// ----------------------------------------------------------------
exports.commonVariables = function(req, res) {
  console.log(req.path);
  var reqPath = '';
  if(req.path === '/') {
    reqPath = 'index';
  } else {
    reqPath = req.path.substring(1);
    console.log('path without slash: ' + reqPath);
    // remove the query-string
    var index = reqPath.indexOf('?');
    if(index > -1) {
      reqPath = reqPath.substring(0, index);
      console.log('querystring removed: ' + reqPath);
    }
  }
  var result = {
    mainLocale: localUtils.mainLocale(res),
    altLocale: localUtils.convertLocale(res),
    mode: process.env.NODE_ENV,
    activeNavigaton: sites.structure(reqPath)
  };
  return result;
};