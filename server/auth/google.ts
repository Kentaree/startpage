import * as client from "openid-client";

export interface GoogleChecks { state: string; nonce: string; codeVerifier: string }
export interface GoogleProfile { sub: string; email?: string; email_verified?: boolean }

/** The only surface the app uses for Google; tests replace it with a mock. */
export interface GoogleClient {
  authorizationUrl(checks: GoogleChecks): Promise<string>;
  /** Exchange the callback URL for verified ID-token claims (validates state, nonce, PKCE). */
  exchange(callbackUrl: string, checks: GoogleChecks): Promise<GoogleProfile>;
}

export function newChecks(): GoogleChecks {
  return {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier: client.randomPKCECodeVerifier(),
  };
}

export function createGoogleClient(clientId: string, clientSecret: string, redirectUri: string): GoogleClient {
  let config: Promise<client.Configuration> | undefined;
  const getConfig = () =>
    (config ??= client.discovery(new URL("https://accounts.google.com"), clientId, clientSecret).catch((e) => {
      config = undefined;
      throw e;
    }));
  return {
    async authorizationUrl(checks) {
      const url = client.buildAuthorizationUrl(await getConfig(), {
        redirect_uri: redirectUri,
        scope: "openid email",
        state: checks.state,
        nonce: checks.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(checks.codeVerifier),
        code_challenge_method: "S256",
      });
      return url.href;
    },
    async exchange(callbackUrl, checks) {
      const tokens = await client.authorizationCodeGrant(await getConfig(), new URL(callbackUrl), {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        idTokenExpected: true,
      });
      const c = tokens.claims();
      if (!c) throw new Error("missing id_token");
      return { sub: c.sub, email: c.email as string | undefined, email_verified: c.email_verified as boolean | undefined };
    },
  };
}
