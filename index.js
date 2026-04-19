const app = require("./backend-node.js/src/app");
const env = require("./backend-node.js/src/config/env");

// Preserve the legacy root entry point while the modular backend is used underneath.
function logServerStart() {
  console.log(`Server running on http://localhost:${env.port}`);
}

app.listen(env.port, logServerStart);
