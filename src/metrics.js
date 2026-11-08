const os = require('node:os');
const config = require('./config.js');

const counters = new Map();
const durations = new Map();
const activeUsers = new Map();

const startTime = (BigInt(Date.now()) * 1000000n).toString();
let previousCpu = process.cpuUsage();
let previousCpuTime = process.hrtime.bigint();
let exporting = false;
let interval;

function increment(name, labels = {}, amount = 1) {
  const key = JSON.stringify({ name, labels });
  const current = counters.get(key) || { name, labels, value: 0 };
  current.value += amount;
  counters.set(key, current);
}

function observe(name, duration, labels = {}) {
  const key = JSON.stringify({ name, labels });
  const current = durations.get(key) || { name, labels, count: 0, sum: 0 };
  current.count++;
  current.sum += duration;
  durations.set(key, current);
}

function requestTracker(req, res, next) {
  const start = performance.now();

  res.on('finish', () => {
    const endpoint = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : req.path.replace(/\/\d+(?=\/|$)/g, '/:id');

    const labels = {
      method: req.method,
      endpoint,
      status: String(res.statusCode),
    };

    increment('http_requests_total', labels);
    observe('http_request_duration_ms', performance.now() - start, labels);

    if (req.user?.id) {
      activeUsers.set(String(req.user.id), Date.now());
    }

    if (req.path === '/api/auth' && req.method === 'PUT') {
      increment('auth_attempts_total', {
        result: res.statusCode < 400 ? 'success' : 'failure',
      });
    }
  });

  next();
}

function attributes(labels) {
  return Object.entries(labels).map(([key, value]) => ({
    key,
    value: { stringValue: String(value) },
  }));
}

function sumMetric(name, value, labels, timestamp) {
  return {
    name,
    sum: {
      aggregationTemporality: 2,
      isMonotonic: true,
      dataPoints: [{
        asDouble: value,
        startTimeUnixNano: startTime,
        timeUnixNano: timestamp,
        attributes: attributes(labels),
      }],
    },
  };
}

function gaugeMetric(name, value, labels, timestamp) {
  return {
    name,
    gauge: {
      dataPoints: [{
        asDouble: value,
        timeUnixNano: timestamp,
        attributes: attributes(labels),
      }],
    },
  };
}

function getCpuPercent() {
  const currentCpu = process.cpuUsage();
  const currentTime = process.hrtime.bigint();

  const cpuMicroseconds =
    currentCpu.user + currentCpu.system -
    previousCpu.user - previousCpu.system;

  const elapsedMicroseconds =
    Number(currentTime - previousCpuTime) / 1000;

  previousCpu = currentCpu;
  previousCpuTime = currentTime;

  return elapsedMicroseconds > 0
    ? (cpuMicroseconds / elapsedMicroseconds) * 100
    : 0;
}

function getActiveUsers() {
  const cutoff = Date.now() - 5 * 60 * 1000;

  for (const [userId, lastSeen] of activeUsers) {
    if (lastSeen < cutoff) {
      activeUsers.delete(userId);
    }
  }

  return activeUsers.size;
}

async function exportMetrics() {
  const { endpoint, accountId, apiKey } = config.metrics || {};
  if (!endpoint || !accountId || !apiKey || exporting) return;

  exporting = true;

  try {
    const timestamp = (BigInt(Date.now()) * 1000000n).toString();
    const metrics = [];

    for (const item of counters.values()) {
      metrics.push(sumMetric(item.name, item.value, item.labels, timestamp));
    }

    for (const item of durations.values()) {
      metrics.push(sumMetric(`${item.name}_sum`, item.sum, item.labels, timestamp));
      metrics.push(sumMetric(`${item.name}_count`, item.count, item.labels, timestamp));
    }

    const memory = process.memoryUsage();
    const cpuPercent = getCpuPercent();

    metrics.push(gaugeMetric('cpu_percent', cpuPercent, {}, timestamp));
    metrics.push(gaugeMetric('memory_usage_bytes', memory.rss, {}, timestamp));
    metrics.push(gaugeMetric(
      'memory_percent',
      (memory.rss / os.totalmem()) * 100,
      {},
      timestamp
    ));
    metrics.push(gaugeMetric('active_users', getActiveUsers(), {}, timestamp));

    const payload = {
      resourceMetrics: [{
        resource: {
          attributes: attributes({ 'service.name': 'jwt-pizza-service' }),
        },
        scopeMetrics: [{ metrics }],
      }],
    };

    const authorization = Buffer.from(`${accountId}:${apiKey}`).toString('base64');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Grafana metrics export failed: ${response.status}`);
    } else {
      console.log('Metrics sent to Grafana');
    }
  } catch (error) {
    console.error('Grafana metrics export error:', error.message);
  } finally {
    exporting = false;
  }
}

function startMetrics() {
  if (!interval) {
    interval = setInterval(exportMetrics, 10000);
  }
}

module.exports = { requestTracker, increment, observe, startMetrics };
