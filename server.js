var exec = require('child_process').exec;
var express = require('express');
var bodyParser = require('body-parser');
var app = express();
var jsonParser = bodyParser.json();
var mongo = require('mongodb');
var MongoClient = mongo.MongoClient;
var assert = require('assert');
var nodemailer = require('nodemailer');

var currentUrl;
if (process.argv[2] === '-d') {
    console.log('Entering dev mode!');
    currentUrl = "http://localhost:3000";
} else {
    currentUrl = "http://notifeye.benjaminjsinger.com";
}
//TODO: rename this
var object = 'n';

app.use(express.static('public'));

// DB Helpers
var dbHelpers = {};
dbHelpers.connectToDb = function(cb) {
    var dbUrl = 'mongodb://localhost:27017/notifeye';
    MongoClient.connect(dbUrl, function(err, db) {
        console.log('connected to db');
        assert.equal(null, err);
        cb(db);
        db.close();
        console.log('connected to db closed');
    });
};

dbHelpers['get' + object] = function(attrObj, callback) {
    dbHelpers.connectToDb(function(db) {
        var collection = db.collection(object);
        collection.find(attrObj).toArray(function(err, objects) {
            assert.equal(err, null);
            callback(objects[0]);
        });
    });
};

dbHelpers['create' + object] = function(attrObj, callback) {
    dbHelpers.connectToDb(function(db) {
        var collection = db.collection(object);
        collection.insertOne(attrObj, function(err, result) {
            assert.equal(err, null);
            callback(result);
        });
    });
};

dbHelpers['delete' + object] = function(attrObj, callback) {
    dbHelpers.connectToDb(function(db) {
        var collection = db.collection(object);
        collection.deleteOne(attrObj, function(err, result) {
            assert.equal(err, null);
            callback(result);
        });
    });
};

dbHelpers['validate' + object] = function(attrObj) {
    var error;
    if (!attrObj.email || attrObj.email.length < 1) {
        error = "The email is required.";
    }
    return error;
};

dbHelpers.findTempResetCode = function(id, callback) {
    dbHelpers.connectToDb(function(db) {
        var collection = db.collection('TempResetCodes');
        collection.find({
            _id: new mongo.ObjectID(id)
        }).toArray(function(err, objects) {
            assert.equal(err, null);
            callback(objects[0]);
        });
    });
};

dbHelpers.createTempResetCode = function(email, callback) {
    dbHelpers.connectToDb(function(db) {
        var collection = db.collection('TempResetCodes');
        collection.insertOne({
            email: email,
            timeToDelete: Date.now() + 600000
        }, function(err, result) {
            assert.equal(err, null);
            callback(result);
        });
    });
};

dbHelpers.deleteTempResetCode = function(id, callback) {
    dbHelpers.connectToDb(function(db) {
        var collection = db.collection('TempResetCodes');
        collection.deleteOne({
            _id: new mongo.ObjectID(id)
        }, function(err, result) {
            assert.equal(err, null);
            callback(result);
        });
    });
};

var purgeOldResetCodes = function() {
    dbHelpers.connectToDb(function(db) {
        var collection = db.collection('TempResetCodes');
        collection.find({
            timeToDelete: {
                $gt: Date.now()
            }
        }).toArray(function(err, objects) {
            assert.equal(err, null);
            objects.forEach(function(obj) {
                dbHelpers.connectToDb(function(db) {
                    collection = db.collection('TempResetCodes');
                    collection.deleteOne({
                        _id: new mongo.ObjectID(obj._id)
                    }, function(err, result) {
                        assert.equal(err, null);
                    });
                });
            });
        });
    });
};
purgeOldResetCodes();
setInterval(purgeOldResetCodes, 600000);

// create reusable transporter object using the default SMTP transport
console.log(process.env.notifeye_password);
var transporter = nodemailer.createTransport('smtps://notify.notifeye%40gmail.com:' + process.env.notifeye_password + '@smtp.gmail.com');
var sendEmail = function(options, cb) {
    // send mail with defined transport object
    var mailOptions = {
        from: '"Notifeye" <notify.notifeye@gmail.com>', // sender address
        to: options.email, // list of receivers
        subject: options.subject,
        text: options.body
            // html: options.body // html body
    };
    transporter.sendMail(mailOptions, function(error, info) {
        if (error) {
            return console.log(error);
        }
        console.log('Message sent: ' + info.response);
        cb(error, info);
    });
};

