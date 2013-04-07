/*
 * helper functions for site structure
 * sites.js created by Henrik Binggl
 */

// the whole site consists of a number of sites. depending on the active
// site return a JSON structure which is used for the navigation logic
// to highlight the current navigation entry
// --------------------------------------------------------------------------
exports.structure = function(site) {
  var siteStructure = {rooms: '', flat: '', location: '', contact: ''};
  if(site) {
    siteStructure[site] = 'active';
  }
  return siteStructure;
};