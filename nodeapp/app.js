
/**
 * Module dependencies.
 */

var express = require('express');
var http = require('http');
var lingua = require('lingua');
var path = require('path');
var routes = require('./routes');
var config = require('./config/application');

var app = express();

app.configure(function(){
  app.set('port', process.env.PORT || 3000);
  app.set('host', '127.0.0.1');
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');

  // add i18n logic
  app.use(lingua(app, {
    defaultLocale: 'de-AT',
    path: __dirname + '/i18n',
    storageKey: 'l'
  }));

  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser(config.application.secret));
  app.use(express.session());
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

// pretty HTML formating for output
app.locals.pretty = true;

app.configure('development', function(){
  app.use(express.errorHandler());
});

routes.setup(app);

http.createServer(app).listen(app.get('port'), app.get('host'),  function(){
  console.log('node.js is run in mode ' + process.env.NODE_ENV);
  console.log("Express server listening on port " + app.get('port'));
});
