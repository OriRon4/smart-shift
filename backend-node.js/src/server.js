const app = require("./app");
const env = require("./config/env");

// Log the local server URL once the backend starts listening.
function logServerStart() {
  console.log(`Server running on http://localhost:${env.port}`);
}

app.listen(env.port, logServerStart);
