export function secureServiceUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP URL`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not embed credentials in its URL`);
  }
  const loopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${name} must use HTTPS except on loopback`);
  }
  if (url.hash) throw new Error(`${name} must not contain a URL fragment`);
  return url.toString();
}

export function secureServiceOrigin(name: string, value: string): string {
  const url = new URL(secureServiceUrl(name, value));
  if (url.pathname !== "/" || url.search) {
    throw new Error(`${name} must be an origin without a path or query`);
  }
  return url.origin;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Production origins remain an exact allowlist. During local development only,
 * localhost, 127.0.0.1, and ::1 may stand in for one another when their scheme
 * and port are identical.
 */
export function browserOriginAllowed(
  candidate: string | undefined,
  configured: string,
  managedEnvironment: boolean,
): boolean {
  if (!candidate) return false;
  if (candidate === configured) return true;
  if (managedEnvironment) return false;

  try {
    const actual = new URL(candidate);
    const expected = new URL(configured);
    return (
      LOOPBACK_HOSTS.has(actual.hostname) &&
      LOOPBACK_HOSTS.has(expected.hostname) &&
      actual.protocol === expected.protocol &&
      actual.port === expected.port &&
      actual.username === "" &&
      actual.password === "" &&
      actual.pathname === "/" &&
      actual.search === "" &&
      actual.hash === ""
    );
  } catch {
    return false;
  }
}
