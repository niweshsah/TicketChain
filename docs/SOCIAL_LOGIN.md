# Google and GitHub sign-in

Email/password sign-in stays available. Google and GitHub buttons appear on sign-in and registration pages; Profile and My tickets offer explicit provider connection for existing accounts. New social accounts default to attendee, or use the organizer role selected during registration. Returning identities retain their existing role.

## Configure the providers

Create a Google **Web application** OAuth client and a GitHub **OAuth App**. Follow the [Google server flow](https://developers.google.com/identity/protocols/oauth2/web-server) and [GitHub OAuth app flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

For the Docker deployment, register these exact callback URLs:

| Provider | Callback                                                  |
| -------- | --------------------------------------------------------- |
| Google   | `http://localhost:8080/api/v1/auth/oauth/google/callback` |
| GitHub   | `http://localhost:8080/api/v1/auth/oauth/github/callback` |

Google's authorized JavaScript origin can be `http://localhost:8080`. Add your account to the Google consent screen's test users when the application is in testing mode. For native Vite development replace `8080` with `5173`; callbacks must match the API's configured `WEB_ORIGIN`. Use separate provider apps for deployment origins as needed.

Place credentials in the root `.env` (ignored by Git):

```dotenv
GOOGLE_CLIENT_ID=your-google-web-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-oauth-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

Then restart the container configuration:

```sh
docker compose -f compose.yaml -f compose.scale.yaml up -d
```

A provider is enabled only after both values are configured. A public client ID by itself is safe to keep in `.env`; that provider stays disabled until its server-side secret is added. A secret without a client ID fails startup. Secrets are server-only and are never bundled into Vite. The supplied Google and GitHub credentials are stored only in the ignored local `.env`, with owner-only file permissions. The file is also excluded from Docker build context.

## Identity and session behavior

The API exchanges authorization codes directly with fixed provider endpoints, using PKCE S256 and the configured callback URL. Attempts expire in ten minutes and are consumed atomically in PostgreSQL, so a callback may reach either API replica. Random state and a separate HttpOnly SameSite=Lax cookie bind the attempt to the initiating browser. Refresh cookies retain the existing SameSite=Strict setting.

Google identity comes from authenticated userinfo and requires verified email. GitHub uses the immutable numeric user ID and its authenticated emails endpoint, requiring a verified primary email even when public email is private. Provider access tokens are used only for the server-side profile lookup and are not persisted. Sessions use the same memory-only access tokens and rotating refresh cookies as password login. Callback redirects carry no application tokens; gateway logs omit URLs/query strings and callback error details.

A matching email does **not** automatically connect a provider to an existing account. Sign in using the existing method, open Profile, and choose Connect Google or Connect GitHub. This explicitly authorizes linking to that account. A provider identity cannot belong to two users, and each user may connect one identity per provider. Existing account roles, passwords, purchases, wallet links and ticket ownership remain unchanged. Social-only accounts have no password hash and reject password login.

Fixture integration tests verify state, PKCE, browser binding, expiry, replay, verified email, private GitHub email, role preservation, account collision/linking and safe failure handling without credentials. Actual Google/GitHub consent and login require configured OAuth apps and have not been exercised with live credentials.

Google consent-screen names come from Google Auth Platform Branding, independently of the local TicketChain title. Set App name to TicketChain in your Google Cloud project, then follow verification/publishing prompts where required. The project branding cannot be changed by modifying this repository.
