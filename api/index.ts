import "dotenv/config";
import { createApp } from "../src/app";

const app = createApp();

export default function handler(req: any, res: any) {
  try {
    const url = req.url || "/";
    if (url === "/" || url === "/api" || url === "/api/") {
      return res.status(200).json({
        success: true,
        message: "CBT Sekolah API is running",
        documentation: "/api/health",
      });
    }
    return app(req, res);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Internal Server Error in Serverless Handler",
    });
  }
}
