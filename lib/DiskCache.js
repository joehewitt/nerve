
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');
var _ = require('underscore');
var mkdirsSync = require('./mkdir').mkdirsSync;
var gzip = require('gzip');

// *************************************************************************************************

function DiskCache(cachePath, useMemCache, useGzip) {
	this.cachePath = cachePath;
	this.useMemCache = useMemCache;
	this.useGzip = useGzip;
	this.memCache = {};
	this.locks = {};
	mkdirsSync(cachePath);
}

DiskCache.prototype = {
	store: function(url, data, category, cb) {
		if (typeof(category) == "function") { cb = category; category = null; }

		var jsonData = JSON.stringify(data);

		if (this.useMemCache) {
			if (this.useGzip && data.body) {
	        	gzip(data.body, _.bind(function(err, gzipped) {
	        		data.bodyZipped = gzipped;
					this.memCache[url] = data;
					phase2.apply(this);
	        	}, this));
	        } else {
				this.memCache[url] = data;
				phase2.apply(this);
	        }
		} else {
			phase2.apply(this);
		}

		function phase2() {
			var filePath = this.pathForURL(url, category);
			// console.log('writing',url);
			fs.writeFile(filePath, jsonData, 'utf8', _.bind(function(err) {
				// console.log('wrote',url);
				if (cb) {
					cb(err, data);
				}
				this.unlock(url, data);
			}, this));
		}
	},

	load: function(url, category, cb) {
		if (typeof(category) == "function") {cb = category; category = null; }

		var locks = this.locks[url];
		if (locks) {
			// console.log('wait for lock on', url);
			locks.push(cb);
		} else {
			if (url in this.memCache) {
				cb(0, this.memCache[url]);
			} else {
				var filePath = this.pathForURL(url, category);
				// console.log('try to load', filePath, 'for', url);
				fs.readFile(filePath, _.bind(function(err, jsonData) {
					if (err) return cb ? cb(err) : 0;

					var data = JSON.parse(jsonData);

					if (this.useMemCache) {
						if (this.useGzip && data.body) {
				        	gzip(data.body, _.bind(function(err, gzipped) {
				        		data.bodyZipped = gzipped;
								this.memCache[url] = data;
								cb(0, data);
				        	}, this));
				        } else {
							this.memCache[url] = data;
							cb(0, data);
				        }
					} else {
						cb(0, data);
					}
				}, this));				
			}
		}
	},
	
	lock: function(url) {
		// console.log('lock', url);
		this.locks[url] = [];
	},

	unlock: function(url, data) {
		// console.log('unlock', url);
		var callbacks = this.locks[url];
		if (callbacks) {
			delete this.locks[url];

			callbacks.forEach(function(cb) {
				cb(0, data);
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
