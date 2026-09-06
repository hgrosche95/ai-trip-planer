import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import type { AuthInfo, OAuthTokenVerifier } from '@modelcontextprotocol/server';

const MCP_HTTP_TOKEN = process.env.MCP_HTTP_TOKEN;

/**
 * Statischer Shared-Secret-Verifier statt echter OAuth-Token-Prüfung: für
 * ein einzelnes, selbst betriebenes Deployment ist ein Bearer-Token aus Env
 * (vom Betreiber selbst gesetzt und verteilt) ausreichend - eine vollwertige
 * OAuth-Integration (Authorization Server, Client-Registrierung, Scopes)
 * wäre für diesen Anwendungsfall unangemessen viel Komplexität. Die
 * SDK-eigenen Bearer-Auth-Helfer (requireBearerAuth) erwarten trotzdem einen
 * OAuthTokenVerifier - diese Klasse implementiert nur genau die eine
 * Methode, die davon gebraucht wird.
 */
export const staticTokenVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!MCP_HTTP_TOKEN) {
      throw new OAuthError(
        OAuthErrorCode.ServerError,
        'MCP_HTTP_TOKEN ist auf dem Server nicht gesetzt.',
      );
    }
    if (token !== MCP_HTTP_TOKEN) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'Ungültiges Token.');
    }
    return {
      token,
      clientId: 'trip-planner-http-client',
      scopes: [],
      // verifyBearerToken/requireBearerAuth lehnen Tokens ohne expiresAt ab
      // (SDK-Dokumentation). Ein statisches, von Hand rotierbares
      // Shared-Secret hat kein echtes Ablaufdatum - daher weit in der
      // Zukunft statt eines Werts, der das eigentliche Verhalten verfälschen
      // würde.
      expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    };
  },
};
