/*
 * common logic used by controllers
 * common.js created by Henrik Binggl
 */
var localUtils = require('../utils/locales');

// common variables passed by a controller to the view
// ----------------------------------------------------------------
exports.commonVariables = function(req, res) {
  var result = {
    mainLocale: localUtils.mainLocale(res),
    altLocale: localUtils.convertLocale(res),
    mode: process.env.NODE_ENV
  };
  return result;
};