
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');
var _ = require('underscore');
var mkdirsSync = require('./mkdir').mkdirsSync;

// *************************************************************************************************

function DiskCache(cachePath, useMemCache) {
	this.cachePath = cachePath;
	this.useMemCache = useMemCache;
	this.memCache = {};

	mkdirsSync(cachePath);
}

DiskCache.prototype = {
	store: function(url, body, cb) {
		if (this.useMemCache) {
			this.memCache[url] = body;
		}

		var filePath = this.pathForURL(url);
		fs.open(filePath, 'w', undefined, function(err, fd) {
			fs.write(fd, body, undefined, undefined, undefined, function(err, written, buffer) {
				fs.closeSync(fd);
				if (cb) {
					cb(err);
				}
			});
		});
	},

	load: function(url, cb) {
		var filePath = this.pathForURL(url);
		console.log('try to load', filePath, 'for', url);

		fs.readFile(filePath, function(err, body) {
			if (err) return cb ? cb(err) : 0;

			if (this.useMemCache) {
				this.memCache[url] = body;
			}

			cb(0, body);
		});;
	},
	
	remove: function(url, cb) {
		var filePath = this.pathForURL(url);
		console.log('remove', filePath, 'for', url);
		fs.unlink(filePath, cb);
		
		if (this.useMemCache) {
			delete this.memCache[url];
		}
	},

	removeAll: function() {
		var fileNames = fs.readdirSync(this.cachePath);
		_.each(fileNames, _.bind(function(fileName) {
			fs.unlink(path.join(this.cachePath, fileName));
		}, this));

		if (this.useMemCache) {
			this.memCache = {};
		}
	},

	keyForURL: function(url) {
		var hash = crypto.createHash('md5');
		hash.update(url);
		return hash.digest('hex');
	},

	pathForURL: function(url) {
		var key = this.keyForURL(url);
		var fileName = key + '.txt';
		return path.join(this.cachePath, fileName);
	}

};

exports.DiskCache = DiskCache;
