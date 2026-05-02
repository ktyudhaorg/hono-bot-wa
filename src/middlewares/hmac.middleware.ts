import { MiddlewareHandler } from "hono";
import { HmacService } from "@/services/hmac";

export const hmacMiddleware: MiddlewareHandler = async (c, next) => {
  const clientKey = c.req.header("X-Key");
  const timestamp = c.req.header("X-Timestamp");
  const token = c.req.header("X-Token");

  const isValid = HmacService.validate({
    clientKey,
    timestamp,
    token,
  });

  if (!isValid) {
    console.warn("HMAC validation failed", { clientKey, timestamp });
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};