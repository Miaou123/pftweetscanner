// src/utils/simpleTimer.js
class SimpleTimer {
    constructor(operationId) {
        this.operationId = operationId;
        this.startTime = Date.now();
    }

    getElapsedSeconds() {
        return ((Date.now() - this.startTime) / 1000).toFixed(1);
    }

    getElapsedMs() {
        return Date.now() - this.startTime;
    }
}

function createTimer(operationId) {
    return new SimpleTimer(operationId);
}

module.exports = {
    SimpleTimer,
    createTimer
};