// Startup file for Plesk's Node.js extension (Passenger) and `npm start`.
// Runs the self-contained server produced by `npm run build`.
process.env.NODE_ENV = process.env.NODE_ENV || "production";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Passenger loads this file as CommonJS
require("./.next/standalone/server.js");
