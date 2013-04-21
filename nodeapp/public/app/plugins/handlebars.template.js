/*
 * Handlebars-Utiliy functions
 * using 
 */
var HandlebarsTemplates = (function (Handlebars, global) {
  var NS = {};

  Handlebars.getTemplate = function(name) {
    var TemplateName = 'app/templates/' + name + '.handlebars';

		if (Handlebars.templates === undefined || Handlebars.templates[TemplateName] === undefined) {
			$.ajax({
				url : TemplateName,
				success : function(data) {
					if (Handlebars.templates === undefined) {
						Handlebars.templates = {};
					}
					Handlebars.templates[TemplateName] = Handlebars.compile(data);
				},
				async : false
			});
		}
		return Handlebars.templates[TemplateName];
  };


  return NS;
} (Handlebars, this));