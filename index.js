var _ = require('underscore'),
    fs = require('fs'),
    path = require('path'),
    CronJob = require('cron').CronJob,
    optimist = require('optimist'),
    child_process = require('child_process'),
    daemon = require('daemon');

var S_ISUID = 04000,
    S_ISGID = 02000,
    S_ISVTX = 01000,
    S_IRUSR = 00400,
    S_IWUSR = 00200,
    S_IXUSR = 00100,
    S_IRGRP = 00040,
    S_IWGRP = 00020,
    S_IXGRP = 00010,
    S_IROTH = 00004,
    S_IWOTH = 00002,
    S_IXOTH = 00001,
    ANY_EXEC = S_IXOTH | S_IXGRP | S_IXUSR;

exports.Watcher = function () {
    var watcher = {};

    // === PRIVATE ===
    var jobs = [];
    var watching = {};
    var changedFiles = {};
    // ===============

    watcher.start = function () {
        fixAll();

        jobs.push(new CronJob({
            cronTime: '0 * * * * *',
            onTick: fixChanged,
            start: true
        }));

        jobs.push(new CronJob({
            cronTime: '0 0 4 * * *',
            onTick: fixAll,
            start: true
        }));
    };

    watcher.stop = function () {
        changedFiles = {};

        _.each(jobs, function (job) {
            job.stop();
        });
        jobs = [];

        _.each(watching, function (watcher, filename) {
            watcher.close();
        });
        watching = {};
    };

    function fixChanged () {
        _.each(changedFiles, function(v, filename) {
            fix(filename)
        });
        changedFiles = {};
    };

    function fixAll () {
        fix('/');
    };

    function watchDir (dir) {
        console.log('watching', dir);

        watching[dir] = fs.watch(dir, function(event, entry) {
            var filename = path.join(dir, entry);
            changedFiles[filename] = 1;
            console.log('adding', filename);
        });
    };

    function fix (filename) {
        console.log('checking', filename);

        fs.open(filename, 'r', function (err, fd) {
            if (err) {
                if (err.errno == 34) {
                    // No such file or directory
                    if (watching[filename]) {
                        watching[filename].close();
                        delete watching[filename];
                    }
                    return;
                } else {
                    console.error(err);
                    return;
                }
            }

            fs.fstat(fd, logError(filename, function (stats) {
                var executable = stats.mode & ANY_EXEC;
                var newMode = stats.mode;
                if (executable) {
                    newMode |= 00777;
                } else {
                    newMode |= 00666;
                }
                if (stats.mode != newMode) {
                    console.log('fixing', filename);
                    fs.fchmod(fd, newMode, logError(filename, function() {
                        fs.close(fd, logError(filename));
                    }));
                } else {
                    fs.close(fd, logError(filename));
                }

                if (stats.isDirectory() && !watching[filename]) {
                    watchDir(filename);
                    fs.readdir(filename, function (err, entries) {
                        _.each(entries, function (entry) {
                            fix(path.join(filename, entry));
                        });
                    });
                }
            }));
        });
    };

    function logError (filename, okFunc) {
        return function (err) {
            if (err) {
                console.error(filename, err);
            } else if (okFunc) {
                okFunc.apply(this, Array.prototype.slice.call(arguments, 1));
            }
        };
    };

    return watcher;
};

if (require.main === module) {
    main();
}

function main() {
    var argv = optimist
        .usage('Usage: $0 DIRPATH [DIRPATH...]')
        .argv;

    if (argv._.length < 1) {
        optimist.showHelp();
        return;
    }

    if (argv._.length == 1) {
        var dir = argv._[0];
        console.log('chroot in', dir);
        daemon.chroot(dir);
        var watcher = exports.Watcher(argv._);
        watcher.start();
    } else {
        var children = _.map(argv._, function (dir) {
            return child_process.fork(__filename, [dir]);
        });
    }
}
