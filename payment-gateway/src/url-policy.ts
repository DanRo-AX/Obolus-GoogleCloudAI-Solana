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
