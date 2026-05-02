import { MiddlewareHandler } from "hono";
import * as crypto from "crypto";

const PUBLIC_KEY = process.env.HMAC_PUBLIC_KEY || "";
const SECRET_KEY = process.env.HMAC_SECRET_KEY || "";
const TIMESTAMP_TOLERANCE = 300;

const sign = (data: string): string => {
  return crypto
    .createHmac("sha256", SECRET_KEY)
    .update(data)
    .digest("base64");
};

export const hmacMiddleware: MiddlewareHandler = async (c, next) => {
  const clientKey = c.req.header("X-Key");
  const timestamp = c.req.header("X-Timestamp");
  const token = c.req.header("X-Token");

  if (!clientKey || !timestamp || !token) {
    return c.json({ error: "Unauthorized." }, 401);
  }

  if (clientKey !== PUBLIC_KEY) {
    return c.json({ error: "Unauthorized." }, 401);
  }

  const parsedTimestamp = parseInt(timestamp, 10);

  if (isNaN(parsedTimestamp)) {
    return c.json({ error: "Unauthorized." }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  // toleransi 300 detik, arah sesuai PHP (bukan Math.abs)
  if (parsedTimestamp < now - TIMESTAMP_TOLERANCE || parsedTimestamp > now) {
    return c.json({ error: "Unauthorized." }, 401);
  }

  // input: publicKey + timestamp, sama seperti PHP
  const expectedToken = sign(PUBLIC_KEY + timestamp);

  // timing-safe comparison
  const tokensMatch = crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(expectedToken)
  );

  if (!tokensMatch) {
    return c.json({ error: "Unauthorized." }, 401);
  }

  await next();
};


// EXAMPLE
// export const generateHmacHeaders = (): Record<string, string> => {
//   const timestamp = String(Math.floor(Date.now() / 1000));

//   return {
//     "x-key":       PUBLIC_KEY,
//     "x-timestamp": timestamp,
//     "x-token":     sign(PUBLIC_KEY + timestamp),
//   };
// };