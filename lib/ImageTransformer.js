
var _ = require('underscore');
var path = require('path');
var fs = require('fs');
var abind = require('dandy/errors').abind;
var ibind = require('dandy/errors').ibind;

// ************************************************************************************************

function ImageTransformer() {
}
exports.ImageTransformer = ImageTransformer;

ImageTransformer.prototype = {
    pattern: /^(([a-zA-Z0-9_\.\-]\/?)+)$/,

	transform: function(post, x, y, url, title, alt, query, cb) {
		post.blog.contentPaths.forEach(ibind(function(entry) {
			var parts = url.split(/\s+/);
			var relativePath = parts[0];

			var options = {
				width: 0,
				height: 0,
				align: '',
			};
			var reOptions = /(center|start|end)|(\d+px)/;
			for (var i = 1; i < parts.length; ++i) {
				var m = reOptions.exec(parts[i]);
				if (m) {
					if (m[1]) {
						options.align = m[1];
					} else if (m[2]) {
						var d = parseInt(m[2]);
						if (options.width) {
							options.height = d;
						} else {
							options.width = options.height = d;
						}
					}
				}
			}

			// XXXjoe Potential XSS here, need to remove .. from relativePath if it's found
			var imagePath = path.join(entry.path, 'images', relativePath);
			fs.stat(imagePath, abind(function(err, stat) {
				if (err) {
					cb(err);			
				} else {

					var imageSize = '';
					if (options.width && options.height) {
						imageSize = '/' + options.width + 'x' + options.height;
					}

					readImageSize(imagePath, options.width, options.height, abind(function(err, size) {
						var normalURL = post.blog.normalizeImageURL(relativePath + imageSize);

						var tag = '<img src="' + normalURL + '" title="' + title + '" '
								  + 'width="' + size.width + '" height="' + size.height + '">';
						cb(0, {content: tag});
					}, cb, this))
				}
			}, cb, this));
		}, cb, this));		
	}	
};

function readImageSize(imagePath, width, height, cb) {
	if (width && height) {
		cb(0, {width: width, height: height});
	} else {
		var magick = require('imagemagick');
		magick.identify(imagePath, abind(function(err, features) {
			if (width) {
				height = Math.round((features.height/features.width) * width);
				cb(0, {width: width, height: height});
			} else if (height) {
				width = Math.round((features.width/features.height) * height);
				cb(0, {width: width, height: height});
			} else {
				cb(0, {width: features.width, height: features.height});
			}
		}, cb, this));
	}
}
