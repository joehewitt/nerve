// This code courtesy of Rasmus Andersson via https://gist.github.com/319051

var fs = require('fs');
var path = require('path');

// mkdirsSync(path, [mode=(0777^umask)]) -> pathsCreated
exports.mkdirsSync = function (dirname, mode) {
  if (mode === undefined) mode = 0x1ff ^ process.umask();
  var pathsCreated = [], pathsFound = [];
  var fn = dirname;
  while (true) {
    try {
      var stats = fs.statSync(fn);
      if (stats.isDirectory())
        break;
      throw new Error('Unable to create directory at '+fn);
    }
    catch (e) {
      if (e.errno === 2/*ENOENT*/) {
        pathsFound.push(fn);
        fn = path.dirname(fn);
      }
      else {
        throw e;
      }
    }
  }
  for (var i=pathsFound.length-1; i>-1; i--) {
    var fn = pathsFound[i];
    fs.mkdirSync(fn, mode);
    pathsCreated.push(fn);
  }
  return pathsCreated;
};
