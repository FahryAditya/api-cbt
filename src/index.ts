import "dotenv/config";
import { createApp } from "./app";

const app = createApp();
const PORT = process.env.PORT || 5000;

// Jangan jalankan listen jika di environment Vercel serverless
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Express Backend API running on http://localhost:${PORT}`);
  });
}

export default app;
