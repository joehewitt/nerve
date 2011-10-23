
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
    pattern: /^(([a-zA-Z_0-9\.]\/?)+)$/,

	transform: function(post, relativePath, x, url, title, alt, query, cb) {
		post.blog.contentPaths.forEach(ibind(function(entry) {
			// XXXjoe Potential XSS here, need to remove .. from relativePath
			var imagePath = path.join(entry.path, 'images', relativePath);
			fs.stat(imagePath, abind(function(err, stat) {
				if (err) {
					cb(err);			
				} else {
					var reOptions = /(\d+)/g;
					var options = [];
					var m;
					while (m = reOptions.exec(alt)) {
						options.push(m[1]);
					}

					var imageSize = '';
					var width = options[0] ? parseInt(options[0]) : 0;
					var height = options[1] ? parseInt(options[1]) : 0;;
					if (width && height) {
						imageSize = '/' + options[0] + 'x' + options[1];
					} else if (width || height) {
						imageSize = '/' + (width || height) + 'x';
					}

					readImageSize(imagePath, width, height, abind(function(err, size) {
						var baseURL = 'http://' + post.blog.host + '/content/images/' + relativePath + imageSize;
						var normalURL = post.blog.normalizeURL(baseURL);

						var tag = '<img src="' + normalURL + '"'
								  + 'width="' + size.width + '" height="' + size.height + '">';
						var attachment = {large: normalURL};

						cb(0, {content: tag, attachments: [attachment]});						
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
