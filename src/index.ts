import "dotenv/config";
import { createApp } from "./app";

const PORT = process.env.PORT || 5000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`🚀 Express Backend API running on http://localhost:${PORT}`);
});