// Endpoints
app.get('/' + object + '/:id', jsonParser, function(req, res) {
    var id = req.params.id;
    if (id && id.length > 0) {
        dbHelpers['get' + object]({
            _id: new mongo.ObjectID(id)
        }, function(obj) {
            //send notification
            sendEmail({
                email: obj.email,
                subject: "Beep beep!",
                body: "Your " + object + " link has been hit! Here's your notification!"
            }, function(err) {
                res.status(422);
                if (err) {
                    console.log("Error sending email.", err);
                }
            });
            res.send({
                status: "Notifications sent!"
            });
        });
    } else {
        res.status(422);
        res.send(JSON.stringify({
            error: "id not specified"
        }));
    }
});

app.post('/' + object + '?*', jsonParser, function(req, res) {
    var body = {
        email: req.body.email
    };
    var error = dbHelpers['validate' + object](body);
    if (!error) {
        dbHelpers['get' + object]({
            email: body.email
        }, function(obj) {
            if (!obj) {
                dbHelpers['create' + object](body, function(result) {
                    sendEmail({
                        email: body.email,
                        subject: "Here's your " + object + "!",
                        body: "Here is your new " + object + ' link: ' + currentUrl + '/' + object + '/' + result.ops[0]._id
                    }, function(err) {
                        res.status(422);
                        if (err) {
                            console.log("Error sending email.", err);
                        }
                    });
                    res.send({
                        id: result.ops[0]._id
                    });
                });
            } else {
                dbHelpers.createTempResetCode(body.email, function(result) {
                    sendEmail({
                        email: body.email,
                        subject: "Reset your " + object,
                        body: "Click here to get a new " + object + ' link: ' + currentUrl + '/' + object + '/reset/' + result.ops[0]._id
                    }, function(err) {
                        if (err) {
                            console.log("Error sending email.", err);
                        }
                    });
                    res.status(422);
                    res.send(JSON.stringify({
                        error: "Email already in use. Check your email to reset your " + object + "."
                    }));
                });
            }
        });
    } else {
        res.status(422);
        res.send(JSON.stringify({
            error: error
        }));
    }
});

app.get('/' + object + '/reset/:id', jsonParser, function(req, res) {
    var id = req.params.id;
    if (id && id.length > 0) {
        dbHelpers.findTempResetCode(id, function(result1) {
            if (result1 && result1.email) {
                var email = result1.email;
                dbHelpers.deleteTempResetCode(id, function(result2) {
                    dbHelpers['delete' + object]({
                            email: email
                        },
                        function(result3) {
                            dbHelpers['create' + object]({
                                email: email
                            }, function(result4) {
                                sendEmail({
                                    email: email,
                                    subject: "Your " + object + " has been reset!",
                                    body: "Here is your new " + object + ' link: ' + currentUrl + '/' + object + '/' + result4.ops[0]._id
                                }, function(err) {
                                    if (err) {
                                        console.log("Error sending email.", err);
                                    }
                                });
                                res.send("Your " + object + " has been reset!"); //TODO: redirect to ui
                            });
                        });
                });
            } else {
                res.status(422);
                res.send('{ error: "No reset code found."}');
                //TODO: redirect to ui
            }
        });

    } else {
        res.status(422);
        res.send(JSON.stringify({
            error: "id not specified"
        }));
    }
});


app.listen(3000);
console.log('listening on port 3000');

// // app.get('/', function(req, res) {
// //     res.sendFile(__dirname + '/index.html');
// // });
// / }); +
// '/index.html');
// // });
// / });
// dex.html ');
//     // });
//     /
// });
// else {
//     res.status(422);
//     res.send(JSON.stringify({
//         error: "id not specified"
//     }));
// }
// });


// app.listen(3000);
// console.log('listening on port 3000');

// // app.get('/', function(req, res) {
// //     res.sendFile(__dirname + '/index.html');
// // });
// / }); +
// '/index.html');
// // });
// / });
// dex.html ');
//     // });
//     /
// });
