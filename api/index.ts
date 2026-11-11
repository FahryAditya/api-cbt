import app from "../src/index";

export default function handler(req: any, res: any) {
  try {
    // Jika user mengakses root domain "/" atau "/api"
    const url = req.url || "/";
    if (url === "/" || url === "/api" || url === "/api/") {
      return res.status(200).json({
        success: true,
        message: "CBT Sekolah API is running",
        documentation: "/api/health",
        endpoints: [
          "/api/health",
          "/api/auth/login",
          "/api/ujian",
          "/api/bank-soal",
          "/api/exam/start",
          "/api/proctoring",
        ],
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
