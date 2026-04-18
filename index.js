const app = require("./backend-node.js/src/app");
const env = require("./backend-node.js/src/config/env");

app.listen(env.port, () => {
  console.log(`Server running on http://localhost:${env.port}`);
});
