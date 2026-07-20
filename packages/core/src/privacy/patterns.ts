/**
 * Secret detection patterns.
 *
 * ST1: Detects API keys, tokens, passwords, private keys,
 * connection strings, and other credentials commonly found
 * in AI session transcripts.
 */

export const SecretTypes = {
  API_KEY: 'api_key',
  TOKEN: 'token',
  PASSWORD: 'password',
  PRIVATE_KEY: 'private_key',
  CONNECTION_STRING: 'connection_string',
  AWS_CREDENTIAL: 'aws_credential',
  CERTIFICATE: 'certificate',
  SECRET_GENERIC: 'secret_generic',
} as const;

export type SecretType = (typeof SecretTypes)[keyof typeof SecretTypes];

export interface SecretPattern {
  id: string;
  type: SecretType;
  label: string;
  pattern: RegExp;
  /** false positives are common for this pattern */
  highFalsePositive?: boolean;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // ── API Keys ──────────────────────────────────────────
  { id: 'anthropic_key', type: SecretTypes.API_KEY, label: 'Anthropic API Key', pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { id: 'openai_key', type: SecretTypes.API_KEY, label: 'OpenAI API Key', pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { id: 'openai_proj_key', type: SecretTypes.API_KEY, label: 'OpenAI Project Key', pattern: /sk-proj-[a-zA-Z0-9_-]{20,}/ },
  { id: 'google_api_key', type: SecretTypes.API_KEY, label: 'Google API Key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { id: 'github_pat', type: SecretTypes.TOKEN, label: 'GitHub PAT', pattern: /ghp_[a-zA-Z0-9]{36}/ },
  { id: 'github_oauth', type: SecretTypes.TOKEN, label: 'GitHub OAuth', pattern: /gho_[a-zA-Z0-9]{36}/ },
  { id: 'github_app', type: SecretTypes.TOKEN, label: 'GitHub App Token', pattern: /(?:ghu|ghs|ghr)_[a-zA-Z0-9]{36}/ },
  { id: 'gitlab_pat', type: SecretTypes.TOKEN, label: 'GitLab PAT', pattern: /glpat-[a-zA-Z0-9_-]{20,}/ },
  { id: 'slack_token', type: SecretTypes.TOKEN, label: 'Slack Token', pattern: /xox[bpors]-[a-zA-Z0-9-]{10,}/ },
  { id: 'slack_webhook', type: SecretTypes.TOKEN, label: 'Slack Webhook', pattern: /hooks\.slack\.com\/services\/T[a-zA-Z0-9_]{8,}\/B[a-zA-Z0-9_]{8,}\/[a-zA-Z0-9_]{20,}/ },
  { id: 'stripe_key', type: SecretTypes.API_KEY, label: 'Stripe Key', pattern: /(?:sk|pk)_(?:test|live)_[a-zA-Z0-9]{20,}/ },
  { id: 'twilio_key', type: SecretTypes.API_KEY, label: 'Twilio API Key', pattern: /SK[a-f0-9]{32}/ },
  { id: 'sendgrid_key', type: SecretTypes.API_KEY, label: 'SendGrid Key', pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/ },
  { id: 'npm_token', type: SecretTypes.TOKEN, label: 'npm Token', pattern: /npm_[a-zA-Z0-9]{36}/ },

  // ── AWS ───────────────────────────────────────────────
  { id: 'aws_access_key', type: SecretTypes.AWS_CREDENTIAL, label: 'AWS Access Key', pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/ },
  { id: 'aws_secret_key', type: SecretTypes.AWS_CREDENTIAL, label: 'AWS Secret Key', pattern: /(?:aws_secret_access_key|secret_key)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i },

  // ── Private Keys ──────────────────────────────────────
  { id: 'rsa_private', type: SecretTypes.PRIVATE_KEY, label: 'RSA Private Key', pattern: /-----BEGIN RSA PRIVATE KEY-----/ },
  { id: 'ec_private', type: SecretTypes.PRIVATE_KEY, label: 'EC Private Key', pattern: /-----BEGIN EC PRIVATE KEY-----/ },
  { id: 'openssh_private', type: SecretTypes.PRIVATE_KEY, label: 'OpenSSH Private Key', pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/ },
  { id: 'generic_private', type: SecretTypes.PRIVATE_KEY, label: 'Private Key', pattern: /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/ },

  // ── Certificates ──────────────────────────────────────
  { id: 'certificate', type: SecretTypes.CERTIFICATE, label: 'Certificate', pattern: /-----BEGIN CERTIFICATE-----/ },

  // ── Connection Strings ────────────────────────────────
  { id: 'postgres_url', type: SecretTypes.CONNECTION_STRING, label: 'PostgreSQL URL', pattern: /postgres(?:ql)?:\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/ },
  { id: 'mysql_url', type: SecretTypes.CONNECTION_STRING, label: 'MySQL URL', pattern: /mysql:\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/ },
  { id: 'mongodb_url', type: SecretTypes.CONNECTION_STRING, label: 'MongoDB URL', pattern: /mongodb(?:\+srv)?:\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/ },
  { id: 'redis_url', type: SecretTypes.CONNECTION_STRING, label: 'Redis URL', pattern: /redis:\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/ },

  // ── Passwords ─────────────────────────────────────────
  { id: 'password_assign', type: SecretTypes.PASSWORD, label: 'Password Assignment', pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"][^\s'"]{8,}['"]/i, highFalsePositive: true },
  { id: 'password_env', type: SecretTypes.PASSWORD, label: 'Password Env Var', pattern: /(?:PASSWORD|PASSWD|SECRET|API_KEY|TOKEN|AUTH)\s*=\s*[^\s]{8,}/i },

  // ── Generic secrets ───────────────────────────────────
  { id: 'bearer_token', type: SecretTypes.TOKEN, label: 'Bearer Token', pattern: /Bearer\s+[a-zA-Z0-9_.-]{20,}/ },
  { id: 'basic_auth', type: SecretTypes.TOKEN, label: 'Basic Auth', pattern: /Basic\s+[A-Za-z0-9+/=]{20,}/ },
  { id: 'jwt_token', type: SecretTypes.TOKEN, label: 'JWT Token', pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
  { id: 'hex_secret_32', type: SecretTypes.SECRET_GENERIC, label: 'Hex Secret (32+ chars)', pattern: /(?:secret|key|token|auth)\s*[=:]\s*['"]?[0-9a-f]{32,}['"]?/i, highFalsePositive: true },
];

// ─── Detection result ───────────────────────────────────────

export interface SecretDetection {
  patternId: string;
  type: SecretType;
  label: string;
  /** Start index in the text */
  startIndex: number;
  /** End index in the text */
  endIndex: number;
  /** The matched text (for display — will be partially masked) */
  maskedMatch: string;
  /** Whether this pattern has high false-positive rate */
  highFalsePositive: boolean;
}

function maskSecret(match: string): string {
  if (match.length <= 8) return '***';
  const visiblePrefix = Math.min(4, Math.floor(match.length * 0.15));
  const visibleSuffix = Math.min(4, Math.floor(match.length * 0.1));
  const masked = match.slice(0, visiblePrefix) + '•'.repeat(Math.min(20, match.length - visiblePrefix - visibleSuffix)) + match.slice(-visibleSuffix);
  return masked;
}

/**
 * Scan text for secrets.
 */
export function detectSecrets(text: string): SecretDetection[] {
  const detections: SecretDetection[] = [];

  for (const pattern of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags + (pattern.pattern.flags.includes('g') ? '' : 'g'));
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      detections.push({
        patternId: pattern.id,
        type: pattern.type,
        label: pattern.label,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        maskedMatch: maskSecret(match[0]),
        highFalsePositive: pattern.highFalsePositive ?? false,
      });
    }
  }

  // Sort by position and deduplicate overlapping matches
  detections.sort((a, b) => a.startIndex - b.startIndex);

  const deduped: SecretDetection[] = [];
  for (const det of detections) {
    const last = deduped[deduped.length - 1];
    if (last && det.startIndex < last.endIndex) {
      // Overlapping — keep the longer/more specific match
      if (det.endIndex - det.startIndex > last.endIndex - last.startIndex) {
        deduped[deduped.length - 1] = det;
      }
    } else {
      deduped.push(det);
    }
  }

  return deduped;
}
