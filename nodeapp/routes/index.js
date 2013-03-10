
/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index', { title: '' });
};

exports.rooms = function(req, res){
  res.render('rooms', { title: '' });
};

exports.flat = function(req, res){
  res.render('flat', { title: '' });
};

exports.location = function(req, res){
  res.render('location', { title: '' });
};

exports.contact = function(req, res){
  res.render('contact', { title: '' });
};