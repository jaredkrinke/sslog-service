const process = require("process");
const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const sslog = require("sslog");

const logMinimumPeriod = 10 * 1000;
const trace = (process.env.TRACE === "1");

// Core logic
let logLastTime = Date.now() - logMinimumPeriod - 1;
let logTimeoutId = null;
const logMessageQueue = [];
function logScheduleWorkerIfNeeded() {
    if (logMessageQueue.length > 0 && !logTimeoutId) {
        logTimeoutId = setTimeout(logWorker, logMinimumPeriod);
    }
}

function logSendMessage(message) {
    logLastTime = Date.now();
    console.log(`${(new Date()).toISOString()} ${message.channel}: ${message.message}`);

    // TODO: Mobile notification
}

function logWorker() {
    logTimeoutId = null;

    if (logMessageQueue.length > 0) {
        // Note: Last in, first out
        logSendMessage(logMessageQueue.pop())
        logScheduleWorkerIfNeeded();
    }
}

function logMessage(message) {
    if (logMessageQueue.length <= 0 && logLastTime + logMinimumPeriod <= Date.now()) {
        logMessageQueue.push(message);
        logWorker();
    } else if (message.importance !== sslog.Importance.unimportant) {
        logMessageQueue.push(message);
        logScheduleWorkerIfNeeded();
    }
}

// Logging interface
const statusCode = {
    badRequest: 400,
    notFound: 404,
    internalServerError: 500,
};

function createStringValidator(pattern) {
    return function (x) {
        return (typeof(x) === "string" && pattern.test(x)) ? x : undefined;
    };
}

function createNumberValidator(min, max) {
    return function (x) {
        let number = undefined;
        if (typeof(x) === "number") {
            number = x;
        } else if (typeof(x) === "string") {
            number = parseInt(x);
        }
    
        return (number !== undefined && !isNaN(number) && number >= min && number <= max) ? number : undefined;
    }
}

function createEnumValidator(e) {
    return createNumberValidator(0, e._length);
}

function createOptionalValidator(validator) {
    return function (x) {
        if (x === undefined || x === null) {
            return null;
        } else {
            return validator(x);
        }
    };
}

const logValidators = {
    message: createStringValidator(/.{1,1024}/),
    channel: createStringValidator(/^[a-z][a-z0-9]{0,7}$/),
    importance: createOptionalValidator(createEnumValidator(sslog.Importance)),
}

function validate(validators, input) {
    let o = { valid: true };
    for (let key in input) {
        let v = validators[key](input[key]);
        if (v === undefined) {
            o.valid = false;
            if (trace) {
                console.log(`Invalid request (field ${key}: ${input[key]})`);
            }
            break;
        } else {
            o[key] = v;
        }
    }
    return o;
}

app.use(bodyParser.json());

app.post("/log/:channel", function (request, response) {
    const message = validate(logValidators, {
        message: request.body.m,
        channel: request.params.channel,
        importance: request.body.i,
    });

    if (message.valid) {
        logMessage(message);

        // Respond immediately
        response.send();
    } else {
        response.status(statusCode.badRequest).send();
    }
});

// Error handlers
app.all("/*", function (request, response) {
    console.log(`${statusCode.notFound}: ${request.method} ${request.originalUrl}`);
    response.status(statusCode.notFound).send();
});

app.use(function (err, request, response, next) {
    console.error(err);
    response.status(statusCode.internalServerError).send();
});

app.listen(sslog.port, "localhost", () => console.log(`Listening on port ${sslog.port}...`));
