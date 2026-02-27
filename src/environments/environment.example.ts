// Environment configuration template
// ================================
// Copy this file to environment.ts (for development) or environment.prod.ts (for production)
// Then replace the placeholder values with your actual credentials
//
// Commands:
//   cp src/environments/environment.example.ts src/environments/environment.ts
//   cp src/environments/environment.example.ts src/environments/environment.prod.ts

export const environment = {
  production: false, // Set to true for production

  // Parse Server configuration
  // --------------------------
  // Option 1: Back4App (https://www.back4app.com/)
  //   - Create account and new app
  //   - Go to Dashboard > App Settings > Security & Keys
  //   - Copy App ID and JavaScript Key
  //
  // Option 2: Sashido (https://www.sashido.io/)
  //   - Similar process to Back4App
  //
  // Option 3: Self-hosted Parse Server
  //   - Use your own server URL
  parseAppId: 'YOUR_PARSE_APP_ID',
  parseJsKey: 'YOUR_PARSE_JAVASCRIPT_KEY',
  parseServerUrl: 'https://your-parse-server-url.com/parse',

  // INSEE API key
  // -------------
  // Required for fetching IRL (residential) and ILAT (professional) rent indices
  // 1. Go to https://api.insee.fr/
  // 2. Create an account
  // 3. Create an application and request access to "Indice de référence des loyers"
  // 4. Copy your API key here
  inseeApiKey: 'YOUR_INSEE_API_KEY',

  // Email sandbox mode
  // ------------------
  // true  = Emails are NOT sent, only logged to console (safe for development)
  // false = Real emails are sent (use for production)
  sandbox: true
};