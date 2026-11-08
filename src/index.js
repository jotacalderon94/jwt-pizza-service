const app = require('./service.js');
const { startMetrics } = require('./metrics.js');

const port = process.argv[2] || 3000;
app.listen(port, () => {
  startMetrics();
  console.log(`Server started on port ${port}`);
});
