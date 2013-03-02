
/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index', { title: '' });
};

exports.rooms = function(req, res){
  res.render('rooms', { title: '' });
};