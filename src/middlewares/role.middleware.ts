import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.middleware";

export const requireRole = (allowedRoles: Array<"ADMIN" | "GURU" | "SISWA">) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Akses ditolak: User belum terautentikasi",
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: `Akses dilarang: Peran '${req.user.role}' tidak memiliki izin untuk tindakan ini`,
      });
      return;
    }

    next();
  };
};

