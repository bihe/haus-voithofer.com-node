/*
 * basic controller logic to display the different templates
 * base.js created by Henrik Binggl
 */
var localUtils = require('../utils/locales');

exports.index = function(req, res){
  res.render('index', {title: res.locals.lingua.Title,
    mainLocale: localUtils.mainLocale(res),
    altLocale: localUtils.convertLocale(res)
  });
};

exports.rooms = function(req, res){
  res.render('rooms', {title: res.locals.lingua.Rooms,
    mainLocale: localUtils.mainLocale(res),
    altLocale: localUtils.convertLocale(res)
  });
};

exports.flat = function(req, res){
  res.render('flat', {title: res.locals.lingua.Flat,
    mainLocale: localUtils.mainLocale(res),
    altLocale: localUtils.convertLocale(res)
  });
};

exports.location = function(req, res){
  res.render('location', {title: res.locals.lingua.Location,
    mainLocale: localUtils.mainLocale(res),
    altLocale: localUtils.convertLocale(res)
  });
};