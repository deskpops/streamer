var child_process = require('child_process');
var fs = require('fs');
var http = require('follow-redirects').http;
var https = require('follow-redirects').https;
var AWS = require('aws-sdk');
var tmp = require('tmp');

var AudioConverter = {
    bucket: 'bespoken/streaming',
    cache: {},

    /**
     * Creates temp file for input, and filename for output
     * Runs ffmpeg to convert m4a input data into mp3 output file
     * Once written, reads it in and deletes the file
     * @param inputData
     * @param callback
     */
    convert: function(inputData, fileType, callback) {
        // Create the temporary file
        tmp.file({prefix: 'ffmpeg-', postfix: '.' + fileType }, function(error, inputPath, fd, cleanupCallback) {
            // Write the file
            fs.writeFile(inputPath, inputData, null, function () {

                // Get a temporary filename for the output file
                tmp.tmpName({postfix: '.mp3'}, function (error, outputPath) {

                    // Run ffmpeg to convert the file to MP3
                    child_process.execFile('ffmpeg',
                        ['-i', inputPath, '-codec:a', 'libmp3lame', '-b:a', '48k', '-ar', '16000', '-af', 'volume=3', outputPath],
                        function(error, stdout, stderr) {
                            // Call this to delete the input file
                            cleanupCallback();

                            fs.readFile(outputPath, {encoding: null}, function (error, data) {
                                // Delete output file once read
                                fs.unlink(outputPath);
                                callback(data);
                            });
                        }
                    );
                });
            });
        });
    },

    download: function(url, callback) {
        var responseCallback = function(response) {
            var data = new Buffer('');

            //another chunk of data has been recieved, so append it to `str`
            response.on('data', function (chunk) {
                data = Buffer.concat([data, chunk]);
            });

            //the whole response has been received, so we just print it out here
            response.on('end', function () {
                callback(data);
            });
        }

        if (url.startsWith('https')) {
            https.get(url, responseCallback).end();
        } else {
            http.get(url, responseCallback).end();
        }

    },

    upload: function(bucket, key, data, callback) {
        var self = this;
        var s3 = new AWS.S3();
        var params = {Bucket: bucket, Key: key, Body: data, ACL: 'public-read'};
        s3.putObject(params, function (err, data) {
            callback(self.urlForKey(bucket, key));
        });
    },

    convertAndUpload: function(name, url, callback) {
        var self = this;
        var convertedURL = this.cache[url];
        if (convertedURL === undefined) {
            var outputURL = this.urlForKey(this.bucket, name);
            this.audioExists(outputURL, function (existingURL) {
                if (existingURL !== null) {
                    self.cache[url] = existingURL;
                    callback(existingURL);
                }

                self.download(url, function (inputData) {
                    var fileType = url.substring(url.lastIndexOf('.') + 1)
                    self.convert(inputData, fileType, function (outputData) {
                        self.upload(self.bucket, name, outputData, function (convertedURL) {
                            self.cache[url] = convertedURL;
                            if (existingURL === null) {
                                callback(convertedURL);
                            }
                        });
                    });
                });
            });
        } else {
            callback(convertedURL);
        }
    },

    audioExists: function(url, callback) {
        var responseCallback = function(response) {
            var exists = response.statusCode === 200;
            if (exists) {
                callback(url);
            } else {
                callback(null)
            }
        }

        https.get(url, responseCallback).end();
    },

    urlForKey: function(bucket, key) {
        return 'https://s3.amazonaws.com/' + bucket + '/' + key;
    }
};

module.exports = AudioConverter;