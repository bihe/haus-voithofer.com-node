#!/bin/bash

VERSION=`/usr/local/bin/git-revision.sh`
VERSION_FILE='/E/Development/haus-voithofer.com-node/nodeapp/config/version.js'

echo "var version = {};" > $VERSION_FILE
echo "version.number = '$VERSION';" >> $VERSION_FILE
echo "module.exports = version;" >> $VERSION_FILE
