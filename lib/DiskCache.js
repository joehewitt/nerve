
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
	this.locks = {};

	mkdirsSync(cachePath);
}

DiskCache.prototype = {
	store: function(url, body, category, cb) {
		if (typeof(category) == "function") { cb = category; category = null; }

		if (this.useMemCache) {
			this.memCache[url] = body;
		}

		var cache = this;
		var filePath = this.pathForURL(url, category);
		// console.log('writing',url);
		fs.writeFile(filePath, body, 'utf8', function(err) {
			// console.log('wrote',url);
			if (cb) {
				cb(err);
			}
			cache.unlock(url, body);
		});
	},

	load: function(url, category, cb) {
		if (typeof(category) == "function") {cb = category; category = null; }

		var locks = this.locks[url];
		if (locks) {
			// console.log('wait for lock on', url);
			locks.push(cb);
		} else {
			var filePath = this.pathForURL(url, category);
			// console.log('try to load', filePath, 'for', url);

			var cache = this;
			fs.readFile(filePath, function(err, body) {
				if (err) return cb ? cb(err) : 0;

				if (cache.useMemCache) {
					cache.memCache[url] = body;
				}

				cb(0, body);
			});		
		}
	},
	
	lock: function(url) {
		// console.log('lock', url);
		this.locks[url] = [];
	},

	unlock: function(url, body) {
		// console.log('unlock', url);
		var callbacks = this.locks[url];
		if (callbacks) {
			delete this.locks[url];

			callbacks.forEach(function(cb) {
				cb(0, body);
			});
		}
	},

	remove: function(url, category, cb) {
		if (typeof(category) == "function") {cb = category; category = null; }

		var filePath = this.pathForURL(url, category);
		// console.log('remove', filePath, 'for', url);
		fs.unlink(filePath, cb);
		
		if (this.useMemCache) {
			delete this.memCache[url];
		}
	},

	removeAll: function(category) {
		var cachePath = category ? path.join(this.cachePath, category) : this.cachePath;
		var fileNames = fs.readdirSync(cachePath);
		_.each(fileNames, _.bind(function(fileName) {
			var filePath = path.join(cachePath, fileName);
			// console.log('remove', filePath);
			fs.unlink(filePath);
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

	pathForURL: function(url, category) {
		var cachePath = category ? path.join(this.cachePath, category) : this.cachePath;
		if (category) {
			mkdirsSync(cachePath);
		}
		var key = this.keyForURL(url);
		var fileName = key + '.txt';
		return path.join(cachePath, fileName);
	}
};

exports.DiskCache = DiskCache;
