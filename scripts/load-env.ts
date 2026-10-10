// Loads .env for CLI scripts (Next.js loads it itself for the app). Uses Node's built-in loader.
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env file — rely on the real environment */
}
