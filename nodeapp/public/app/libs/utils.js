window.log = function f(){ log.history = log.history || []; log.history.push(arguments); if(this.console) { var args = arguments, newarr; args.callee = args.callee.caller; newarr = [].slice.call(args); if (typeof console.log === 'object') log.apply.call(console.log, console, newarr); else console.log.apply(console, newarr);}};
(function(a){function b(){}for(var c="assert,count,debug,dir,dirxml,error,exception,group,groupCollapsed,groupEnd,info,log,markTimeline,profile,profileEnd,time,timeEnd,trace,warn".split(","),d;!!(d=c.pop());){a[d]=a[d]||b;}})
(function(){try{console.log();return window.console;}catch(a){return (window.console={});}}());

/*
 * Utiliy functions used
 * using 
 */
var Utils = (function ($) {
  var NS = {};

  // prevent default behavior (submit form, ...)
  // ---------------
  NS.preventDefaultEventHandling = function (e) {
    var evt = e || window.event; // IE compatibility
    if (evt.preventDefault) {
      evt.preventDefault();
    } else {
      evt.returnValue = false;
      evt.cancelBubble = true;
    }
  };

  // handle validation, shwo errors (boostrap specific)
	// ----------------------------------------
  NS.handleValidation = function (valid, attr, error) {

    // add the message label
    // 
    if ($('#' + attr + 'Message').attr('id') === undefined) {
      $('#' + attr).parent().append('<span class="help-inline hidden" id="' + attr + 'Message">Please correct the error</span>');
    }

    var selector = $('#' + attr).parent();
    var classValue = '';
    if (selector !== undefined) {
      classValue = selector.attr('class');
      if (classValue === undefined) {
        return;
      }

      while (classValue.indexOf('control-group') === -1) {
        selector = selector.parent();
        if (selector === undefined) {
          return;
        }
        classValue = selector.attr('class');
        if (classValue === undefined) {
          return;
        }
      }

      if (valid === true) {
        selector.removeClass('error');
        $('#' + attr + 'Message').addClass('hidden');
        $('#' + attr + 'Message').html('');
      } else {
        $('#' + attr + 'Message').html(error);
        selector.addClass('error');
        $('#' + attr + 'Message').removeClass('hidden');
      }
    }
  };


  return NS;
} (jQuery));
