import { Router } from "express";
import healthRouter from "./health.routes";
import authRouter from "./auth.routes";
import bankSoalRouter from "./bank-soal.routes";
import ujianRouter from "./ujian.routes";
import proctoringRouter from "./proctoring.routes";
import examRouter from "./exam.routes";
import nilaiRouter from "./nilai.routes";

const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/bank-soal", bankSoalRouter);
apiRouter.use("/ujian", ujianRouter);
apiRouter.use("/proctoring", proctoringRouter);
apiRouter.use("/exam", examRouter);
apiRouter.use("/nilai", nilaiRouter);

export default apiRouter;
