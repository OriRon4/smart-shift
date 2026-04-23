const app = require("./app");
const env = require("./config/env");

app.listen(env.port, () => {
  console.log(`Smart-Shift server is running on port ${env.port}`);
});
