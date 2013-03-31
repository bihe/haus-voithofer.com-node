/*
 * helper functions for locale handling
 * locales.js created by Henrik Binggl
 */

// take a full-locale as parameter and return the mainlocale element
// e.g. supplied en-US return en, de-AT - return de 
// --------------------------------------------------------------------------
exports.mainLocale = function(res) {
  var mainLocale = '';
  if(res && res.lingua && res.lingua.locale) {
    var fullLocale = res.lingua.locale;
    var parts = fullLocale.split('-');
    if(parts && parts.length > 0) {
      mainLocale = parts[0];
    }
  }

  return mainLocale;
};

// helper which convert to locle from the sytnax language-country
// to language_country
// e.g. de-AT ==> de_AT, en-US ==> en_US 
// --------------------------------------------------------------------------
exports.convertLocale = function(res) {
  var convertedLocale = '';
  if(res && res.lingua && res.lingua.locale) {
    convertedLocale = res.lingua.locale;
    var fullLocale = res.lingua.locale;
    var parts = fullLocale.split('-');
    if(parts && parts.length > 0) {
      convertedLocale = parts[0] + '_' + parts[1];
    }
  }

  return convertedLocale;
};