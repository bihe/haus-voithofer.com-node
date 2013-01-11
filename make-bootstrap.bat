@echo off
rd boostrap-build /s /q
mkdir boostrap-build\img
mkdir boostrap-build\css
mkdir boostrap-build\js

copy bootstrap\img\* boostrap-build\img

call lessc.cmd -x bootstrap\less\bootstrap.less > boostrap-build\css\bootstrap.min.css
call lessc.cmd -x bootstrap\less\responsive.less > boostrap-build\css\bootstrap.responsive.min.css

copy /B bootstrap\js\bootstrap-transition.js+bootstrap\js\bootstrap-alert.js+bootstrap\js\bootstrap-button.js+bootstrap\js\bootstrap-carousel.js+bootstrap\js\bootstrap-collapse.js+bootstrap\js\bootstrap-dropdown.js+bootstrap\js\bootstrap-modal.js+bootstrap\js\bootstrap-tooltip.js+bootstrap\js\bootstrap-popover.js+bootstrap\js\bootstrap-scrollspy.js+bootstrap\js\bootstrap-tab.js+bootstrap\js\bootstrap-typeahead.js boostrap-build\js\bootstrap.js

call uglifyjs.cmd build\js\bootstrap.js -o boostrap-build\js\bootstrap.min.js

echo compiled all

pause