import { main } from "./src/index.js";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
